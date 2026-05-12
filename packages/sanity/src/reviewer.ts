/**
 * Reviewer pass.
 */

import Anthropic from '@anthropic-ai/sdk';
import { callClaudeWithParser } from '@monkey-dev-vibes/claude-translate-core';

import { buildReviewerPrompt } from './prompts.js';
import type { PipelineConfig, ReviewIssue, ReviewerOutput } from './types.js';
import { parseReviewerResponse } from './validate.js';

export interface ReviewParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  type: string;
  source: Record<string, unknown>;
  translation: Record<string, unknown>;
  targetLanguage: string;
  config: PipelineConfig;
  attempt: number;
  maxAttempts: number;
  referenceContext?: string;
  priorReviews?: ReadonlyArray<{ attempt: number; verdict: string; issues: ReviewIssue[] }>;
}

export async function review(params: ReviewParams): Promise<ReviewerOutput> {
  const {
    client,
    model,
    maxTokens,
    type,
    source,
    translation,
    targetLanguage,
    config,
    attempt,
    maxAttempts,
    referenceContext,
    priorReviews,
  } = params;
  const { system, user } = buildReviewerPrompt({
    type,
    source,
    translation,
    targetLanguage,
    config,
    attempt,
    maxAttempts,
    referenceContext,
    priorReviews,
  });
  const { parsed, raw, inputTokens, outputTokens } = await callClaudeWithParser(
    { client, model, maxTokens, system, user, role: 'Reviewer' },
    parseReviewerResponse,
  );
  return { ...parsed, raw, inputTokens, outputTokens };
}
