/**
 * @monkey-dev-vibes/claude-translate-core
 *
 * Reusable primitives for Claude-powered translation pipelines.
 */

export {
  PipelineParseError,
  stripCodeFence,
  safeParseJson,
  parseReviewerResponse,
  reconcileVerdict,
} from './parse.js';
export type {
  Severity,
  Verdict,
  ParsedIssue,
  ParsedReviewerResponse,
} from './parse.js';

export { withRetry } from './retry.js';
export type { RetryOptions } from './retry.js';

export {
  STREAMING_MIN_TOKENS,
  callClaude,
  callClaudeWithParser,
} from './claude.js';
export type { ClaudeCallParams, ClaudeCallResult } from './claude.js';

export { renderGlossary, findGlossaryDrift } from './glossary.js';
export type { GlossaryEntry } from './glossary.js';

export { GENERIC_HARD_RULES, buildHardRulesBlock } from './hard-rules.js';
export type { HardRulesOptions } from './hard-rules.js';
