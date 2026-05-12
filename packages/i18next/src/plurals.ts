/**
 * CLDR plural form table + helpers.
 *
 * Reference: https://cldr.unicode.org/index/cldr-spec/plural-rules
 *
 * `DEFAULT_CLDR_PLURALS` covers the most common BCP-47 codes. Callers can
 * extend or override via `PipelineConfig.cldrPlurals`.
 */

import type { PluralCategory } from './types.js';

/** Default plural-category table. Add or override per project as needed. */
export const DEFAULT_CLDR_PLURALS: Record<string, readonly PluralCategory[]> = {
  // English: one + other.
  en: ['one', 'other'] as const,
  // Russian: 4 forms (one, few, many, other).
  ru: ['one', 'few', 'many', 'other'] as const,
  // Hindi: 2 forms.
  hi: ['one', 'other'] as const,
  // Tagalog (Filipino): 1 form in CLDR.
  tl: ['other'] as const,
  // French: one + many (compact-decimal / currency edge cases) + other.
  fr: ['one', 'many', 'other'] as const,
  // Spanish: same shape as French.
  es: ['one', 'many', 'other'] as const,
  // Italian: same shape as French.
  it: ['one', 'many', 'other'] as const,
  // German: 2 forms.
  de: ['one', 'other'] as const,
  // Portuguese (incl. Brazilian): 2 forms.
  pt: ['one', 'other'] as const,
  // Arabic: 6 forms (the full CLDR set).
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'] as const,
  // Chinese: 1 form.
  zh: ['other'] as const,
  // Japanese: 1 form.
  ja: ['other'] as const,
  // Korean: 1 form.
  ko: ['other'] as const,
  // Turkish: 2 forms.
  tr: ['one', 'other'] as const,
  // Romanian: 3 forms (one, few, other).
  ro: ['one', 'few', 'other'] as const,
  // Polish: 3 forms (one, few, many) — note CLDR also has 'other' fallback.
  pl: ['one', 'few', 'many', 'other'] as const,
  // Dutch: 2 forms.
  nl: ['one', 'other'] as const,
};

/** Resolve the plural categories required for a target language. */
export function getPluralCategories(
  lang: string,
  overrides?: Record<string, readonly PluralCategory[]>,
): readonly PluralCategory[] {
  const fromOverride = overrides?.[lang];
  if (fromOverride) return fromOverride;
  const fromDefault = DEFAULT_CLDR_PLURALS[lang];
  if (fromDefault) return fromDefault;
  throw new Error(
    `No CLDR plural categories configured for language "${lang}". ` +
      `Add an entry to PipelineConfig.cldrPlurals for this target.`,
  );
}

/** Produce the set of `_<category>` suffixes required for the target. */
export function expandPluralSuffixes(
  lang: string,
  overrides?: Record<string, readonly PluralCategory[]>,
): string[] {
  return getPluralCategories(lang, overrides).map((cat) => `_${cat}`);
}

/**
 * Compare a translator-returned key set against the CLDR-required category
 * set for a given plural stem. Returns missing/extra keys; empty arrays mean
 * the coverage is exactly right.
 */
export function validatePluralCoverage(
  stem: string,
  keys: string[],
  lang: string,
  overrides?: Record<string, readonly PluralCategory[]>,
): { missing: string[]; extra: string[] } {
  const required = new Set(
    expandPluralSuffixes(lang, overrides).map((s) => `${stem}${s}`),
  );
  const provided = new Set(keys.filter((k) => k.startsWith(`${stem}_`)));
  const missing: string[] = [];
  const extra: string[] = [];
  for (const k of required) if (!provided.has(k)) missing.push(k);
  for (const k of provided) if (!required.has(k)) extra.push(k);
  return { missing, extra };
}
