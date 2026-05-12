/**
 * Diff-mode source subsetting.
 *
 * In diff mode the pipeline only sends to the translator the keys that are
 * missing from, or still mirroring English in, the target locale file. This
 * eliminates the failure mode where a full re-run regresses every previously
 * translated string just because one new English key was added.
 *
 * Rules:
 *   1. Walk the source bundle. For every leaf whose target value differs from
 *      the source, treat the key as "already translated" and skip.
 *   2. Plural-group atomicity — if ANY leaf in a plural group is missing or
 *      mirrors source, include the WHOLE group. Splitting a plural group
 *      across runs breaks structural validation.
 *   3. Frozen keys are excluded from the subset unless `ignoreFreeze` is set.
 */

import { isFrozen, type CompiledFreezeManifest } from './freeze.js';
import {
  detectPluralStem,
  flattenBundle,
  loadBundle,
  setAtPath,
} from './loader.js';
import type { LocaleBundle } from './types.js';

export interface DiffSubset {
  subset: LocaleBundle;
  subsetCount: number;
  reasons: {
    missing: string[];
    sourceMirror: string[];
    pluralPullIn: string[];
    skippedFrozen: string[];
  };
}

export interface BuildDiffParams {
  sourceDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  namespace: string;
  freezeManifest?: CompiledFreezeManifest;
  ignoreFreeze?: boolean;
}

export function buildDiffSubset(params: BuildDiffParams): DiffSubset {
  const {
    sourceDir,
    sourceLanguage,
    targetLanguage,
    namespace,
    freezeManifest,
    ignoreFreeze = false,
  } = params;

  const sourceBundle = loadBundle({ sourceDir, lang: sourceLanguage, namespace });
  const sourceFlat = flattenBundle(sourceBundle);

  let targetFlat: Map<string, string>;
  try {
    targetFlat = new Map(
      flattenBundle(loadBundle({ sourceDir, lang: targetLanguage, namespace })).map(
        (e) => [e.path, e.value],
      ),
    );
  } catch {
    targetFlat = new Map();
  }

  const reasons: DiffSubset['reasons'] = {
    missing: [],
    sourceMirror: [],
    pluralPullIn: [],
    skippedFrozen: [],
  };
  const includedStems = new Set<string>();
  const directIncludes = new Set<string>();

  for (const { path: keyPath, value } of sourceFlat) {
    if (!ignoreFreeze && freezeManifest && isFrozen(freezeManifest, namespace, keyPath)) {
      reasons.skippedFrozen.push(keyPath);
      continue;
    }
    const stem = detectPluralStem(keyPath);
    const targetValue = targetFlat.get(keyPath);
    const isMissing = targetValue === undefined;
    const isSourceMirror = !isMissing && targetValue === value;
    if (!isMissing && !isSourceMirror) continue;
    if (stem) includedStems.add(stem);
    else directIncludes.add(keyPath);
    if (isMissing) reasons.missing.push(keyPath);
    else reasons.sourceMirror.push(keyPath);
  }

  // Pull in every leaf belonging to an included plural stem (atomicity).
  const finalPaths = new Set(directIncludes);
  for (const { path: keyPath } of sourceFlat) {
    const stem = detectPluralStem(keyPath);
    if (!stem || !includedStems.has(stem)) continue;
    if (!finalPaths.has(keyPath)) {
      if (
        !reasons.missing.includes(keyPath) &&
        !reasons.sourceMirror.includes(keyPath)
      ) {
        reasons.pluralPullIn.push(keyPath);
      }
      finalPaths.add(keyPath);
    }
  }

  const subset: LocaleBundle = {};
  for (const { path: keyPath, value } of sourceFlat) {
    if (!finalPaths.has(keyPath)) continue;
    setAtPath(subset, keyPath, value);
  }

  return { subset, subsetCount: finalPaths.size, reasons };
}
