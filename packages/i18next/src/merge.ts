/**
 * Merge translator output back into the on-disk locale file.
 *
 * Honours the freeze manifest: any pattern-matching key with an existing
 * on-disk value is preserved verbatim. Performs atomic writes (tmp + rename)
 * so a killed process never leaves a partially-written JSON file that would
 * crash the runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isFrozen, type CompiledFreezeManifest } from './freeze.js';
import { flattenBundle, loadBundle, setAtPath } from './loader.js';
import type { LocaleBundle } from './types.js';

/** Build a nested bundle from a flat dotted-key map. */
export function nestFlatMap(flat: Record<string, string>): LocaleBundle {
  const bundle: LocaleBundle = {};
  const keys = Object.keys(flat).sort();
  for (const k of keys) {
    setAtPath(bundle, k, flat[k]!);
  }
  return bundle;
}

/** Deep-merge `patch` onto `base`. Patch wins; returns a fresh object. */
export function deepMerge(base: LocaleBundle, patch: LocaleBundle): LocaleBundle {
  const out: LocaleBundle = structuredClone(base);
  function apply(into: LocaleBundle, from: LocaleBundle): void {
    for (const [k, v] of Object.entries(from)) {
      const existing = into[k];
      if (typeof v === 'string') {
        into[k] = v;
      } else if (v && typeof v === 'object') {
        if (!existing || typeof existing === 'string') {
          into[k] = structuredClone(v);
        } else {
          apply(existing, v);
        }
      }
    }
  }
  apply(out, patch);
  return out;
}

function readExistingTarget(
  sourceDir: string,
  lang: string,
  namespace: string,
): LocaleBundle {
  try {
    return loadBundle({ sourceDir, lang, namespace });
  } catch {
    return {};
  }
}

export interface WriteDiff {
  added: string[];
  overwrittenManualEdits: string[];
  overwrittenSourceMirrors: string[];
  unchanged: string[];
  skippedFrozen: string[];
}

export interface DiffWriteParams {
  sourceDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  namespace: string;
  translations: Record<string, string>;
  freezeManifest?: CompiledFreezeManifest;
  ignoreFreeze?: boolean;
}

/** Compute what a write would change, without writing. */
export function diffWrite(params: DiffWriteParams): WriteDiff {
  const {
    sourceDir,
    sourceLanguage,
    targetLanguage,
    namespace,
    translations,
    freezeManifest,
    ignoreFreeze = false,
  } = params;
  const existing = readExistingTarget(sourceDir, targetLanguage, namespace);
  const existingFlat = new Map(
    flattenBundle(existing).map((e) => [e.path, e.value]),
  );
  let sourceFlat: Map<string, string> | null = null;
  const getSource = (): Map<string, string> => {
    if (!sourceFlat) {
      try {
        const src = loadBundle({ sourceDir, lang: sourceLanguage, namespace });
        sourceFlat = new Map(flattenBundle(src).map((e) => [e.path, e.value]));
      } catch {
        sourceFlat = new Map();
      }
    }
    return sourceFlat;
  };

  const diff: WriteDiff = {
    added: [],
    overwrittenManualEdits: [],
    overwrittenSourceMirrors: [],
    unchanged: [],
    skippedFrozen: [],
  };
  for (const [p, newValue] of Object.entries(translations)) {
    const existingValue = existingFlat.get(p);
    if (
      !ignoreFreeze &&
      freezeManifest &&
      existingValue !== undefined &&
      isFrozen(freezeManifest, namespace, p)
    ) {
      if (existingValue !== newValue) diff.skippedFrozen.push(p);
      else diff.unchanged.push(p);
      continue;
    }
    if (existingValue === undefined) {
      diff.added.push(p);
    } else if (existingValue === newValue) {
      diff.unchanged.push(p);
    } else {
      const srcValue = getSource().get(p);
      if (existingValue === srcValue) {
        diff.overwrittenSourceMirrors.push(p);
      } else {
        diff.overwrittenManualEdits.push(p);
      }
    }
  }
  return diff;
}

/** Strip frozen entries from a patch before merging. */
export function applyFreezeFilter(params: {
  sourceDir: string;
  targetLanguage: string;
  namespace: string;
  translations: Record<string, string>;
  freezeManifest?: CompiledFreezeManifest;
  ignoreFreeze?: boolean;
}): Record<string, string> {
  const {
    sourceDir,
    targetLanguage,
    namespace,
    translations,
    freezeManifest,
    ignoreFreeze = false,
  } = params;
  if (ignoreFreeze || !freezeManifest) return { ...translations };
  const existing = readExistingTarget(sourceDir, targetLanguage, namespace);
  const existingFlat = new Map(
    flattenBundle(existing).map((e) => [e.path, e.value]),
  );
  const out: Record<string, string> = {};
  for (const [p, newValue] of Object.entries(translations)) {
    if (existingFlat.has(p) && isFrozen(freezeManifest, namespace, p)) continue;
    out[p] = newValue;
  }
  return out;
}

export interface WriteParams {
  sourceDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  namespace: string;
  translations: Record<string, string>;
  mergeWithExisting?: boolean;
  freezeManifest?: CompiledFreezeManifest;
  ignoreFreeze?: boolean;
  dryRun?: boolean;
}

export interface WriteResult {
  outputPath: string;
  wrote: boolean;
  finalBundle: LocaleBundle;
  diff: WriteDiff;
}

/** Atomic write of translator output. Honours frozen-keys and dry-run. */
export function writeTranslatedNamespace(params: WriteParams): WriteResult {
  const {
    sourceDir,
    sourceLanguage,
    targetLanguage,
    namespace,
    translations,
    mergeWithExisting = true,
    freezeManifest,
    ignoreFreeze = false,
    dryRun = false,
  } = params;
  const diff = diffWrite({
    sourceDir,
    sourceLanguage,
    targetLanguage,
    namespace,
    translations,
    freezeManifest,
    ignoreFreeze,
  });
  const filtered = applyFreezeFilter({
    sourceDir,
    targetLanguage,
    namespace,
    translations,
    freezeManifest,
    ignoreFreeze,
  });
  const patch = nestFlatMap(filtered);
  const existing = mergeWithExisting
    ? readExistingTarget(sourceDir, targetLanguage, namespace)
    : {};
  const finalBundle = deepMerge(existing, patch);
  const outputPath = path.join(sourceDir, targetLanguage, `${namespace}.json`);

  if (dryRun) return { outputPath, wrote: false, finalBundle, diff };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(finalBundle, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, outputPath);
  return { outputPath, wrote: true, finalBundle, diff };
}
