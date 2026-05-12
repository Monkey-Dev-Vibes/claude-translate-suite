import { describe, it, expect } from 'vitest';
import {
  translationId,
  verdictToStatus,
  sanitiseReviewNotes,
  stripForPrompt,
} from './sanity.js';

describe('translationId', () => {
  it('appends __<lang> to bare ids', () => {
    expect(translationId('article-123', 'fr')).toBe('article-123__fr');
  });

  it('strips a "drafts." prefix', () => {
    expect(translationId('drafts.article-123', 'es')).toBe('article-123__es');
  });
});

describe('verdictToStatus', () => {
  it('maps approved to needs-review', () => {
    expect(verdictToStatus('approved')).toBe('needs-review');
  });

  it('maps needs-human to needs-review', () => {
    expect(verdictToStatus('needs-human')).toBe('needs-review');
  });

  it('maps rejected to draft', () => {
    expect(verdictToStatus('rejected')).toBe('draft');
  });
});

describe('sanitiseReviewNotes', () => {
  it('returns an empty string for empty input', () => {
    expect(sanitiseReviewNotes('')).toBe('');
  });

  it('strips a surrounding ```json fence', () => {
    expect(sanitiseReviewNotes('```json\nhello\n```')).toBe('hello');
  });

  it('strips a plain ``` fence', () => {
    expect(sanitiseReviewNotes('```\nhello\n```')).toBe('hello');
  });

  it('caps over-long notes', () => {
    const long = 'x'.repeat(5000);
    const out = sanitiseReviewNotes(long);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out).toMatch(/\[truncated\]$/);
  });

  it('normalises CRLF to LF', () => {
    expect(sanitiseReviewNotes('a\r\nb')).toBe('a\nb');
  });
});

describe('stripForPrompt', () => {
  it('returns only configured fields', () => {
    const doc = {
      _id: 'a1',
      _type: 'article',
      _rev: 'rev',
      title: 'Hello',
      body: 'World',
      internalNote: 'secret',
    };
    const out = stripForPrompt(
      doc,
      {
        docTypes: { article: { fields: ['title', 'body'] } },
      },
      'article',
    );
    expect(out).toEqual({ title: 'Hello', body: 'World' });
  });

  it('returns an empty object for an unconfigured type', () => {
    const doc = { _id: 'a1', _type: 'unknown', title: 'X' };
    expect(stripForPrompt(doc, { docTypes: {} }, 'unknown')).toEqual({});
  });
});
