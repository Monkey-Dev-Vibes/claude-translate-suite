/**
 * @monkey-dev-vibes/claude-translate-sanity
 *
 * Two-pass Claude translation pipeline for Sanity CMS documents.
 */

export type {
  SanityDocument,
  PortableTextBlock,
  ReviewIssue,
  TranslatorOutput,
  ReviewerOutput,
  PipelineResult,
  DocTypeConfig,
  PreservedMark,
  PipelineConfig,
  PipelineOptions,
} from './types.js';

export {
  createSanityClient,
  fetchSourceDocs,
  translationId,
  verdictToStatus,
  sanitiseReviewNotes,
  writeTranslation,
  stripForPrompt,
} from './sanity.js';
export type {
  CreateClientOptions,
  WriteTranslationParams,
} from './sanity.js';

export { extractUnits, applyTranslations } from './portable-text.js';
export type { TranslationUnit } from './portable-text.js';

export {
  parseTranslatorResponse,
  parsePtTranslatorResponse,
  parseReviewerResponse,
} from './validate.js';
export type { PtTranslatorResponse } from './validate.js';

export { translate } from './translator.js';
export { review } from './reviewer.js';
export {
  buildTranslatorPrompt,
  buildPtTranslatorPrompt,
  buildReviewerPrompt,
} from './prompts.js';

export { CheckpointStore } from './checkpoint.js';
export type { CheckpointEntry, EntryStatus } from './checkpoint.js';

export { run } from './pipeline.js';
export type { RunResult } from './pipeline.js';

export { refineNeedsHuman } from './refine.js';
export type { RefineResult } from './refine.js';
