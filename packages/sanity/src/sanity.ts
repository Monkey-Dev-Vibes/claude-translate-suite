/**
 * Sanity client + fetch / write helpers.
 *
 * Translated documents are written with deterministic `_id`s of the form
 * `<sourceId>__<targetLanguage>` so re-runs overwrite the previous translation
 * via `createOrReplace` rather than piling up duplicates.
 */

import { createClient, type SanityClient } from '@sanity/client';

import type { Verdict } from '@monkey-dev-vibes/claude-translate-core';

import type {
  DocTypeConfig,
  PipelineConfig,
  ReviewerOutput,
  SanityDocument,
} from './types.js';

export interface CreateClientOptions {
  /** Sanity project id. Defaults to `process.env.SANITY_PROJECT_ID`. */
  projectId?: string;
  /** Dataset name. Defaults to `process.env.SANITY_DATASET` or `'production'`. */
  dataset?: string;
  /** API token (editor-scoped for writes). Defaults to `process.env.SANITY_API_TOKEN`. */
  token?: string;
  /** API version. Defaults to `2024-01-01`. */
  apiVersion?: string;
}

/** Build a Sanity client from explicit options or environment variables. */
export function createSanityClient(opts: CreateClientOptions = {}): SanityClient {
  const projectId = opts.projectId ?? process.env['SANITY_PROJECT_ID'];
  const dataset = opts.dataset ?? process.env['SANITY_DATASET'] ?? 'production';
  const token = opts.token ?? process.env['SANITY_API_TOKEN'];
  const apiVersion = opts.apiVersion ?? '2024-01-01';

  if (!projectId) {
    throw new Error(
      'createSanityClient: missing projectId. Pass it explicitly or set SANITY_PROJECT_ID.',
    );
  }
  if (!token) {
    throw new Error(
      'createSanityClient: missing token. Pass it explicitly or set SANITY_API_TOKEN ' +
        '(editor-scoped for write access).',
    );
  }

  return createClient({ projectId, dataset, token, apiVersion, useCdn: false });
}

/**
 * Fetch source-language documents of the given type, excluding any that
 * already have a translation for the target language. An optional GROQ
 * predicate from `DocTypeConfig.fetchPredicate` is AND-ed into the filter.
 */
export async function fetchSourceDocs(params: {
  client: SanityClient;
  type: string;
  typeConfig: DocTypeConfig;
  sourceLanguage: string;
  onlyIds?: string[];
}): Promise<SanityDocument[]> {
  const { client, type, typeConfig, sourceLanguage, onlyIds } = params;
  const extraPredicate = typeConfig.fetchPredicate ? `&& (${typeConfig.fetchPredicate})` : '';
  const idFilter = onlyIds && onlyIds.length > 0 ? '&& _id in $onlyIds' : '';

  const query = `
    *[
      _type == $type
      && (language == $sourceLanguage || !defined(language))
      ${extraPredicate}
      ${idFilter}
    ] | order(_id) {...}
  `;
  return client.fetch<SanityDocument[]>(query, {
    type,
    sourceLanguage,
    ...(onlyIds ? { onlyIds } : {}),
  });
}

/** Deterministic translation document `_id`. */
export function translationId(sourceId: string, targetLanguage: string): string {
  const bare = sourceId.replace(/^drafts\./, '');
  return `${bare}__${targetLanguage}`;
}

/** Map a reviewer verdict to a workflow `translationStatus`. */
export function verdictToStatus(verdict: Verdict): 'needs-review' | 'draft' {
  switch (verdict) {
    case 'approved':
    case 'needs-human':
      return 'needs-review';
    case 'rejected':
      return 'draft';
  }
}

const MAX_REVIEW_NOTES_CHARS = 4000;

/** Strip accidental code fences and cap length on reviewer notes. */
export function sanitiseReviewNotes(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/\r\n/g, '\n');
  const fenced = s.trim().match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenced && fenced[1]) s = fenced[1];
  if (s.length > MAX_REVIEW_NOTES_CHARS) {
    s = s.slice(0, MAX_REVIEW_NOTES_CHARS - 32) + '\n\n…[truncated]';
  }
  return s;
}

export interface WriteTranslationParams {
  client: SanityClient;
  sourceDoc: SanityDocument;
  targetLanguage: string;
  translationFields: Record<string, unknown>;
  review: ReviewerOutput;
  /** Optional override for the workflow status field name. Default `translationStatus`. */
  statusFieldName?: string;
  /** Optional extra fields to write (e.g. translation source metadata). */
  extraFields?: Record<string, unknown>;
}

/**
 * Write a translation document via `createOrReplace`. System fields and
 * known workflow fields are stripped from the source spread to keep the
 * translation clean.
 */
export async function writeTranslation(params: WriteTranslationParams): Promise<string> {
  const {
    client,
    sourceDoc,
    targetLanguage,
    translationFields,
    review,
    statusFieldName = 'translationStatus',
    extraFields,
  } = params;

  const _id = translationId(sourceDoc._id, targetLanguage);

  const {
    _id: _srcId,
    _rev: _srcRev,
    _createdAt: _srcCreated,
    _updatedAt: _srcUpdated,
    language: _srcLang,
    translationStatus: _srcStatus,
    sourceRef: _srcRef,
    aiReviewVerdict: _srcVerdict,
    aiReviewConfidence: _srcConf,
    aiReviewNotes: _srcNotes,
    ...structuralCarryover
  } = sourceDoc as Record<string, unknown>;

  const translatedDoc: Record<string, unknown> = {
    _id,
    _type: sourceDoc._type,
    ...structuralCarryover,
    ...translationFields,
    language: targetLanguage,
    [statusFieldName]: verdictToStatus(review.verdict),
    sourceRef: { _type: 'reference', _ref: sourceDoc._id.replace(/^drafts\./, '') },
    aiReviewVerdict: review.verdict,
    aiReviewConfidence: review.confidence,
    aiReviewNotes: sanitiseReviewNotes(review.notes),
    ...(extraFields ?? {}),
  };

  await client.createOrReplace(translatedDoc as Parameters<SanityClient['createOrReplace']>[0]);
  return _id;
}

/**
 * Strip system fields (`_id`, `_rev`, `_createdAt`, `_updatedAt`) and workflow
 * fields from a document so it can be presented to the model without leaking
 * Sanity internals.
 */
export function stripForPrompt(
  doc: SanityDocument,
  config: PipelineConfig,
  type: string,
): Record<string, unknown> {
  const typeConfig = config.docTypes[type];
  if (!typeConfig) return {};
  const out: Record<string, unknown> = {};
  for (const field of typeConfig.fields) {
    if (field in doc) out[field] = (doc as Record<string, unknown>)[field];
  }
  return out;
}
