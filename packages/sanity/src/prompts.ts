/**
 * Prompt builders for the Sanity document translation pipeline.
 *
 * Two operating modes:
 *   - Whole-document JSON translation (default for simple field sets).
 *   - Portable Text unit-by-unit translation (when the caller pre-extracts
 *     units via `extractUnits` from `portable-text.ts`). Use this for any
 *     document containing Portable Text content — preserves _keys, markDefs,
 *     and span ordering verbatim.
 */

import type { PipelineConfig, ReviewIssue } from './types.js';
import type { TranslationUnit } from './portable-text.js';

const DEFAULT_APP_DESCRIPTION = 'a CMS-backed content application';

function builtInRules(): string {
  return `
DOC-A. Preserve interpolation tokens, numerical values, units, URLs, dates, code identifiers, brand names, and HTML/markdown markup verbatim. Translate only the human-readable text.

DOC-B. Never invent, remove, or rename fields. Output ONLY the fields you were asked to translate.

DOC-C. If a unit is flagged as "preserveEnglish: true" (Portable Text mode), copy the source text into the translation slot UNCHANGED. Do not paraphrase or translate.

DOC-D. If the source field is empty or whitespace-only, emit an empty string for the corresponding translation slot.`.trim();
}

function header(config: PipelineConfig, targetLanguage: string): string {
  const lines: string[] = [];
  lines.push(`Target language code: ${targetLanguage}.`);
  lines.push('');
  lines.push(builtInRules());
  if (config.domainRules?.trim()) {
    lines.push('');
    lines.push(config.domainRules.trim());
  }
  const glossary = config.glossaryBlocks?.[targetLanguage]?.trim();
  if (glossary) {
    lines.push('');
    lines.push(glossary);
  }
  const note = config.languageNotes?.[targetLanguage]?.trim();
  if (note) {
    lines.push('');
    lines.push('Language notes:');
    lines.push(note);
  }
  return lines.join('\n');
}

// ── Translator: whole-document mode ────────────────────────────────────────

export interface TranslatorPromptParams {
  /** Source-language fields to translate (already stripped of system fields). */
  sourceFields: Record<string, unknown>;
  /** Doc type — for context in the prompt only. */
  type: string;
  targetLanguage: string;
  config: PipelineConfig;
  /** Caller-supplied authoritative reference text (e.g. official translations). */
  referenceContext?: string;
  previousIssues?: ReviewIssue[];
}

export function buildTranslatorPrompt(params: TranslatorPromptParams): {
  system: string;
  user: string;
} {
  const { sourceFields, type, targetLanguage, config, referenceContext, previousIssues } = params;
  const appDescription = config.appDescription ?? DEFAULT_APP_DESCRIPTION;

  const system = [
    `You are translating a "${type}" document for ${appDescription}.`,
    '',
    header(config, targetLanguage),
    referenceContext?.trim()
      ? `\nReference material (authoritative; defer to it when terminology matches):\n${referenceContext.trim()}`
      : '',
    '',
    'Output format — respond with a single JSON object containing ONLY the translated fields:',
    '{',
    '  "<fieldName>": <translated value in the same shape as the source>,',
    '  ...',
    '}',
    '',
    'Preserve every nested object structure verbatim — only the human-readable text changes.',
    'Do not include any prose outside the JSON. Do not add a code fence.',
  ]
    .filter(Boolean)
    .join('\n');

  const retry = previousIssues?.length
    ? `\n\nA previous attempt was rejected by the reviewer. Address these specific issues:\n${previousIssues
        .map(
          (i) =>
            `- [${i.severity}] ${i.field ? `(${i.field}) ` : ''}${i.description}${
              i.suggestion ? ` — suggestion: ${i.suggestion}` : ''
            }`,
        )
        .join('\n')}\n`
    : '';

  const user = `Translate the following ${type} fields from the source language to ${targetLanguage}.

Source fields:
${JSON.stringify(sourceFields, null, 2)}
${retry}`;

  return { system, user };
}

// ── Translator: Portable Text unit mode ────────────────────────────────────

export interface PtTranslatorPromptParams {
  /** Doc type (for prompt context only). */
  type: string;
  /** Document's other top-level translatable fields, if any. */
  scalarFields: Record<string, string>;
  /** Portable Text translation units. */
  units: TranslationUnit[];
  targetLanguage: string;
  config: PipelineConfig;
  referenceContext?: string;
  previousIssues?: ReviewIssue[];
}

export function buildPtTranslatorPrompt(params: PtTranslatorPromptParams): {
  system: string;
  user: string;
} {
  const { type, scalarFields, units, targetLanguage, config, referenceContext, previousIssues } =
    params;
  const appDescription = config.appDescription ?? DEFAULT_APP_DESCRIPTION;

  const system = [
    `You are translating a "${type}" document for ${appDescription}. The document contains Portable Text content; you will receive structured translation units instead of the raw Portable Text tree.`,
    '',
    header(config, targetLanguage),
    referenceContext?.trim()
      ? `\nReference material (authoritative; defer to it when terminology matches):\n${referenceContext.trim()}`
      : '',
    '',
    'Output format — respond with a single JSON object:',
    '{',
    '  "scalars": { "<fieldName>": "<translated>", ... },',
    '  "units":   { "<id>": "<translated>", ... }',
    '}',
    '',
    'For every unit with "preserveEnglish": true, copy the source text into the translation slot UNCHANGED.',
    'Every unit id must appear in "units". Every scalar field in the request must appear in "scalars".',
    'Do not include any prose outside the JSON. Do not add a code fence.',
  ]
    .filter(Boolean)
    .join('\n');

  const retry = previousIssues?.length
    ? `\n\nA previous attempt was rejected by the reviewer. Address these specific issues:\n${previousIssues
        .map(
          (i) =>
            `- [${i.severity}] ${i.field ? `(${i.field}) ` : ''}${i.description}${
              i.suggestion ? ` — suggestion: ${i.suggestion}` : ''
            }`,
        )
        .join('\n')}\n`
    : '';

  const user = `Translate the following ${type} document from the source language to ${targetLanguage}.

Scalar fields:
${JSON.stringify(scalarFields, null, 2)}

Portable Text translation units (id, text, preserveEnglish, context):
${JSON.stringify(units, null, 2)}
${retry}`;

  return { system, user };
}

// ── Reviewer ───────────────────────────────────────────────────────────────

export interface ReviewerPromptParams {
  type: string;
  /** Source fields the translator was given. */
  source: Record<string, unknown>;
  /** Translator's output. */
  translation: Record<string, unknown>;
  targetLanguage: string;
  config: PipelineConfig;
  attempt: number;
  maxAttempts: number;
  referenceContext?: string;
  priorReviews?: ReadonlyArray<{ attempt: number; verdict: string; issues: ReviewIssue[] }>;
}

export function buildReviewerPrompt(params: ReviewerPromptParams): {
  system: string;
  user: string;
} {
  const {
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
  const appDescription = config.appDescription ?? DEFAULT_APP_DESCRIPTION;

  const system = [
    `You are a QA reviewer for "${type}" document translations in ${appDescription}. You did NOT produce the translation below.`,
    '',
    header(config, targetLanguage),
    referenceContext?.trim()
      ? `\nReference material (authoritative; use to verify terminology):\n${referenceContext.trim()}`
      : '',
    '',
    'You are checking for:',
    '- ACCURACY: same meaning, no additions, no omissions, no drift.',
    '- SHAPE: every translated field has the same nested structure as the source.',
    '- PRESERVED ENGLISH / BRANDS / CITATIONS: are all caller-supplied hard-rule items respected?',
    '- NATURAL PHRASING: does it read as natural target-language text?',
    '',
    'Issue severities:',
    '- "critical" — wrong in a way that could mislead a reader, drop required content, or break the schema. Block this translation.',
    '- "major" — notable quality issues. Flag for human review.',
    '- "minor" — note-worthy concerns a future human reviewer might address.',
    '',
    'Verdict options:',
    '- "approved" — no critical or major issues; translation can ship. Confidence >= 70.',
    '- "needs-human" — at least one major issue OR confidence < 70.',
    '- "rejected" — at least one critical issue. Do NOT publish; pipeline will retry.',
    '',
    'Output format — respond with a single JSON object:',
    '{',
    '  "verdict": "approved" | "needs-human" | "rejected",',
    '  "confidence": <integer 0-100>,',
    '  "issues": [',
    '    {',
    '      "severity": "critical" | "major" | "minor",',
    '      "field": "<field name or path or omit>",',
    '      "description": "<one-sentence problem>",',
    '      "suggestion": "<optional fix>"',
    '    }',
    '  ],',
    '  "notes": "<markdown summary of your review>"',
    '}',
    '',
    'Do not include any prose outside the JSON. Do not add a code fence.',
  ]
    .filter(Boolean)
    .join('\n');

  const history =
    priorReviews && priorReviews.length > 0
      ? `\n\nREVIEW HISTORY for this document (attempt ${attempt} of ${maxAttempts}):\n${priorReviews
          .map(
            (r) =>
              `- Attempt ${r.attempt}: verdict=${r.verdict}, issues=${r.issues.length}\n${r.issues
                .map((i) => `  [${i.severity}] ${i.field ? `(${i.field}) ` : ''}${i.description}`)
                .join('\n')}`,
          )
          .join('\n')}\n\nJudge this new attempt on whether those prior issues are now resolved. On the final attempt (${attempt}/${maxAttempts}), prefer "needs-human" over "rejected" for any remaining minor/major issues so the run can finish.`
      : '';

  const user = `Review this ${type} translation against the source.

Source fields:
${JSON.stringify(source, null, 2)}

Proposed ${targetLanguage} translation:
${JSON.stringify(translation, null, 2)}${history}`;

  return { system, user };
}
