/**
 * Structural validation of translator output against the source bundle.
 *
 * Catches missing keys, dropped or hallucinated interpolation variables,
 * missing or extra CLDR plural categories, and empty translations. Returns
 * `ReviewIssue` objects with severities the pipeline can short-circuit on.
 */

import {
  parseReviewerResponse as coreParseReviewer,
  PipelineParseError,
  safeParseJson,
  type ParsedReviewerResponse,
} from '@monkey-dev-vibes/claude-translate-core';

import { compareInterpolation } from './interpolation.js';
import { flattenBundle } from './loader.js';
import { validatePluralCoverage } from './plurals.js';
import type {
  LocaleBundle,
  PluralCategory,
  ReviewIssue,
  ReviewerOutput,
  TranslatorOutput,
} from './types.js';

/** Parse a translator response into a `translations` map. */
export function parseTranslatorResponse(
  raw: string,
): Omit<TranslatorOutput, 'raw' | 'inputTokens' | 'outputTokens'> {
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PipelineParseError('Translator response is not a JSON object', raw);
  }
  const obj = parsed as Record<string, unknown>;
  const translations = obj['translations'];
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw new PipelineParseError(
      'Translator response missing "translations" object',
      raw,
    );
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(translations)) {
    if (typeof v !== 'string') {
      throw new PipelineParseError(
        `Translation for key "${k}" is not a string (got ${typeof v})`,
        raw,
      );
    }
    map[k] = v;
  }
  return { translations: map };
}

/** Parse a reviewer response and narrow the location field to `key`. */
export function parseReviewerResponse(
  raw: string,
): Omit<ReviewerOutput, 'raw' | 'inputTokens' | 'outputTokens'> {
  const parsed: ParsedReviewerResponse<'key'> = coreParseReviewer(raw, 'key');
  const issues: ReviewIssue[] = parsed.issues.map((i) => ({
    severity: i.severity,
    description: i.description,
    suggestion: i.suggestion,
    key: i.location,
  }));
  return {
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    issues,
    notes: parsed.notes,
  };
}

export interface StructuralParams {
  source: LocaleBundle;
  translations: Record<string, string>;
  targetLanguage: string;
  cldrPlurals?: Record<string, readonly PluralCategory[]>;
}

/** Run structural checks; return issues sorted by severity. */
export function structuralIssues(params: StructuralParams): ReviewIssue[] {
  const { source, translations, targetLanguage, cldrPlurals } = params;
  const issues: ReviewIssue[] = [];

  const sourceLeaves = flattenBundle(source);
  const sourceKeys = new Set(sourceLeaves.map((l) => l.path));
  const targetKeys = new Set(Object.keys(translations));

  // Every non-plural source key must be in translations; interpolation must match.
  for (const { path: keyPath, value } of sourceLeaves) {
    if (/_(one|other|few|many|zero|two)$/.test(keyPath)) continue;
    if (!targetKeys.has(keyPath)) {
      issues.push({
        severity: 'critical',
        key: keyPath,
        description: 'Missing translation for required key.',
      });
      continue;
    }
    const translated = translations[keyPath]!;
    const interp = compareInterpolation(value, translated);
    if (interp.missing.length > 0) {
      issues.push({
        severity: 'critical',
        key: keyPath,
        description: `Translation drops interpolation variable(s): ${interp.missing.join(', ')}.`,
      });
    }
    if (interp.extra.length > 0) {
      issues.push({
        severity: 'major',
        key: keyPath,
        description: `Translation introduces unknown interpolation variable(s): ${interp.extra.join(', ')}.`,
      });
    }
  }

  // Discover plural stems from the source.
  const stems = new Set<string>();
  for (const { path: keyPath } of sourceLeaves) {
    const m = keyPath.match(/^(.+)_(one|other|few|many|zero|two)$/);
    if (m && m[1]) stems.add(m[1]);
  }

  for (const stem of stems) {
    const targetKeysForStem = Array.from(targetKeys).filter((k) =>
      k.startsWith(`${stem}_`),
    );
    const coverage = validatePluralCoverage(
      stem,
      targetKeysForStem,
      targetLanguage,
      cldrPlurals,
    );
    for (const missing of coverage.missing) {
      issues.push({
        severity: 'critical',
        key: missing,
        description: `Missing CLDR plural category for target language "${targetLanguage}".`,
      });
    }
    for (const extra of coverage.extra) {
      issues.push({
        severity: 'major',
        key: extra,
        description: `Unexpected plural category for target language "${targetLanguage}".`,
      });
    }
    // Interpolation parity per plural form.
    const sourceOne = sourceLeaves.find((l) => l.path === `${stem}_one`);
    if (!sourceOne) continue;
    for (const k of targetKeysForStem) {
      const translated = translations[k]!;
      const interp = compareInterpolation(sourceOne.value, translated);
      if (interp.missing.length > 0) {
        issues.push({
          severity: 'critical',
          key: k,
          description: `Plural form drops interpolation variable(s): ${interp.missing.join(', ')}.`,
        });
      }
    }
  }

  for (const [k, v] of Object.entries(translations)) {
    if (!v.trim()) {
      issues.push({
        severity: 'critical',
        key: k,
        description: 'Translation is empty.',
      });
    }
  }

  for (const k of targetKeys) {
    if (sourceKeys.has(k)) continue;
    const isPluralExpansion =
      /_(one|other|few|many|zero|two)$/.test(k) &&
      Array.from(stems).some((s) => k.startsWith(`${s}_`));
    if (isPluralExpansion) continue;
    issues.push({
      severity: 'major',
      key: k,
      description: 'Translation has key not present in source.',
    });
  }

  return issues;
}
