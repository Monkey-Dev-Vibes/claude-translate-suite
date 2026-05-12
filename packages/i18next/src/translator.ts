/**
 * Translator pass — first Claude call per namespace.
 */

import Anthropic from '@anthropic-ai/sdk';
import { callClaudeWithParser } from '@monkey-dev-vibes/claude-translate-core';

import { buildTranslatorPrompt } from './prompts.js';
import type {
  LocaleBundle,
  PipelineConfig,
  ReviewIssue,
  TranslatorOutput,
} from './types.js';
import { parseTranslatorResponse } from './validate.js';

export interface TranslateParams {
  client: Anthropic;
  model: string;
  maxTokens: number;
  namespace: string;
  source: LocaleBundle;
  targetLanguage: string;
  config: PipelineConfig;
  previousIssues?: ReviewIssue[];
}

export async function translate(params: TranslateParams): Promise<TranslatorOutput> {
  const { client, model, maxTokens, namespace, source, targetLanguage, config, previousIssues } =
    params;
  const { system, user } = buildTranslatorPrompt({
    namespace,
    source,
    targetLanguage,
    config,
    previousIssues,
  });
  const { parsed, raw, inputTokens, outputTokens } = await callClaudeWithParser(
    { client, model, maxTokens, system, user, role: 'Translator' },
    parseTranslatorResponse,
  );
  return { ...parsed, raw, inputTokens, outputTokens };
}
