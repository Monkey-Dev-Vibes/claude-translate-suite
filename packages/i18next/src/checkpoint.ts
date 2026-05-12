/**
 * Per-namespace checkpointing. Re-running the same command skips namespaces
 * that previously reached `approved` or `needs-human`.
 *
 * One JSON file per (lang, namespace) pair under `<baseDir>/<lang>-<ns>.json`.
 * Writes are atomic (tmp + rename); reads tolerate corruption and fall back
 * to "treat as absent".
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Verdict } from '@monkey-dev-vibes/claude-translate-core';

import type { ReviewIssue } from './types.js';

const DEFAULT_DIR = path.resolve(process.cwd(), '.translate-checkpoint');

export interface CheckpointEntry {
  targetLanguage: string;
  namespace: string;
  verdict: Verdict;
  attempts: number;
  issues: ReviewIssue[];
  notes: string;
  totalTranslatorInputTokens: number;
  totalTranslatorOutputTokens: number;
  totalReviewerInputTokens: number;
  totalReviewerOutputTokens: number;
  completedAt: string;
}

function checkpointPath(baseDir: string, lang: string, namespace: string): string {
  return path.join(baseDir, `${lang}-${namespace}.json`);
}

export class CheckpointStore {
  public readonly baseDir: string;

  constructor(baseDir: string = DEFAULT_DIR) {
    this.baseDir = baseDir;
  }

  has(lang: string, namespace: string): boolean {
    return fs.existsSync(checkpointPath(this.baseDir, lang, namespace));
  }

  read(lang: string, namespace: string): CheckpointEntry | null {
    const p = checkpointPath(this.baseDir, lang, namespace);
    if (!fs.existsSync(p)) return null;
    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
    try {
      return JSON.parse(raw) as CheckpointEntry;
    } catch {
      return null;
    }
  }

  write(entry: CheckpointEntry): string {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const p = checkpointPath(this.baseDir, entry.targetLanguage, entry.namespace);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, p);
    return p;
  }

  shouldSkip(lang: string, namespace: string): boolean {
    const entry = this.read(lang, namespace);
    if (!entry) return false;
    return entry.verdict === 'approved' || entry.verdict === 'needs-human';
  }
}
