/**
 * Hard-rules block renderer.
 *
 * "Hard rules" are caller-supplied directives injected into translator and
 * reviewer prompts as a single labelled block. They override translation
 * convenience: brand names that stay in English, regulation citations that
 * are preserved verbatim, interpolation tokens that must round-trip
 * unchanged.
 *
 * The package ships TWO things:
 *
 *   - `buildHardRulesBlock(rules)` — formats a caller-supplied list as a
 *     numbered block ready to drop into a prompt.
 *
 *   - `GENERIC_HARD_RULES` — a small set of rules that apply to virtually
 *     every i18n/CMS translation use case (preserve interpolation tokens,
 *     preserve numbers + units, preserve HTML/markdown structure). Use
 *     these as a baseline and append your domain-specific rules.
 *
 * The package has NO domain content baked in — no industry abbreviations,
 * no regulation citations, no preserved brand names. All of that comes
 * from your config.
 */

/**
 * A small set of always-on rules that apply across virtually all i18n/CMS
 * translation use cases. Append your own domain rules to this list.
 */
export const GENERIC_HARD_RULES: string[] = [
  'Interpolation tokens such as {{name}}, {0}, %s, ${variable}, <0></0> are preserved EXACTLY in position, spelling, and count. Do not translate the names inside braces. Do not invent new tokens.',
  'Numerical values and their units are preserved exactly (e.g. "5 km", "10%", "$25", "3:30 PM"). Do not convert between unit systems unless explicitly told to.',
  'HTML tags, markdown syntax (** _ # ` []() etc.), and JSON/structured-data delimiters are preserved verbatim. Translate the human-readable text inside them, not the tags themselves.',
  'URLs, email addresses, file paths, code identifiers, and ISO 8601 dates/times are preserved verbatim.',
];

export interface HardRulesOptions {
  /** Header line above the numbered rules. */
  header?: string;
  /** If true, prepend `GENERIC_HARD_RULES` to the user-supplied list. */
  includeGeneric?: boolean;
}

/**
 * Render a list of rules as a numbered block suitable for prompt injection.
 *
 * Pass `includeGeneric: true` to prepend the always-on baseline rules
 * (interpolation tokens, numerical units, markup, URLs/dates).
 */
export function buildHardRulesBlock(
  rules: ReadonlyArray<string>,
  options: HardRulesOptions = {},
): string {
  const header =
    options.header ?? 'HARD RULES — these override any translation convenience:';
  const all = options.includeGeneric ? [...GENERIC_HARD_RULES, ...rules] : [...rules];
  if (all.length === 0) return '';
  const numbered = all.map((r, i) => `${i + 1}. ${r}`);
  return `${header}\n${numbered.join('\n')}`;
}
