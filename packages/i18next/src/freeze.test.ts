import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compilePattern,
  loadFreezeManifest,
  isFrozen,
} from './freeze.js';

describe('compilePattern', () => {
  it('matches literal dotted paths', () => {
    const re = compilePattern('module.title');
    expect(re.test('module.title')).toBe(true);
    expect(re.test('module.subtitle')).toBe(false);
  });

  it('treats * as a single-segment wildcard', () => {
    const re = compilePattern('modules.*.title');
    expect(re.test('modules.alpha.title')).toBe(true);
    expect(re.test('modules.alpha.beta.title')).toBe(false);
  });

  it('rejects empty patterns', () => {
    expect(() => compilePattern('')).toThrow();
  });

  it('rejects unsupported ** wildcards', () => {
    expect(() => compilePattern('a.**.b')).toThrow();
  });

  it('escapes regex specials in literal segments', () => {
    const re = compilePattern('a.b+c');
    expect(re.test('a.b+c')).toBe(true);
    expect(re.test('a.bxc')).toBe(false);
  });
});

describe('loadFreezeManifest', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-test-'));
    manifestPath = path.join(tmpDir, 'freeze.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty manifest when no file is supplied', () => {
    const m = loadFreezeManifest();
    expect(m.byNamespace.size).toBe(0);
  });

  it('returns an empty manifest when the file does not exist', () => {
    const m = loadFreezeManifest(path.join(tmpDir, 'nope.json'));
    expect(m.byNamespace.size).toBe(0);
  });

  it('compiles patterns per namespace', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        frozenKeys: {
          common: ['brand.*', 'legal.disclaimer'],
        },
      }),
    );
    const m = loadFreezeManifest(manifestPath);
    expect(m.byNamespace.has('common')).toBe(true);
    expect(isFrozen(m, 'common', 'brand.name')).toBe(true);
    expect(isFrozen(m, 'common', 'legal.disclaimer')).toBe(true);
    expect(isFrozen(m, 'common', 'unrelated.key')).toBe(false);
    expect(isFrozen(m, 'auth', 'brand.name')).toBe(false);
  });
});
