/**
 * Translator / reviewer response parsing for the Sanity adapter.
 */

import {
  parseReviewerResponse as coreParseReviewer,
  PipelineParseError,
  safeParseJson,
  type ParsedReviewerResponse,
} from '@monkey-dev-vibes/claude-translate-core';

import type { ReviewIssue, ReviewerOutput, TranslatorOutput } from './types.js';

/** Parse a translator response that returns translated fields directly. */
export function parseTranslatorResponse(
  raw: string,
): Omit<TranslatorOutput, 'raw' | 'inputTokens' | 'outputTokens'> {
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PipelineParseError('Translator response is not a JSON object', raw);
  }
  return { fields: parsed as Record<string, unknown> };
}

/** Parse a translator response in Portable Text unit mode. */
export interface PtTranslatorResponse {
  scalars: Record<string, string>;
  units: Record<string, string>;
}

export function parsePtTranslatorResponse(raw: string): PtTranslatorResponse {
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PipelineParseError('Translator response is not a JSON object', raw);
  }
  const obj = parsed as Record<string, unknown>;
  const scalars = (obj['scalars'] ?? {}) as Record<string, unknown>;
  const units = (obj['units'] ?? {}) as Record<string, unknown>;
  const sOut: Record<string, string> = {};
  const uOut: Record<string, string> = {};
  for (const [k, v] of Object.entries(scalars)) {
    if (typeof v !== 'string') {
      throw new PipelineParseError(`scalars.${k} is not a string`, raw);
    }
    sOut[k] = v;
  }
  for (const [k, v] of Object.entries(units)) {
    if (typeof v !== 'string') {
      throw new PipelineParseError(`units.${k} is not a string`, raw);
    }
    uOut[k] = v;
  }
  return { scalars: sOut, units: uOut };
}

/** Parse a reviewer response and narrow the location field to `field`. */
export function parseReviewerResponse(
  raw: string,
): Omit<ReviewerOutput, 'raw' | 'inputTokens' | 'outputTokens'> {
  const parsed: ParsedReviewerResponse<'field'> = coreParseReviewer(raw, 'field');
  const issues: ReviewIssue[] = parsed.issues.map((i) => ({
    severity: i.severity,
    description: i.description,
    suggestion: i.suggestion,
    field: i.location,
  }));
  return {
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    issues,
    notes: parsed.notes,
  };
}
