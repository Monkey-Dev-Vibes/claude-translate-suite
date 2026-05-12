/**
 * Translator pass for whole-document mode.
 */

import Anthropic from '@anthropic-ai/sdk';
import { callClaudeWithParser } from '@monkey-dev-vibes/claude-translate-core';

import { buildTranslatorPrompt } from './prompts.js';
import type { PipelineConfig, ReviewIssue, TranslatorOutput } from './types.js';
import { parseTranslatorResponse } from './validate.js';

export interface TranslateParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  type: string;
  sourceFields: Record<string, unknown>;
  targetLanguage: string;
  config: PipelineConfig;
  referenceContext?: string;
  previousIssues?: ReviewIssue[];
}

export async function translate(params: TranslateParams): Promise<TranslatorOutput> {
  const {
    client,
    model,
    maxTokens,
    type,
    sourceFields,
    targetLanguage,
    config,
    referenceContext,
    previousIssues,
  } = params;
  const { system, user } = buildTranslatorPrompt({
    sourceFields,
    type,
    targetLanguage,
    config,
    referenceContext,
    previousIssues,
  });
  const { parsed, raw, inputTokens, outputTokens } = await callClaudeWithParser(
    { client, model, maxTokens, system, user, role: 'Translator' },
    parseTranslatorResponse,
  );
  return { ...parsed, raw, inputTokens, outputTokens };
}
