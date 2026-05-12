import { describe, it, expect } from 'vitest';
import { renderGlossary, findGlossaryDrift } from './glossary.js';

describe('renderGlossary', () => {
  it('returns an empty string for an empty list', () => {
    expect(renderGlossary('fr', [])).toBe('');
  });

  it('renders a bulleted EN → target list with a default header', () => {
    const out = renderGlossary('fr', [
      { en: 'dashboard', target: 'tableau de bord' },
      { en: 'checkout', target: 'caisse' },
    ]);
    expect(out).toContain('REQUIRED TERMINOLOGY for fr');
    expect(out).toContain('- dashboard → tableau de bord');
    expect(out).toContain('- checkout → caisse');
  });

  it('accepts a custom header', () => {
    const out = renderGlossary(
      'es',
      [{ en: 'cart', target: 'carrito' }],
      { header: 'TERMS:' },
    );
    expect(out.split('\n')[0]).toBe('TERMS:');
  });
});

describe('findGlossaryDrift', () => {
  const glossary = [
    { en: 'dashboard', target: 'tableau de bord' },
    { en: 'checkout', target: 'caisse' },
  ];

  it('returns no drift when the translation uses the required form', () => {
    const drift = findGlossaryDrift(
      'Open the dashboard.',
      'Ouvrez le tableau de bord.',
      glossary,
    );
    expect(drift).toEqual([]);
  });

  it('detects drift when the source term is present but the target form is missing', () => {
    const drift = findGlossaryDrift(
      'Open the dashboard.',
      'Ouvrez le panneau.',
      glossary,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]!.en).toBe('dashboard');
  });

  it('is case-insensitive on the source side', () => {
    const drift = findGlossaryDrift('Dashboard view', 'Vue du panneau', glossary);
    expect(drift).toHaveLength(1);
  });

  it('ignores glossary entries whose source term is not in the input', () => {
    const drift = findGlossaryDrift('Welcome page', 'Page de bienvenue', glossary);
    expect(drift).toEqual([]);
  });
});
