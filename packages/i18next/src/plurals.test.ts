import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLDR_PLURALS,
  getPluralCategories,
  expandPluralSuffixes,
  validatePluralCoverage,
} from './plurals.js';

describe('DEFAULT_CLDR_PLURALS', () => {
  it('includes common languages', () => {
    for (const code of ['en', 'fr', 'es', 'de', 'ru', 'ar', 'zh', 'ja', 'hi']) {
      expect(DEFAULT_CLDR_PLURALS).toHaveProperty(code);
    }
  });

  it('Arabic has the full 6-form CLDR set', () => {
    expect(DEFAULT_CLDR_PLURALS['ar']).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
  });

  it('Chinese collapses to a single "other"', () => {
    expect(DEFAULT_CLDR_PLURALS['zh']).toEqual(['other']);
  });
});

describe('getPluralCategories', () => {
  it('returns the default for a known language', () => {
    expect(getPluralCategories('fr')).toEqual(['one', 'many', 'other']);
  });

  it('returns the override when supplied', () => {
    const overrides = { 'pt-BR': ['one', 'other'] as const };
    expect(getPluralCategories('pt-BR', overrides)).toEqual(['one', 'other']);
  });

  it('throws for an unconfigured language', () => {
    expect(() => getPluralCategories('xyz')).toThrow();
  });
});

describe('expandPluralSuffixes', () => {
  it('prefixes each category with underscore', () => {
    expect(expandPluralSuffixes('ru')).toEqual(['_one', '_few', '_many', '_other']);
  });
});

describe('validatePluralCoverage', () => {
  it('reports no issues when coverage matches', () => {
    const r = validatePluralCoverage(
      'days',
      ['days_one', 'days_few', 'days_many', 'days_other'],
      'ru',
    );
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('flags a missing CLDR category', () => {
    const r = validatePluralCoverage('days', ['days_one', 'days_other'], 'ru');
    expect(r.missing).toEqual(['days_few', 'days_many']);
  });

  it('flags an extra CLDR category', () => {
    const r = validatePluralCoverage(
      'days',
      ['days_one', 'days_other', 'days_few'],
      'en',
    );
    expect(r.extra).toEqual(['days_few']);
  });
});
