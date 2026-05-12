import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadBundle,
  flattenBundle,
  detectPluralStem,
  loadLeaves,
  groupPlurals,
  setAtPath,
  listNamespaces,
} from './loader.js';

let sourceDir: string;

beforeEach(() => {
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-test-'));
  fs.mkdirSync(path.join(sourceDir, 'en'));
  fs.writeFileSync(
    path.join(sourceDir, 'en', 'common.json'),
    JSON.stringify({
      welcome: 'Hello {{name}}',
      nav: {
        home: 'Home',
        settings: 'Settings',
      },
      days_one: '{{count}} day',
      days_other: '{{count}} days',
    }),
  );
  fs.writeFileSync(
    path.join(sourceDir, 'en', 'auth.json'),
    JSON.stringify({ login: 'Log in' }),
  );
});

afterEach(() => {
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

describe('loadBundle', () => {
  it('reads and parses a JSON locale file', () => {
    const b = loadBundle({ sourceDir, lang: 'en', namespace: 'common' });
    expect(b['welcome']).toBe('Hello {{name}}');
  });

  it('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(sourceDir, 'en', 'bad.json'), '{not json');
    expect(() => loadBundle({ sourceDir, lang: 'en', namespace: 'bad' })).toThrow();
  });
});

describe('listNamespaces', () => {
  it('lists *.json file stems sorted', () => {
    expect(listNamespaces(sourceDir, 'en')).toEqual(['auth', 'common']);
  });

  it('returns an empty list for a missing language directory', () => {
    expect(listNamespaces(sourceDir, 'fr')).toEqual([]);
  });
});

describe('flattenBundle', () => {
  it('emits one entry per string leaf with dotted paths', () => {
    const b = loadBundle({ sourceDir, lang: 'en', namespace: 'common' });
    const flat = flattenBundle(b);
    const paths = flat.map((e) => e.path).sort();
    expect(paths).toEqual([
      'days_one',
      'days_other',
      'nav.home',
      'nav.settings',
      'welcome',
    ]);
  });
});

describe('detectPluralStem', () => {
  it('strips _one suffix', () => {
    expect(detectPluralStem('days_one')).toBe('days');
  });

  it('strips _many suffix', () => {
    expect(detectPluralStem('items.count_many')).toBe('items.count');
  });

  it('returns null for non-plural keys', () => {
    expect(detectPluralStem('welcome')).toBeNull();
  });
});

describe('loadLeaves', () => {
  it('annotates leaves with plural stem and interpolation vars', () => {
    const leaves = loadLeaves({ sourceDir, lang: 'en', namespace: 'common' });
    const daysOne = leaves.find((l) => l.path === 'days_one')!;
    expect(daysOne.pluralStem).toBe('days');
    expect(daysOne.interpolationVars).toEqual(['count']);
  });
});

describe('groupPlurals', () => {
  it('groups _one/_other pairs by stem', () => {
    const leaves = loadLeaves({ sourceDir, lang: 'en', namespace: 'common' });
    const groups = groupPlurals(leaves);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.stem).toBe('days');
  });
});

describe('setAtPath', () => {
  it('creates nested objects as needed', () => {
    const b = {};
    setAtPath(b, 'a.b.c', 'hello');
    expect(b).toEqual({ a: { b: { c: 'hello' } } });
  });
});
