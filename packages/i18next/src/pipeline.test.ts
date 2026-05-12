/**
 * Pipeline integration test using mocked translator + reviewer.
 *
 * Verifies the orchestrator wires structural validation, verdict
 * reconciliation, checkpointing, and disk writes correctly — without any
 * Claude calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { run } from './pipeline.js';
import type { PipelineConfig, PipelineOptions } from './types.js';

let workspace: string;
let sourceDir: string;
let checkpointDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
  sourceDir = path.join(workspace, 'locales');
  checkpointDir = path.join(workspace, '.checkpoint');
  fs.mkdirSync(path.join(sourceDir, 'en'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'en', 'common.json'),
    JSON.stringify(
      {
        welcome: 'Hello {{name}}',
        days_one: '{{count}} day',
        days_other: '{{count}} days',
      },
      null,
      2,
    ),
  );
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function baseConfig(): PipelineConfig {
  return {
    sourceDir,
    sourceLanguage: 'en',
    appDescription: 'a test app',
  };
}

function baseOptions(): PipelineOptions {
  return {
    targetLanguage: 'fr',
    namespaces: ['common'],
    checkpointPath: checkpointDir,
    translatorModel: 'mock-translator',
    reviewerModel: 'mock-reviewer',
    diffMode: false,
  };
}

describe('pipeline.run', () => {
  it('writes an approved translation to disk and persists a checkpoint', async () => {
    const options: PipelineOptions = {
      ...baseOptions(),
      mockTranslator: async () => ({
        translations: {
          welcome: 'Bonjour {{name}}',
          days_one: '{{count}} jour',
          days_many: '{{count}} jours',
          days_other: '{{count}} jours',
        },
        raw: '',
      }),
      mockReviewer: async () => ({
        verdict: 'approved',
        confidence: 95,
        issues: [],
        notes: '',
        raw: '',
      }),
    };
    const { results, skipped } = await run({
      client: {} as never,
      config: baseConfig(),
      options,
    });

    expect(skipped).toEqual([]);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.review.verdict).toBe('approved');
    expect(r.translations).not.toBeNull();

    const written = JSON.parse(
      fs.readFileSync(path.join(sourceDir, 'fr', 'common.json'), 'utf-8'),
    );
    expect(written.welcome).toBe('Bonjour {{name}}');

    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(checkpointDir, 'fr-common.json'), 'utf-8'),
    );
    expect(checkpoint.verdict).toBe('approved');
  });

  it('skips a namespace already checkpointed as approved', async () => {
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(
      path.join(checkpointDir, 'fr-common.json'),
      JSON.stringify({
        targetLanguage: 'fr',
        namespace: 'common',
        verdict: 'approved',
        attempts: 1,
        issues: [],
        notes: '',
        totalTranslatorInputTokens: 0,
        totalTranslatorOutputTokens: 0,
        totalReviewerInputTokens: 0,
        totalReviewerOutputTokens: 0,
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    const { results, skipped } = await run({
      client: {} as never,
      config: baseConfig(),
      options: {
        ...baseOptions(),
        mockTranslator: async () => {
          throw new Error('should not be called');
        },
        mockReviewer: async () => {
          throw new Error('should not be called');
        },
      },
    });
    expect(results).toEqual([]);
    expect(skipped).toEqual([{ namespace: 'common', reason: 'checkpoint' }]);
  });

  it('downgrades to needs-human when the reviewer flags a major issue', async () => {
    const options: PipelineOptions = {
      ...baseOptions(),
      mockTranslator: async () => ({
        translations: {
          welcome: 'Bonjour {{name}}',
          days_one: '{{count}} jour',
          days_many: '{{count}} jours',
          days_other: '{{count}} jours',
        },
        raw: '',
      }),
      mockReviewer: async () => ({
        verdict: 'approved',
        confidence: 85,
        issues: [{ severity: 'major', description: 'awkward phrasing' }],
        notes: '',
        raw: '',
      }),
    };
    const { results } = await run({
      client: {} as never,
      config: baseConfig(),
      options,
    });
    expect(results[0]!.review.verdict).toBe('needs-human');
  });

  it('retries when the structural validator finds a critical issue', async () => {
    let txCalls = 0;
    const options: PipelineOptions = {
      ...baseOptions(),
      maxAttempts: 2,
      mockTranslator: async () => {
        txCalls++;
        if (txCalls === 1) {
          // First attempt drops a plural form — structural critical.
          return {
            translations: {
              welcome: 'Bonjour {{name}}',
              days_one: '{{count}} jour',
              days_other: '{{count}} jours',
              // missing days_many for fr
            },
            raw: '',
          };
        }
        return {
          translations: {
            welcome: 'Bonjour {{name}}',
            days_one: '{{count}} jour',
            days_many: '{{count}} jours',
            days_other: '{{count}} jours',
          },
          raw: '',
        };
      },
      mockReviewer: async () => ({
        verdict: 'approved',
        confidence: 92,
        issues: [],
        notes: '',
        raw: '',
      }),
    };
    const { results } = await run({
      client: {} as never,
      config: baseConfig(),
      options,
    });
    expect(txCalls).toBe(2);
    expect(results[0]!.review.verdict).toBe('approved');
    expect(results[0]!.attempts).toBe(2);
  });
});
