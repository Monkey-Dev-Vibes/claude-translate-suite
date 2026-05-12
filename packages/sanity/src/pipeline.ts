/**
 * Whole-document translation pipeline.
 *
 * For each source-language document of each configured type:
 *   1. Skip if already checkpointed as `done`.
 *   2. Translator → Reviewer → reconcileVerdict.
 *   3. On rejection, retry with the reviewer's issues fed back (up to maxAttempts).
 *   4. On approved / needs-human, write to Sanity (createOrReplace). On
 *      rejected after final attempt, record in checkpoint but do NOT write.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SanityClient } from '@sanity/client';
import { reconcileVerdict } from '@monkey-dev-vibes/claude-translate-core';

import { CheckpointStore, type CheckpointEntry } from './checkpoint.js';
import { review } from './reviewer.js';
import {
  fetchSourceDocs,
  stripForPrompt,
  translationId,
  writeTranslation,
} from './sanity.js';
import { translate } from './translator.js';
import type {
  PipelineConfig,
  PipelineOptions,
  PipelineResult,
  ReviewIssue,
  ReviewerOutput,
  SanityDocument,
} from './types.js';

const DEFAULT_TRANSLATOR_MAX_TOKENS = 8000;
const DEFAULT_REVIEWER_MAX_TOKENS = 4096;

export interface RunResult {
  results: PipelineResult[];
  skipped: Array<{ sourceId: string; type: string; reason: 'checkpoint' }>;
}

export async function run(params: {
  client: Anthropic;
  sanity: SanityClient;
  config: PipelineConfig;
  options: PipelineOptions;
}): Promise<RunResult> {
  const { client, sanity, config, options } = params;
  const sourceLanguage = config.sourceLanguage ?? 'en';
  const checkpointStore = new CheckpointStore(options.checkpointPath);
  const types = options.types ?? Object.keys(config.docTypes);
  if (types.length === 0) {
    throw new Error('No doc types configured. Set config.docTypes.');
  }

  const results: PipelineResult[] = [];
  const skipped: RunResult['skipped'] = [];

  for (const type of types) {
    const typeConfig = config.docTypes[type];
    if (!typeConfig) continue;

    const sourceDocs = await fetchSourceDocs({
      client: sanity,
      type,
      typeConfig,
      sourceLanguage,
      onlyIds: options.onlyIds,
    });

    for (const sourceDoc of sourceDocs) {
      if (checkpointStore.shouldSkip(options.targetLanguage, type, sourceDoc._id)) {
        skipped.push({ sourceId: sourceDoc._id, type, reason: 'checkpoint' });
        continue;
      }

      const sourceFields = stripForPrompt(sourceDoc, config, type);
      const result = await runOneDoc({
        client,
        config,
        options,
        type,
        sourceDoc,
        sourceFields,
      });

      if (!options.dryRun && result.translation) {
        await writeTranslation({
          client: sanity,
          sourceDoc,
          targetLanguage: options.targetLanguage,
          translationFields: result.translation,
          review: result.review,
        });
      }

      if (!options.dryRun) {
        const entry: CheckpointEntry = {
          sourceId: sourceDoc._id,
          translationId: translationId(sourceDoc._id, options.targetLanguage),
          verdict: result.review.verdict,
          status: result.review.verdict === 'rejected' ? 'rejected' : 'done',
          attempts: result.attempts,
          confidence: result.review.confidence,
          issues: result.review.issues,
          notes: result.review.notes,
          totalTranslatorInputTokens: result.totalTranslatorInputTokens,
          totalTranslatorOutputTokens: result.totalTranslatorOutputTokens,
          totalReviewerInputTokens: result.totalReviewerInputTokens,
          totalReviewerOutputTokens: result.totalReviewerOutputTokens,
          completedAt: new Date().toISOString(),
        };
        checkpointStore.upsert(options.targetLanguage, type, entry);
      }
      results.push(result);
    }
  }

  return { results, skipped };
}

interface RunOneParams {
  client: Anthropic;
  config: PipelineConfig;
  options: PipelineOptions;
  type: string;
  sourceDoc: SanityDocument;
  sourceFields: Record<string, unknown>;
}

async function runOneDoc(params: RunOneParams): Promise<PipelineResult> {
  const { client, config, options, type, sourceDoc, sourceFields } = params;
  const maxAttempts = options.maxAttempts ?? 2;
  const translatorMaxTokens = options.translatorMaxTokens ?? DEFAULT_TRANSLATOR_MAX_TOKENS;
  const reviewerMaxTokens = options.reviewerMaxTokens ?? DEFAULT_REVIEWER_MAX_TOKENS;

  const priorReviews: Array<{ attempt: number; verdict: string; issues: ReviewIssue[] }> = [];
  let lastReview: ReviewerOutput | null = null;
  let translation: Record<string, unknown> | null = null;
  let attempts = 0;
  let totalTranslatorInputTokens = 0;
  let totalTranslatorOutputTokens = 0;
  let totalReviewerInputTokens = 0;
  let totalReviewerOutputTokens = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const tx = options.mockTranslator
      ? await options.mockTranslator(sourceDoc, options.targetLanguage)
      : await translate({
          client,
          model: options.translatorModel,
          maxTokens: translatorMaxTokens,
          type,
          sourceFields,
          targetLanguage: options.targetLanguage,
          config,
          referenceContext: options.referenceContext,
          previousIssues: lastReview?.issues,
        });
    totalTranslatorInputTokens += tx.inputTokens ?? 0;
    totalTranslatorOutputTokens += tx.outputTokens ?? 0;

    const rev = options.mockReviewer
      ? await options.mockReviewer(sourceDoc, tx.fields, options.targetLanguage)
      : await review({
          client,
          model: options.reviewerModel,
          maxTokens: reviewerMaxTokens,
          type,
          source: sourceFields,
          translation: tx.fields,
          targetLanguage: options.targetLanguage,
          config,
          attempt,
          maxAttempts,
          referenceContext: options.referenceContext,
          priorReviews,
        });
    totalReviewerInputTokens += rev.inputTokens ?? 0;
    totalReviewerOutputTokens += rev.outputTokens ?? 0;

    const reconciled = reconcileVerdict({
      confidence: rev.confidence,
      issues: rev.issues,
    });
    const merged: ReviewerOutput = { ...rev, verdict: reconciled };
    lastReview = merged;
    priorReviews.push({ attempt, verdict: reconciled, issues: merged.issues });

    if (reconciled === 'approved' || reconciled === 'needs-human') {
      translation = tx.fields;
      break;
    }
    // Rejected — loop and retry.
  }

  if (!lastReview) {
    throw new Error(`Pipeline produced no review for doc ${sourceDoc._id}`);
  }

  const summary =
    `${sourceDoc._id} (${type}) → ${lastReview.verdict} (confidence ${lastReview.confidence}, ` +
    `${lastReview.issues.length} issues, ${attempts} attempt(s))`;

  return {
    sourceId: sourceDoc._id,
    sourceType: type,
    targetLanguage: options.targetLanguage,
    translation,
    review: lastReview,
    attempts,
    totalTranslatorInputTokens,
    totalTranslatorOutputTokens,
    totalReviewerInputTokens,
    totalReviewerOutputTokens,
    summary,
  };
}
