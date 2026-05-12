/**
 * Public types for the Sanity translation pipeline.
 *
 * Document and Portable Text shapes are kept structural so callers can plug
 * any Sanity schema in without rebuilding the adapter.
 */

import type { Verdict } from '@monkey-dev-vibes/claude-translate-core';

/** A Sanity document — system fields plus arbitrary content. */
export type SanityDocument = Record<string, unknown> & {
  _id: string;
  _type: string;
  _rev?: string;
  _createdAt?: string;
  _updatedAt?: string;
};

/** A Sanity Portable Text block (or an arbitrary block-type embedded inline). */
export type PortableTextBlock = Record<string, unknown> & {
  _type: string;
  _key?: string;
};

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  /** The field path the issue applies to (e.g. `title`, `body.0.span:1`). */
  field?: string;
  description: string;
  suggestion?: string;
}

export interface TranslatorOutput {
  /** Translated field patch — partial object keyed by the same field names. */
  fields: Record<string, unknown>;
  raw: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ReviewerOutput {
  verdict: Verdict;
  confidence: number;
  issues: ReviewIssue[];
  notes: string;
  raw: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PipelineResult {
  sourceId: string;
  sourceType: string;
  targetLanguage: string;
  /** Final translation patch. null if the reviewer rejected after retries. */
  translation: Record<string, unknown> | null;
  review: ReviewerOutput;
  attempts: number;
  totalTranslatorInputTokens: number;
  totalTranslatorOutputTokens: number;
  totalReviewerInputTokens: number;
  totalReviewerOutputTokens: number;
  summary: string;
}

/**
 * Per-document-type config: which fields the pipeline should translate, and
 * how to filter the source-language documents.
 */
export interface DocTypeConfig {
  /** Top-level field names to translate. */
  fields: string[];
  /**
   * Optional extra GROQ predicate to AND into the fetch query.
   * Example: `'status == "published"'`.
   */
  fetchPredicate?: string;
}

/**
 * A Portable Text mark type that should preserve English regardless of the
 * target language. The walker emits a `preserveEnglish` flag on each affected
 * unit; the translator/reviewer prompts surface it so the model leaves the
 * text untouched.
 */
export interface PreservedMark {
  /** The `_type` value on the markDef object that triggers this rule. */
  markType: string;
  /** Optional human-readable label for prompts. */
  label?: string;
}

export interface PipelineConfig {
  /**
   * Map from Sanity `_type` value to its translation config. The pipeline only
   * translates document types present here.
   */
  docTypes: Record<string, DocTypeConfig>;
  /**
   * Source language code stored on documents in the `language` field
   * (default `en`). Translated documents are created with the target value.
   */
  sourceLanguage?: string;
  /**
   * Portable Text mark types whose underlying span text must stay in the
   * source language. The walker tags affected units so prompts can request
   * preservation explicitly.
   */
  preservedMarks?: PreservedMark[];
  /**
   * Block `_type` values the walker should pass through untouched. By default
   * only standard `block` and `image` are recognised; other types are passed
   * through verbatim. Add entries here only if you want a custom block type
   * to be EXPLICITLY logged as preserved (the default behaviour is already a
   * pass-through).
   */
  passThroughBlockTypes?: string[];
  /** Domain hard rules pre-rendered with `buildHardRulesBlock` from core. */
  domainRules?: string;
  /** Per-language glossary block (pre-rendered with `renderGlossary`). */
  glossaryBlocks?: Record<string, string>;
  /** Per-language free-form notes injected under "Language notes". */
  languageNotes?: Record<string, string>;
  /** Short app/content description injected into prompts. */
  appDescription?: string;
}

export interface PipelineOptions {
  targetLanguage: string;
  /** Subset of doc types to process. Defaults to every type in config.docTypes. */
  types?: string[];
  dryRun?: boolean;
  /** Optional filter: only translate docs whose `_id` is in this list. */
  onlyIds?: string[];
  maxAttempts?: number;
  checkpointPath?: string;
  translatorModel: string;
  reviewerModel: string;
  translatorMaxTokens?: number;
  reviewerMaxTokens?: number;
  /** Optional caller-supplied reference text injected into prompts (per-language). */
  referenceContext?: string;
  /** Optional mocks for testing without burning Claude tokens. */
  mockTranslator?: (doc: SanityDocument, lang: string) => Promise<TranslatorOutput>;
  mockReviewer?: (
    source: SanityDocument,
    translation: Record<string, unknown>,
    lang: string,
  ) => Promise<ReviewerOutput>;
}
