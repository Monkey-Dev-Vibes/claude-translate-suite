/**
 * Pipeline integration test using a fake Sanity client and mocked translator
 * + reviewer. Verifies orchestration, verdict reconciliation, and checkpoint
 * persistence without any network calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { run } from './pipeline.js';
import { CheckpointStore } from './checkpoint.js';
import type {
  PipelineConfig,
  PipelineOptions,
  SanityDocument,
} from './types.js';

let workspace: string;
let checkpointDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sanity-test-'));
  checkpointDir = path.join(workspace, '.checkpoint');
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

interface FakeSanity {
  fetch: ReturnType<typeof Object>;
  createOrReplace: ReturnType<typeof Object>;
  written: Array<Record<string, unknown>>;
}

function fakeSanityClient(docs: SanityDocument[]): FakeSanity {
  const written: Array<Record<string, unknown>> = [];
  const fake: FakeSanity = {
    fetch: async () => docs,
    createOrReplace: async (doc: Record<string, unknown>) => {
      written.push(doc);
      return doc;
    },
    written,
  };
  return fake;
}

function baseConfig(): PipelineConfig {
  return {
    docTypes: {
      article: { fields: ['title', 'body'] },
    },
    appDescription: 'a test app',
  };
}

function baseOptions(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    targetLanguage: 'fr',
    types: ['article'],
    checkpointPath: checkpointDir,
    translatorModel: 'mock-tx',
    reviewerModel: 'mock-rev',
    ...overrides,
  };
}

describe('pipeline.run', () => {
  it('translates a doc, writes it to Sanity, and checkpoints the result', async () => {
    const sourceDocs: SanityDocument[] = [
      { _id: 'art-1', _type: 'article', title: 'Hello', body: 'World' },
    ];
    const sanity = fakeSanityClient(sourceDocs);

    const options = baseOptions({
      mockTranslator: async () => ({
        fields: { title: 'Bonjour', body: 'Le monde' },
        raw: '',
      }),
      mockReviewer: async () => ({
        verdict: 'approved',
        confidence: 95,
        issues: [],
        notes: 'ok',
        raw: '',
      }),
    });

    const { results, skipped } = await run({
      client: {} as never,
      sanity: sanity as never,
      config: baseConfig(),
      options,
    });

    expect(skipped).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]!.review.verdict).toBe('approved');
    expect(sanity.written).toHaveLength(1);
    const w = sanity.written[0]!;
    expect(w._id).toBe('art-1__fr');
    expect(w.title).toBe('Bonjour');
    expect(w.language).toBe('fr');
    expect(w.aiReviewVerdict).toBe('approved');

    const cp = new CheckpointStore(checkpointDir).read('fr', 'article');
    expect(cp.entries['art-1']!.verdict).toBe('approved');
    expect(cp.entries['art-1']!.status).toBe('done');
  });

  it('skips a doc already checkpointed as done', async () => {
    fs.mkdirSync(checkpointDir, { recursive: true });
    fs.writeFileSync(
      path.join(checkpointDir, 'fr-article.json'),
      JSON.stringify({
        targetLanguage: 'fr',
        type: 'article',
        entries: {
          'art-1': {
            sourceId: 'art-1',
            translationId: 'art-1__fr',
            verdict: 'approved',
            status: 'done',
            attempts: 1,
            confidence: 90,
            issues: [],
            notes: '',
            totalTranslatorInputTokens: 0,
            totalTranslatorOutputTokens: 0,
            totalReviewerInputTokens: 0,
            totalReviewerOutputTokens: 0,
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );

    const sourceDocs: SanityDocument[] = [
      { _id: 'art-1', _type: 'article', title: 'Hello' },
    ];
    const sanity = fakeSanityClient(sourceDocs);
    const { results, skipped } = await run({
      client: {} as never,
      sanity: sanity as never,
      config: baseConfig(),
      options: baseOptions({
        mockTranslator: async () => {
          throw new Error('should not be called');
        },
        mockReviewer: async () => {
          throw new Error('should not be called');
        },
      }),
    });
    expect(results).toEqual([]);
    expect(skipped).toEqual([{ sourceId: 'art-1', type: 'article', reason: 'checkpoint' }]);
    expect(sanity.written).toEqual([]);
  });

  it('does not write rejected translations but does record the verdict', async () => {
    const sourceDocs: SanityDocument[] = [
      { _id: 'art-1', _type: 'article', title: 'Hello', body: 'World' },
    ];
    const sanity = fakeSanityClient(sourceDocs);

    const options = baseOptions({
      maxAttempts: 1,
      mockTranslator: async () => ({
        fields: { title: 'Bad', body: 'Bad' },
        raw: '',
      }),
      mockReviewer: async () => ({
        verdict: 'approved',
        confidence: 99,
        issues: [{ severity: 'critical', description: 'meaning drift' }],
        notes: '',
        raw: '',
      }),
    });
    const { results } = await run({
      client: {} as never,
      sanity: sanity as never,
      config: baseConfig(),
      options,
    });

    expect(results[0]!.review.verdict).toBe('rejected'); // reconciled from critical
    expect(results[0]!.translation).toBeNull();
    expect(sanity.written).toEqual([]); // never written

    const cp = new CheckpointStore(checkpointDir).read('fr', 'article');
    expect(cp.entries['art-1']!.verdict).toBe('rejected');
    expect(cp.entries['art-1']!.status).toBe('rejected');
  });
});
