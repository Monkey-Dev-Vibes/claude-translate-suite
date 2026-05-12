import { describe, it, expect } from 'vitest';
import {
  stripCodeFence,
  safeParseJson,
  parseReviewerResponse,
  reconcileVerdict,
  PipelineParseError,
} from './parse.js';

describe('stripCodeFence', () => {
  it('removes a ```json fence', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes a plain ``` fence', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('passes through unfenced input', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('trims whitespace', () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON', () => {
    expect(safeParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('throws PipelineParseError on bad JSON', () => {
    expect(() => safeParseJson('{not json}')).toThrow(PipelineParseError);
  });

  it('PipelineParseError preserves the raw input', () => {
    try {
      safeParseJson('{not json}');
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineParseError);
      expect((err as PipelineParseError).raw).toBe('{not json}');
    }
  });
});

describe('parseReviewerResponse', () => {
  const valid = JSON.stringify({
    verdict: 'approved',
    confidence: 92,
    issues: [],
    notes: 'looks good',
  });

  it('parses a valid response', () => {
    const r = parseReviewerResponse(valid, 'field');
    expect(r.verdict).toBe('approved');
    expect(r.confidence).toBe(92);
    expect(r.issues).toEqual([]);
    expect(r.notes).toBe('looks good');
  });

  it('parses issues with the configured location key', () => {
    const raw = JSON.stringify({
      verdict: 'rejected',
      confidence: 30,
      issues: [
        {
          severity: 'critical',
          description: 'Missing interpolation',
          field: 'user.greeting',
        },
      ],
      notes: '',
    });
    const r = parseReviewerResponse(raw, 'field');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.location).toBe('user.greeting');
    expect(r.issues[0]!.locationKey).toBe('field');
  });

  it('rounds confidence to an integer', () => {
    const raw = JSON.stringify({ verdict: 'approved', confidence: 87.6, issues: [], notes: '' });
    expect(parseReviewerResponse(raw, 'field').confidence).toBe(88);
  });

  it('rejects an unknown verdict', () => {
    const raw = JSON.stringify({ verdict: 'maybe', confidence: 50, issues: [], notes: '' });
    expect(() => parseReviewerResponse(raw, 'field')).toThrow(PipelineParseError);
  });

  it('rejects confidence out of range', () => {
    const raw = JSON.stringify({ verdict: 'approved', confidence: 150, issues: [], notes: '' });
    expect(() => parseReviewerResponse(raw, 'field')).toThrow(PipelineParseError);
  });

  it('rejects an issue with unknown severity', () => {
    const raw = JSON.stringify({
      verdict: 'approved',
      confidence: 80,
      issues: [{ severity: 'huge', description: 'x' }],
      notes: '',
    });
    expect(() => parseReviewerResponse(raw, 'field')).toThrow(PipelineParseError);
  });
});

describe('reconcileVerdict', () => {
  it('returns rejected on any critical issue', () => {
    const v = reconcileVerdict({
      confidence: 99,
      issues: [{ severity: 'critical' }],
    });
    expect(v).toBe('rejected');
  });

  it('returns needs-human on any major issue', () => {
    const v = reconcileVerdict({
      confidence: 99,
      issues: [{ severity: 'major' }],
    });
    expect(v).toBe('needs-human');
  });

  it('returns needs-human on low confidence even with no issues', () => {
    const v = reconcileVerdict({ confidence: 60, issues: [] });
    expect(v).toBe('needs-human');
  });

  it('returns approved when no issues and high confidence', () => {
    const v = reconcileVerdict({ confidence: 92, issues: [] });
    expect(v).toBe('approved');
  });

  it('returns approved when only minor issues and high confidence', () => {
    const v = reconcileVerdict({
      confidence: 95,
      issues: [{ severity: 'minor' }, { severity: 'minor' }],
    });
    expect(v).toBe('approved');
  });

  it('critical overrides everything', () => {
    const v = reconcileVerdict({
      confidence: 99,
      issues: [{ severity: 'minor' }, { severity: 'critical' }, { severity: 'major' }],
    });
    expect(v).toBe('rejected');
  });
});
