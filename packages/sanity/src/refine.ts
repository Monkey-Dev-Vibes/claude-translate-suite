/**
 * Refiner pass — re-runs the translator on documents whose previous verdict
 * was `needs-human`, feeding the original reviewer's notes back as explicit
 * feedback. Successful re-runs upgrade `needs-human` → `approved`.
 *
 * Use after a full pipeline run to promote borderline translations without
 * re-translating the entire corpus.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SanityClient } from '@sanity/client';
import { reconcileVerdict } from '@monkey-dev-vibes/claude-translate-core';

import { CheckpointStore } from './checkpoint.js';
import { review } from './reviewer.js';
import {
  fetchSourceDocs,
  stripForPrompt,
  writeTranslation,
} from './sanity.js';
import { translate } from './translator.js';
import type {
  PipelineConfig,
  PipelineOptions,
  PipelineResult,
  ReviewIssue,
  SanityDocument,
} from './types.js';

const DEFAULT_TRANSLATOR_MAX_TOKENS = 8000;
const DEFAULT_REVIEWER_MAX_TOKENS = 4096;

export interface RefineResult {
  /** Documents the refiner attempted. */
  attempted: PipelineResult[];
  /** Documents successfully promoted from needs-human → approved. */
  promoted: PipelineResult[];
}

/**
 * Iterate every checkpoint entry whose verdict is `needs-human`, re-translate
 * with the original reviewer's issues as feedback, and rewrite to Sanity if
 * the new verdict is strictly better.
 */
export async function refineNeedsHuman(params: {
  client: Anthropic;
  sanity: SanityClient;
  config: PipelineConfig;
  options: PipelineOptions;
}): Promise<RefineResult> {
  const { client, sanity, config, options } = params;
  const sourceLanguage = config.sourceLanguage ?? 'en';
  const checkpointStore = new CheckpointStore(options.checkpointPath);
  const types = options.types ?? Object.keys(config.docTypes);

  const attempted: PipelineResult[] = [];
  const promoted: PipelineResult[] = [];

  for (const type of types) {
    const typeConfig = config.docTypes[type];
    if (!typeConfig) continue;
    const file = checkpointStore.read(options.targetLanguage, type);
    const needsHumanIds = Object.values(file.entries)
      .filter((e) => e.verdict === 'needs-human')
      .map((e) => e.sourceId);
    if (needsHumanIds.length === 0) continue;

    const sourceDocs = await fetchSourceDocs({
      client: sanity,
      type,
      typeConfig,
      sourceLanguage,
      onlyIds: needsHumanIds,
    });

    for (const sourceDoc of sourceDocs) {
      const prior = file.entries[sourceDoc._id];
      if (!prior) continue;
      const sourceFields = stripForPrompt(sourceDoc, config, type);
      const refined = await runOneRefine({
        client,
        config,
        options,
        type,
        sourceDoc,
        sourceFields,
        priorIssues: prior.issues,
      });
      attempted.push(refined);

      // Only promote when the new verdict is strictly better.
      if (
        prior.verdict === 'needs-human' &&
        refined.review.verdict === 'approved' &&
        refined.translation &&
        !options.dryRun
      ) {
        await writeTranslation({
          client: sanity,
          sourceDoc,
          targetLanguage: options.targetLanguage,
          translationFields: refined.translation,
          review: refined.review,
        });
        checkpointStore.upsert(options.targetLanguage, type, {
          ...prior,
          verdict: refined.review.verdict,
          status: 'done',
          attempts: prior.attempts + refined.attempts,
          confidence: refined.review.confidence,
          issues: refined.review.issues,
          notes: refined.review.notes,
          totalTranslatorInputTokens:
            prior.totalTranslatorInputTokens + refined.totalTranslatorInputTokens,
          totalTranslatorOutputTokens:
            prior.totalTranslatorOutputTokens + refined.totalTranslatorOutputTokens,
          totalReviewerInputTokens:
            prior.totalReviewerInputTokens + refined.totalReviewerInputTokens,
          totalReviewerOutputTokens:
            prior.totalReviewerOutputTokens + refined.totalReviewerOutputTokens,
          completedAt: new Date().toISOString(),
        });
        promoted.push(refined);
      }
    }
  }

  return { attempted, promoted };
}

interface RunOneRefineParams {
  client: Anthropic;
  config: PipelineConfig;
  options: PipelineOptions;
  type: string;
  sourceDoc: SanityDocument;
  sourceFields: Record<string, unknown>;
  priorIssues: ReviewIssue[];
}

async function runOneRefine(params: RunOneRefineParams): Promise<PipelineResult> {
  const { client, config, options, type, sourceDoc, sourceFields, priorIssues } = params;
  const translatorMaxTokens = options.translatorMaxTokens ?? DEFAULT_TRANSLATOR_MAX_TOKENS;
  const reviewerMaxTokens = options.reviewerMaxTokens ?? DEFAULT_REVIEWER_MAX_TOKENS;

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
        previousIssues: priorIssues,
      });

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
        attempt: 1,
        maxAttempts: 1,
        referenceContext: options.referenceContext,
      });

  const reconciled = reconcileVerdict({
    confidence: rev.confidence,
    issues: rev.issues,
  });

  return {
    sourceId: sourceDoc._id,
    sourceType: type,
    targetLanguage: options.targetLanguage,
    translation: reconciled === 'rejected' ? null : tx.fields,
    review: { ...rev, verdict: reconciled },
    attempts: 1,
    totalTranslatorInputTokens: tx.inputTokens ?? 0,
    totalTranslatorOutputTokens: tx.outputTokens ?? 0,
    totalReviewerInputTokens: rev.inputTokens ?? 0,
    totalReviewerOutputTokens: rev.outputTokens ?? 0,
    summary: `refined ${sourceDoc._id} (${type}) → ${reconciled}`,
  };
}
