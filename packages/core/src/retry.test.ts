import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';
import { PipelineParseError } from './parse.js';

describe('withRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry non-retryable errors', async () => {
    const err = new TypeError('bug');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a PipelineParseError once', async () => {
    const parseErr = new PipelineParseError('bad', 'raw');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(parseErr)
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a PipelineParseError twice in a row', async () => {
    const parseErr = new PipelineParseError('bad', 'raw');
    const fn = vi.fn().mockRejectedValue(parseErr);
    await expect(
      withRetry(fn, { baseDelayMs: 1, maxAttempts: 5 }),
    ).rejects.toThrow(PipelineParseError);
    // 1st call throws, retry permitted; 2nd call throws, retry NOT permitted (cap is 1)
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries ECONNRESET as a transport failure', async () => {
    const transportErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transportErr)
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries bare "Connection error." strings', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection error.'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects maxAttempts and rethrows the last error', async () => {
    const transportErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fn = vi.fn().mockRejectedValue(transportErr);
    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow(transportErr);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('invokes the log callback on each retry', async () => {
    const log = vi.fn();
    const transportErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transportErr)
      .mockResolvedValue('ok');
    await withRetry(fn, { baseDelayMs: 1, log });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
