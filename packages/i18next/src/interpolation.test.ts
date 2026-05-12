import { describe, it, expect } from 'vitest';
import { extractInterpolationVars, compareInterpolation } from './interpolation.js';

describe('extractInterpolationVars', () => {
  it('extracts a single variable', () => {
    expect(extractInterpolationVars('Hello {{name}}')).toEqual(['name']);
  });

  it('extracts multiple unique variables sorted', () => {
    expect(extractInterpolationVars('{{count}} items for {{name}}')).toEqual([
      'count',
      'name',
    ]);
  });

  it('deduplicates repeated variables', () => {
    expect(extractInterpolationVars('{{x}} and {{x}}')).toEqual(['x']);
  });

  it('strips whitespace inside braces', () => {
    expect(extractInterpolationVars('{{  name  }}')).toEqual(['name']);
  });

  it('extracts the variable name even with format args', () => {
    expect(extractInterpolationVars('{{count, number}}')).toEqual(['count']);
  });

  it('returns empty for a string with no interpolation', () => {
    expect(extractInterpolationVars('plain text')).toEqual([]);
  });
});

describe('compareInterpolation', () => {
  it('reports no drift on identical placeholder sets', () => {
    const d = compareInterpolation('Hello {{name}}', 'Bonjour {{name}}');
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
  });

  it('reports missing placeholders from the translation', () => {
    const d = compareInterpolation('Hello {{name}}!', 'Bonjour !');
    expect(d.missing).toEqual(['name']);
  });

  it('reports hallucinated extras in the translation', () => {
    const d = compareInterpolation('Hello', 'Bonjour {{name}}');
    expect(d.extra).toEqual(['name']);
  });
});
