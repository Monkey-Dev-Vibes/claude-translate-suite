/**
 * @monkey-dev-vibes/claude-translate-i18next
 *
 * Two-pass Claude translation pipeline for i18next-style JSON locale files.
 */

export type {
  LocaleBundle,
  PluralCategory,
  Leaf,
  PluralGroup,
  ReviewIssue,
  TranslatorOutput,
  ReviewerOutput,
  NamespaceResult,
  PipelineConfig,
  PipelineOptions,
} from './types.js';

export {
  DEFAULT_CLDR_PLURALS,
  getPluralCategories,
  expandPluralSuffixes,
  validatePluralCoverage,
} from './plurals.js';

export { extractInterpolationVars, compareInterpolation } from './interpolation.js';

export {
  loadBundle,
  flattenBundle,
  detectPluralStem,
  loadLeaves,
  groupPlurals,
  setAtPath,
  listNamespaces,
} from './loader.js';

export {
  loadFreezeManifest,
  compilePattern,
  isFrozen,
  getNamespaceFrozenPatterns,
} from './freeze.js';
export type { CompiledFreezeManifest } from './freeze.js';

export { buildDiffSubset } from './diff.js';
export type { DiffSubset, BuildDiffParams } from './diff.js';

export {
  parseTranslatorResponse,
  parseReviewerResponse,
  structuralIssues,
} from './validate.js';

export {
  nestFlatMap,
  deepMerge,
  diffWrite,
  applyFreezeFilter,
  writeTranslatedNamespace,
} from './merge.js';
export type { WriteParams, WriteResult, WriteDiff } from './merge.js';

export { translate } from './translator.js';
export { review } from './reviewer.js';
export { CheckpointStore } from './checkpoint.js';
export type { CheckpointEntry } from './checkpoint.js';

export { buildTranslatorPrompt, buildReviewerPrompt } from './prompts.js';

export { run } from './pipeline.js';
export type { RunResult } from './pipeline.js';
