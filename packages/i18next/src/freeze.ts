/**
 * Frozen-keys manifest loader + matcher.
 *
 * A "frozen key" is a dotted-path pattern whose translated value, once on
 * disk, must never be overwritten by the pipeline — even if a fresh
 * translator pass produces a different string. Use this to lock down
 * hand-finalised entries (module names, brand strings, legal disclaimers).
 *
 * Manifest file shape (JSON):
 *
 *     {
 *       "_notes": "Free-form description, ignored by the loader.",
 *       "frozenKeys": {
 *         "<namespace>": ["pattern.with.literal.parts", "pattern.with.*.wildcard"],
 *         ...
 *       }
 *     }
 *
 * `*` matches exactly one dotted segment. `**` is reserved and rejected.
 */

import * as fs from 'node:fs';

interface FreezeManifestRaw {
  _notes?: unknown;
  frozenKeys?: Record<string, readonly string[]>;
}

interface CompiledNamespace {
  patterns: readonly string[];
  regexes: readonly RegExp[];
}

export interface CompiledFreezeManifest {
  byNamespace: Map<string, CompiledNamespace>;
}

/**
 * Compile one dotted-path pattern with `*` wildcards into an anchored RegExp.
 *
 * Throws if the pattern uses `**` (reserved for future multi-segment matching
 * — using it now would silently behave like `*`, which is a footgun).
 */
export function compilePattern(pattern: string): RegExp {
  if (pattern.length === 0) {
    throw new Error('Frozen-keys pattern is empty');
  }
  if (pattern.includes('**')) {
    throw new Error(`Frozen-keys pattern uses unsupported '**' wildcard: ${pattern}`);
  }
  const escaped = pattern
    .split('.')
    .map((seg) => {
      if (seg === '*') return '[^.]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Load and compile a freeze manifest file. If `manifestPath` is omitted or
 * the file doesn't exist, returns an empty manifest (nothing is frozen).
 */
export function loadFreezeManifest(manifestPath?: string): CompiledFreezeManifest {
  const byNamespace = new Map<string, CompiledNamespace>();
  if (!manifestPath || !fs.existsSync(manifestPath)) return { byNamespace };
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as FreezeManifestRaw;
  const frozen = parsed.frozenKeys ?? {};
  for (const [ns, patterns] of Object.entries(frozen)) {
    if (!Array.isArray(patterns)) continue;
    byNamespace.set(ns, {
      patterns,
      regexes: patterns.map(compilePattern),
    });
  }
  return { byNamespace };
}

export function getNamespaceFrozenPatterns(
  manifest: CompiledFreezeManifest,
  namespace: string,
): CompiledNamespace {
  return manifest.byNamespace.get(namespace) ?? { patterns: [], regexes: [] };
}

/** Test whether a dotted-path key is frozen in the given namespace. */
export function isFrozen(
  manifest: CompiledFreezeManifest,
  namespace: string,
  dottedKey: string,
): boolean {
  const { regexes } = getNamespaceFrozenPatterns(manifest, namespace);
  for (const re of regexes) {
    if (re.test(dottedKey)) return true;
  }
  return false;
}
