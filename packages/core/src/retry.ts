/**
 * Exponential-backoff retry wrapper for Claude API calls.
 *
 * Retries:
 *   - Anthropic rate-limit (429) and 5xx server errors.
 *   - Common transport failures (ECONNRESET, ETIMEDOUT, fetch aborts, bare
 *     "Connection error." strings sometimes surfaced by the SDK without a
 *     status code).
 *   - `PipelineParseError` once — covers the case where the model truncates
 *     output and emits invalid JSON. Capped at one retry because repeated
 *     parse failures are structural, not transient.
 *
 * Does NOT retry:
 *   - 4xx authentication / bad-request errors (those are bugs).
 *   - Any error not matched above.
 */

import Anthropic from '@anthropic-ai/sdk';

import { PipelineParseError } from './parse.js';

export interface RetryOptions {
  /** Max attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms; actual delay = base * 2^attemptIndex. Default 1000. */
  baseDelayMs?: number;
  /** Optional logger for backoff notifications. */
  log?: (message: string) => void;
}

function isRetryable(err: unknown, attemptIndex: number): boolean {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return true;
    if (err.status !== undefined && err.status >= 500 && err.status < 600) return true;
    return false;
  }
  if (err instanceof PipelineParseError) {
    return attemptIndex < 1;
  }
  if (err && typeof err === 'object') {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'UND_ERR_SOCKET') return true;
    if (e.name === 'AbortError') return true;
    if (typeof e.message === 'string' && /connection error/i.test(e.message)) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const log = options.log;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err, attempt) || attempt === maxAttempts - 1) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      const reason =
        err instanceof Anthropic.APIError
          ? `status=${err.status}`
          : err instanceof PipelineParseError
            ? 'parse-error'
            : (err as Error)?.message ?? 'unknown';
      log?.(`    retry ${attempt + 1}/${maxAttempts - 1} after ${delay}ms (${reason})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
