/**
 * Per-document checkpointing.
 *
 * One JSON file per (lang, type) pair under `<baseDir>/<lang>-<type>.json`.
 * Each file contains an `entries` map keyed by source-document `_id` so a
 * crashed run can resume mid-batch without re-translating completed docs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Verdict } from '@monkey-dev-vibes/claude-translate-core';

import type { ReviewIssue } from './types.js';

const DEFAULT_DIR = path.resolve(process.cwd(), '.translate-checkpoint');

export type EntryStatus = 'done' | 'rejected';

export interface CheckpointEntry {
  sourceId: string;
  translationId: string;
  verdict: Verdict;
  status: EntryStatus;
  attempts: number;
  confidence: number;
  issues: ReviewIssue[];
  notes: string;
  totalTranslatorInputTokens: number;
  totalTranslatorOutputTokens: number;
  totalReviewerInputTokens: number;
  totalReviewerOutputTokens: number;
  completedAt: string;
}

interface CheckpointFile {
  targetLanguage: string;
  type: string;
  entries: Record<string, CheckpointEntry>;
}

function checkpointPath(baseDir: string, lang: string, type: string): string {
  return path.join(baseDir, `${lang}-${type}.json`);
}

export class CheckpointStore {
  public readonly baseDir: string;

  constructor(baseDir: string = DEFAULT_DIR) {
    this.baseDir = baseDir;
  }

  read(lang: string, type: string): CheckpointFile {
    const p = checkpointPath(this.baseDir, lang, type);
    if (!fs.existsSync(p)) return { targetLanguage: lang, type, entries: {} };
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      return JSON.parse(raw) as CheckpointFile;
    } catch {
      return { targetLanguage: lang, type, entries: {} };
    }
  }

  has(lang: string, type: string, sourceId: string): boolean {
    return Boolean(this.read(lang, type).entries[sourceId]);
  }

  /** Returns true for entries marked `done` (approved or needs-human). */
  shouldSkip(lang: string, type: string, sourceId: string): boolean {
    const entry = this.read(lang, type).entries[sourceId];
    return entry?.status === 'done';
  }

  upsert(lang: string, type: string, entry: CheckpointEntry): void {
    const file = this.read(lang, type);
    file.entries[entry.sourceId] = entry;
    this.write(file);
  }

  write(file: CheckpointFile): string {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const p = checkpointPath(this.baseDir, file.targetLanguage, file.type);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, p);
    return p;
  }
}
