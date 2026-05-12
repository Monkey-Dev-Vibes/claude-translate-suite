/**
 * Prompt builders for the i18next translation pipeline.
 *
 * The prompts are deliberately content-neutral — they describe a generic
 * "application UI string" translation task. All domain context (brand names,
 * jargon, register conventions, regulation citations) is injected via the
 * caller's `PipelineConfig`:
 *
 *   - `appDescription`  — one-line context for the model.
 *   - `domainRules`     — composed via `buildHardRulesBlock` from core.
 *   - `glossaryBlocks`  — composed via `renderGlossary` from core, keyed by lang.
 *   - `languageNotes`   — free-form per-language notes (register, plural quirks,
 *                          script conventions).
 */

import type { ReviewIssue, LocaleBundle, PluralCategory, PipelineConfig } from './types.js';
import { getPluralCategories } from './plurals.js';

const DEFAULT_APP_DESCRIPTION = 'an application user interface';

/** Generic, always-on rules for i18next-style UI translation. */
function builtInUiRules(): string {
  return `
UI-A. Interpolation variables like {{count}}, {{name}}, {{current}}, {{total}} are template placeholders. They MUST appear verbatim in every translation — same variable name (the identifier between \`{{\` and the first space, comma, or pipe), same curly braces, same formatter arguments if present (e.g. \`{{count, number}}\` stays as \`{{count, number}}\`). Do NOT translate the variable name. Do NOT drop any variable from the source.

UI-B. Plural keys (keys ending in _one, _other, _few, _many, _zero, _two) indicate i18next plural groups. For each _one/_other pair in the English source, produce EXACTLY the CLDR plural categories required for the target language and NO OTHERS. Every expected category must be present and non-empty.

UI-C. The output JSON must have the SAME dotted-key paths as the input, except where UI-B requires plural-category expansion (or collapse, for languages with only "other"). Do not rename keys. Do not nest differently. Do not add keys that weren't in the source (except for expanded plural categories).

UI-D. UI copy should be as concise as the source. If the source is 2 words, the translation should not be 10 words. Prefer natural terse phrasing over literal word-for-word translation.

UI-E. Preserve interpolation tokens, numerical values, URLs, dates, code identifiers, brand names, and HTML/markdown markup verbatim. Translate only the human-readable text.`.trim();
}

function pluralLabel(cats: readonly PluralCategory[]): string {
  return cats.join(', ');
}

export interface TranslatorPromptParams {
  namespace: string;
  source: LocaleBundle;
  targetLanguage: string;
  config: PipelineConfig;
  previousIssues?: ReviewIssue[];
}

export function buildTranslatorPrompt(params: TranslatorPromptParams): {
  system: string;
  user: string;
} {
  const { namespace, source, targetLanguage, config, previousIssues } = params;
  const cats = getPluralCategories(targetLanguage, config.cldrPlurals);
  const appDescription = config.appDescription ?? DEFAULT_APP_DESCRIPTION;
  const domainRules = config.domainRules?.trim();
  const glossary = config.glossaryBlocks?.[targetLanguage]?.trim();
  const note = config.languageNotes?.[targetLanguage]?.trim();

  const system = [
    `You are translating UI copy for ${appDescription}. The content below is i18next-style locale JSON for the "${namespace}" namespace.`,
    ``,
    `Target language code: ${targetLanguage}. CLDR plural categories required: ${pluralLabel(cats)}.`,
    ``,
    builtInUiRules(),
    domainRules ? `\n${domainRules}` : '',
    glossary ? `\n${glossary}` : '',
    note ? `\nLanguage notes:\n${note}` : '',
    ``,
    `Output format — respond with a single JSON object:`,
    `{`,
    `  "translations": {`,
    `    "<dotted.key.path>": "<translated string>",`,
    `    ...`,
    `  }`,
    `}`,
    ``,
    `Every string leaf in the source must appear once in "translations". For plural groups (any source key ending in _one or _other), emit ALL required target-language categories instead of just _one/_other.`,
    ``,
    `Do not include any prose outside the JSON. Do not add a code fence.`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const retryBlock = previousIssues?.length
    ? `\n\nA previous attempt was rejected by the reviewer. Address these specific issues this time:\n${previousIssues
        .map(
          (i) =>
            `- [${i.severity}] ${i.key ? `(${i.key}) ` : ''}${i.description}${
              i.suggestion ? ` — suggestion: ${i.suggestion}` : ''
            }`,
        )
        .join('\n')}\n`
    : '';

  const user = `Translate the following ${namespace} namespace from the source language to ${targetLanguage}.

Source JSON:
${JSON.stringify(source, null, 2)}
${retryBlock}`;

  return { system, user };
}

export interface ReviewerPromptParams {
  namespace: string;
  source: LocaleBundle;
  translation: Record<string, string>;
  targetLanguage: string;
  config: PipelineConfig;
  attempt: number;
  maxAttempts: number;
  priorReviews?: ReadonlyArray<{ attempt: number; verdict: string; issues: ReviewIssue[] }>;
}

export function buildReviewerPrompt(params: ReviewerPromptParams): {
  system: string;
  user: string;
} {
  const {
    namespace,
    source,
    translation,
    targetLanguage,
    config,
    attempt,
    maxAttempts,
    priorReviews,
  } = params;
  const cats = getPluralCategories(targetLanguage, config.cldrPlurals);
  const appDescription = config.appDescription ?? DEFAULT_APP_DESCRIPTION;
  const domainRules = config.domainRules?.trim();
  const glossary = config.glossaryBlocks?.[targetLanguage]?.trim();
  const note = config.languageNotes?.[targetLanguage]?.trim();

  const system = [
    `You are a QA reviewer for UI translations in ${appDescription}. You did NOT produce the translation below. Your job is to audit it against the source and flag any issues BEFORE the translation is shown to users.`,
    ``,
    `Target language code: ${targetLanguage}. CLDR plural categories required: ${pluralLabel(cats)}.`,
    ``,
    builtInUiRules(),
    domainRules ? `\n${domainRules}` : '',
    glossary ? `\n${glossary}` : '',
    note ? `\nLanguage notes:\n${note}` : '',
    ``,
    `You are checking for:`,
    `- ACCURACY: does the translation convey the same meaning as the source? No additions, omissions, or drift.`,
    `- INTERPOLATION: does every translated string contain the same {{variable}} placeholders as its source?`,
    `- PLURAL COVERAGE: for every plural group, does the translation contain exactly the CLDR categories required (${pluralLabel(cats)})?`,
    `- SHAPE: are the dotted-key paths in "translations" the same as the source (modulo plural expansion)?`,
    `- NATURAL PHRASING: does it read as natural ${targetLanguage} UI copy?`,
    `- LENGTH: is the translation similar in visual weight to the source? UI buttons that balloon out may break layouts.`,
    `- PRESERVED ENGLISH / BRANDS / CITATIONS: are all caller-supplied hard-rule items respected?`,
    ``,
    `Issue severities:`,
    `- "critical" — wrong in a way that could mislead a user, break the UI, or drop required placeholders / plural forms. Block this translation.`,
    `- "major" — notable quality issues (awkward phrasing, wrong register, verbose) but not dangerously wrong. Flag for human review.`,
    `- "minor" — note-worthy concerns a future human reviewer might address.`,
    ``,
    `Verdict options:`,
    `- "approved" — no critical or major issues; translation can ship. Confidence >= 70.`,
    `- "needs-human" — at least one major issue OR confidence < 70.`,
    `- "rejected" — at least one critical issue. Do NOT publish; pipeline will retry.`,
    ``,
    `Output format — respond with a single JSON object:`,
    `{`,
    `  "verdict": "approved" | "needs-human" | "rejected",`,
    `  "confidence": <integer 0-100>,`,
    `  "issues": [`,
    `    {`,
    `      "severity": "critical" | "major" | "minor",`,
    `      "key": "<dotted key path or omit>",`,
    `      "description": "<one-sentence problem>",`,
    `      "suggestion": "<optional fix>"`,
    `    }`,
    `  ],`,
    `  "notes": "<markdown summary of your review>"`,
    `}`,
    ``,
    `Do not include any prose outside the JSON. Do not add a code fence.`,
  ].join('\n');

  const historyBlock =
    priorReviews && priorReviews.length > 0
      ? `\n\nREVIEW HISTORY for this namespace (attempt ${attempt} of ${maxAttempts}):\n${priorReviews
          .map(
            (r) =>
              `- Attempt ${r.attempt}: verdict=${r.verdict}, issues=${r.issues.length}\n${r.issues
                .map((i) => `  [${i.severity}] ${i.key ? `(${i.key}) ` : ''}${i.description}`)
                .join('\n')}`,
          )
          .join('\n')}\n\nJudge this new attempt on whether those prior issues are now resolved. On the final attempt (${attempt}/${maxAttempts}), prefer "needs-human" over "rejected" for any remaining minor/major issues so the run can still finish.`
      : '';

  const user = `Review this ${namespace} namespace translation against the source.

Source JSON (namespace: ${namespace}):
${JSON.stringify(source, null, 2)}

Proposed ${targetLanguage} translation (flat dotted-key map):
${JSON.stringify(translation, null, 2)}${historyBlock}`;

  return { system, user };
}
