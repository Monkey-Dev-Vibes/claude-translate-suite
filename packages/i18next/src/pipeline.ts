/**
 * Pipeline orchestrator.
 *
 * For each namespace:
 *   1. Skip if checkpointed as approved / needs-human.
 *   2. Build diff subset (or full source if diffMode off).
 *   3. translator → structural-check short-circuit → reviewer.
 *   4. Reconcile verdict; on rejection retry with reviewer issues fed back.
 *   5. On approved / needs-human, write to disk (honouring freeze manifest).
 *   6. Persist checkpoint.
 */

import Anthropic from '@anthropic-ai/sdk';
import { reconcileVerdict } from '@monkey-dev-vibes/claude-translate-core';

import { CheckpointStore } from './checkpoint.js';
import { buildDiffSubset } from './diff.js';
import { loadFreezeManifest } from './freeze.js';
import { flattenBundle, listNamespaces, loadBundle } from './loader.js';
import { writeTranslatedNamespace } from './merge.js';
import { review } from './reviewer.js';
import { translate } from './translator.js';
import type {
  LocaleBundle,
  NamespaceResult,
  PipelineConfig,
  PipelineOptions,
  ReviewIssue,
  ReviewerOutput,
} from './types.js';
import { structuralIssues } from './validate.js';

const DEFAULT_TRANSLATOR_MAX_TOKENS = 8000;
const DEFAULT_REVIEWER_MAX_TOKENS = 4096;

export interface RunResult {
  results: NamespaceResult[];
  skipped: Array<{ namespace: string; reason: 'checkpoint' | 'empty-diff' }>;
}

export async function run(params: {
  client: Anthropic;
  config: PipelineConfig;
  options: PipelineOptions;
}): Promise<RunResult> {
  const { client, config, options } = params;
  const {
    targetLanguage,
    namespaces: requestedNamespaces,
    dryRun = false,
    maxAttempts = 2,
    diffMode = true,
    ignoreFreeze = false,
    freezeManifestPath,
    translatorModel,
    reviewerModel,
    translatorMaxTokens = DEFAULT_TRANSLATOR_MAX_TOKENS,
    reviewerMaxTokens = DEFAULT_REVIEWER_MAX_TOKENS,
    checkpointPath,
    mockTranslator,
    mockReviewer,
  } = options;

  const sourceLanguage = config.sourceLanguage ?? 'en';
  const checkpointStore = new CheckpointStore(checkpointPath);
  const freezeManifest = loadFreezeManifest(freezeManifestPath);

  const namespaces =
    requestedNamespaces ?? listNamespaces(config.sourceDir, sourceLanguage);
  if (namespaces.length === 0) {
    throw new Error(
      `No namespaces found in ${config.sourceDir}/${sourceLanguage}/. ` +
        `Pass options.namespaces explicitly or add JSON files to the source folder.`,
    );
  }

  const results: NamespaceResult[] = [];
  const skipped: RunResult['skipped'] = [];

  for (const namespace of namespaces) {
    if (checkpointStore.shouldSkip(targetLanguage, namespace)) {
      skipped.push({ namespace, reason: 'checkpoint' });
      continue;
    }

    // Decide what to translate.
    let translatorSource: LocaleBundle;
    if (diffMode) {
      const diff = buildDiffSubset({
        sourceDir: config.sourceDir,
        sourceLanguage,
        targetLanguage,
        namespace,
        freezeManifest,
        ignoreFreeze,
      });
      if (diff.subsetCount === 0) {
        skipped.push({ namespace, reason: 'empty-diff' });
        continue;
      }
      translatorSource = diff.subset;
    } else {
      translatorSource = loadBundle({
        sourceDir: config.sourceDir,
        lang: sourceLanguage,
        namespace,
      });
    }

    const result = await runOneNamespace({
      client,
      config,
      namespace,
      source: translatorSource,
      targetLanguage,
      translatorModel,
      reviewerModel,
      translatorMaxTokens,
      reviewerMaxTokens,
      maxAttempts,
      mockTranslator,
      mockReviewer,
    });

    if (result.translations) {
      writeTranslatedNamespace({
        sourceDir: config.sourceDir,
        sourceLanguage,
        targetLanguage,
        namespace,
        translations: result.translations,
        freezeManifest,
        ignoreFreeze,
        dryRun,
      });
    }

    if (!dryRun) {
      checkpointStore.write({
        targetLanguage,
        namespace,
        verdict: result.review.verdict,
        attempts: result.attempts,
        issues: result.review.issues,
        notes: result.review.notes,
        totalTranslatorInputTokens: result.totalTranslatorInputTokens,
        totalTranslatorOutputTokens: result.totalTranslatorOutputTokens,
        totalReviewerInputTokens: result.totalReviewerInputTokens,
        totalReviewerOutputTokens: result.totalReviewerOutputTokens,
        completedAt: new Date().toISOString(),
      });
    }

    results.push(result);
  }

  return { results, skipped };
}

interface RunOneParams {
  client: Anthropic;
  config: PipelineConfig;
  namespace: string;
  source: LocaleBundle;
  targetLanguage: string;
  translatorModel: string;
  reviewerModel: string;
  translatorMaxTokens: number;
  reviewerMaxTokens: number;
  maxAttempts: number;
  mockTranslator?: PipelineOptions['mockTranslator'];
  mockReviewer?: PipelineOptions['mockReviewer'];
}

async function runOneNamespace(params: RunOneParams): Promise<NamespaceResult> {
  const {
    client,
    config,
    namespace,
    source,
    targetLanguage,
    translatorModel,
    reviewerModel,
    translatorMaxTokens,
    reviewerMaxTokens,
    maxAttempts,
    mockTranslator,
    mockReviewer,
  } = params;

  const priorReviews: Array<{ attempt: number; verdict: string; issues: ReviewIssue[] }> = [];
  let lastReview: ReviewerOutput | null = null;
  let translations: Record<string, string> | null = null;
  let attempts = 0;
  let totalTranslatorInputTokens = 0;
  let totalTranslatorOutputTokens = 0;
  let totalReviewerInputTokens = 0;
  let totalReviewerOutputTokens = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const tx = mockTranslator
      ? await mockTranslator(namespace, source, targetLanguage)
      : await translate({
          client,
          model: translatorModel,
          maxTokens: translatorMaxTokens,
          namespace,
          source,
          targetLanguage,
          config,
          previousIssues: lastReview?.issues,
        });
    totalTranslatorInputTokens += tx.inputTokens ?? 0;
    totalTranslatorOutputTokens += tx.outputTokens ?? 0;

    // Cheap structural short-circuit — no reviewer call if these fail critical.
    const structural = structuralIssues({
      source,
      translations: tx.translations,
      targetLanguage,
      cldrPlurals: config.cldrPlurals,
    });
    const structuralCritical = structural.filter((i) => i.severity === 'critical');
    if (structuralCritical.length > 0 && attempt < maxAttempts) {
      lastReview = {
        verdict: 'rejected',
        confidence: 0,
        issues: structural,
        notes: 'Rejected by structural validator before reviewer pass.',
        raw: '',
      };
      priorReviews.push({
        attempt,
        verdict: 'rejected',
        issues: structural,
      });
      continue;
    }

    // Reviewer pass.
    const rev = mockReviewer
      ? await mockReviewer(namespace, source, tx.translations, targetLanguage)
      : await review({
          client,
          model: reviewerModel,
          maxTokens: reviewerMaxTokens,
          namespace,
          source,
          translation: tx.translations,
          targetLanguage,
          config,
          attempt,
          maxAttempts,
          priorReviews,
        });
    totalReviewerInputTokens += rev.inputTokens ?? 0;
    totalReviewerOutputTokens += rev.outputTokens ?? 0;

    const reconciled = reconcileVerdict({
      confidence: rev.confidence,
      issues: rev.issues,
    });
    const merged: ReviewerOutput = {
      ...rev,
      verdict: reconciled,
      issues: [...structural, ...rev.issues],
    };
    lastReview = merged;
    priorReviews.push({ attempt, verdict: reconciled, issues: merged.issues });

    if (reconciled === 'approved' || reconciled === 'needs-human') {
      translations = tx.translations;
      break;
    }
    // Rejected — loop and retry with this review's issues fed back.
  }

  if (!lastReview) {
    throw new Error(`Pipeline produced no review for namespace ${namespace}`);
  }

  const summary =
    `${namespace} → ${lastReview.verdict} (confidence ${lastReview.confidence}, ` +
    `${lastReview.issues.length} issues, ${attempts} attempt(s))`;

  return {
    namespace,
    targetLanguage,
    translations,
    review: lastReview,
    attempts,
    totalTranslatorInputTokens,
    totalTranslatorOutputTokens,
    totalReviewerInputTokens,
    totalReviewerOutputTokens,
    summary,
  };
}
