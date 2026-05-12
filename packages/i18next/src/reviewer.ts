/**
 * Reviewer pass — second Claude call per namespace.
 */

import Anthropic from '@anthropic-ai/sdk';
import { callClaudeWithParser } from '@monkey-dev-vibes/claude-translate-core';

import { buildReviewerPrompt } from './prompts.js';
import type {
  LocaleBundle,
  PipelineConfig,
  ReviewIssue,
  ReviewerOutput,
} from './types.js';
import { parseReviewerResponse } from './validate.js';

export interface ReviewParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  namespace: string;
  source: LocaleBundle;
  translation: Record<string, string>;
  targetLanguage: string;
  config: PipelineConfig;
  attempt: number;
  maxAttempts: number;
  priorReviews?: ReadonlyArray<{ attempt: number; verdict: string; issues: ReviewIssue[] }>;
}

export async function review(params: ReviewParams): Promise<ReviewerOutput> {
  const {
    client,
    model,
    maxTokens,
    namespace,
    source,
    translation,
    targetLanguage,
    config,
    attempt,
    maxAttempts,
    priorReviews,
  } = params;
  const { system, user } = buildReviewerPrompt({
    namespace,
    source,
    translation,
    targetLanguage,
    config,
    attempt,
    maxAttempts,
    priorReviews,
  });
  const { parsed, raw, inputTokens, outputTokens } = await callClaudeWithParser(
    { client, model, maxTokens, system, user, role: 'Reviewer' },
    parseReviewerResponse,
  );
  return { ...parsed, raw, inputTokens, outputTokens };
}
