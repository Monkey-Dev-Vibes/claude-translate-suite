/**
 * Interpolation-variable preservation for i18next-style strings.
 *
 * Source strings use `{{varName}}` placeholders, e.g.
 *   "passwordMinLength": "Password must be at least {{count}} characters"
 *
 * Translations MUST preserve the same set of placeholders verbatim. If the
 * translator drops one, renames it, or translates it, the runtime renders
 * `{{count}}` literally — a UX bug. This module extracts and compares
 * placeholder sets so the pipeline can flag drift as a critical issue.
 */

const INTERP_RE = /\{\{\s*([^}\s|,]+)[^}]*\}\}/g;

/** Extract unique variable names from an i18next-style string. */
export function extractInterpolationVars(text: string): string[] {
  const vars = new Set<string>();
  for (const m of text.matchAll(INTERP_RE)) {
    if (m[1]) vars.add(m[1]);
  }
  return Array.from(vars).sort();
}

/** Compare placeholder sets between source and translation. */
export function compareInterpolation(
  source: string,
  translation: string,
): { missing: string[]; extra: string[] } {
  const srcVars = new Set(extractInterpolationVars(source));
  const tgtVars = new Set(extractInterpolationVars(translation));
  const missing = Array.from(srcVars).filter((v) => !tgtVars.has(v)).sort();
  const extra = Array.from(tgtVars).filter((v) => !srcVars.has(v)).sort();
  return { missing, extra };
}
