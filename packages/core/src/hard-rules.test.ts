import { describe, it, expect } from 'vitest';
import { buildHardRulesBlock, GENERIC_HARD_RULES } from './hard-rules.js';

describe('buildHardRulesBlock', () => {
  it('numbers caller-supplied rules with the default header', () => {
    const out = buildHardRulesBlock(['Rule A', 'Rule B']);
    expect(out).toContain('HARD RULES');
    expect(out).toContain('1. Rule A');
    expect(out).toContain('2. Rule B');
  });

  it('returns an empty string when no rules and no generic baseline', () => {
    expect(buildHardRulesBlock([])).toBe('');
  });

  it('prepends GENERIC_HARD_RULES when includeGeneric is true', () => {
    const out = buildHardRulesBlock(['My rule'], { includeGeneric: true });
    // GENERIC rules come first, then the caller's
    const numberedLines = out.split('\n').filter((l) => /^\d+\./.test(l));
    expect(numberedLines).toHaveLength(GENERIC_HARD_RULES.length + 1);
    expect(numberedLines[numberedLines.length - 1]).toContain('My rule');
  });

  it('uses a custom header when provided', () => {
    const out = buildHardRulesBlock(['x'], { header: 'CUSTOM:' });
    expect(out.split('\n')[0]).toBe('CUSTOM:');
  });
});

describe('GENERIC_HARD_RULES', () => {
  it('mentions interpolation tokens', () => {
    expect(GENERIC_HARD_RULES.join(' ')).toMatch(/interpolation/i);
  });

  it('mentions numerical units', () => {
    expect(GENERIC_HARD_RULES.join(' ')).toMatch(/numerical/i);
  });

  it('mentions markup preservation', () => {
    expect(GENERIC_HARD_RULES.join(' ')).toMatch(/HTML|markdown/i);
  });
});
