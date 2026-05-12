/**
 * Glossary block renderer.
 *
 * Stochastic generation drifts on technical vocabulary — the same concept
 * gets three different spellings across a long run. The fix is to inject a
 * compact EN→target table into the system prompt so the right form is
 * mechanical rather than probabilistic.
 *
 * `renderGlossary` produces a bullet list ready to drop into a prompt:
 *
 *     - plaintiff → demandeur
 *     - defendant → défendeur
 *     - injunction → injonction
 *
 * The glossary content is entirely caller-supplied. This module has no
 * baked-in vocabulary for any domain.
 */

/** A single EN → target-language vocabulary entry. */
export interface GlossaryEntry {
  /** English source term (lowercase canonical form recommended). */
  en: string;
  /** Target-language form. */
  target: string;
}

/** Render a glossary as a bullet-list block suitable for prompt injection. */
export function renderGlossary(
  targetLanguage: string,
  entries: ReadonlyArray<GlossaryEntry>,
  options: { header?: string } = {},
): string {
  if (entries.length === 0) return '';
  const header =
    options.header ??
    `REQUIRED TERMINOLOGY for ${targetLanguage} — use exactly these forms:`;
  const lines = entries.map((e) => `- ${e.en} → ${e.target}`);
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Detect terms in the source that have a glossary entry but whose translation
 * does not use the required target form. Returns the entries that drifted.
 *
 * Case-insensitive on the source side; exact substring match on the target
 * side. False positives are possible on very short target strings (e.g. "EU")
 * inside longer words — callers may want to wrap matches with word boundaries
 * for their specific language.
 */
export function findGlossaryDrift(
  source: string,
  translation: string,
  entries: ReadonlyArray<GlossaryEntry>,
): GlossaryEntry[] {
  const sourceLc = source.toLowerCase();
  const drifted: GlossaryEntry[] = [];
  for (const e of entries) {
    if (!sourceLc.includes(e.en.toLowerCase())) continue;
    if (!translation.includes(e.target)) drifted.push(e);
  }
  return drifted;
}
