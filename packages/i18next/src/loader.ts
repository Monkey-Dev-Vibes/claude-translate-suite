/**
 * Locale JSON loader. Reads `<sourceDir>/<lang>/<namespace>.json`, flattens
 * nested objects to dotted-key leaves, detects i18next plural groups,
 * extracts interpolation variables.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { extractInterpolationVars } from './interpolation.js';
import type { Leaf, LocaleBundle, PluralGroup } from './types.js';

export interface LoadParams {
  sourceDir: string;
  lang: string;
  namespace: string;
}

/** Read and parse a single locale JSON file. */
export function loadBundle(params: LoadParams): LocaleBundle {
  const { sourceDir, lang, namespace } = params;
  const filePath = path.join(sourceDir, lang, `${namespace}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Locale file is not a JSON object: ${filePath}`);
  }
  return parsed as LocaleBundle;
}

/** List namespace file stems in `<sourceDir>/<lang>/` (auto-discover). */
export function listNamespaces(sourceDir: string, lang: string): string[] {
  const dir = path.join(sourceDir, lang);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Walk a bundle depth-first; emit one entry per string leaf. */
export function flattenBundle(bundle: LocaleBundle): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  function walk(node: LocaleBundle, prefix: string): void {
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') {
        out.push({ path: p, value: v });
      } else if (v && typeof v === 'object') {
        walk(v, p);
      }
    }
  }
  walk(bundle, '');
  return out;
}

const PLURAL_SUFFIX_RE = /_(one|other|few|many|zero|two)$/;

/** Strip a trailing CLDR `_<category>` suffix. Returns null for non-plural leaves. */
export function detectPluralStem(keyPath: string): string | null {
  const match = keyPath.match(PLURAL_SUFFIX_RE);
  if (!match) return null;
  return keyPath.slice(0, -match[0].length);
}

/** Full loader — every leaf with its plural/interpolation metadata. */
export function loadLeaves(params: LoadParams): Leaf[] {
  const bundle = loadBundle(params);
  return flattenBundle(bundle).map(({ path: keyPath, value }) => ({
    path: keyPath,
    en: value,
    pluralStem: detectPluralStem(keyPath),
    interpolationVars: extractInterpolationVars(value),
  }));
}

/** Group leaves by plural stem. Only emits stems with both `_one` and `_other`. */
export function groupPlurals(leaves: readonly Leaf[]): PluralGroup[] {
  const byStem = new Map<string, { one?: Leaf; other?: Leaf }>();
  for (const leaf of leaves) {
    if (!leaf.pluralStem) continue;
    const suffix = leaf.path.slice(leaf.pluralStem.length);
    const entry = byStem.get(leaf.pluralStem) ?? {};
    if (suffix === '_one') entry.one = leaf;
    else if (suffix === '_other') entry.other = leaf;
    byStem.set(leaf.pluralStem, entry);
  }
  const groups: PluralGroup[] = [];
  for (const [stem, { one, other }] of byStem) {
    if (one && other) groups.push({ stem, one, other });
  }
  return groups;
}

/** Set a value at a dotted path; create intermediate objects as needed. */
export function setAtPath(
  bundle: LocaleBundle,
  dottedPath: string,
  value: string,
): void {
  const parts = dottedPath.split('.');
  let cursor: LocaleBundle = bundle;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cursor[part];
    if (!next || typeof next === 'string') {
      const fresh: LocaleBundle = {};
      cursor[part] = fresh;
      cursor = fresh;
    } else {
      cursor = next;
    }
  }
  cursor[parts[parts.length - 1]!] = value;
}
