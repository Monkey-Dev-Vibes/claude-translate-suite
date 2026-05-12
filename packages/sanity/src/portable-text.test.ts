import { describe, it, expect } from 'vitest';
import { extractUnits, applyTranslations } from './portable-text.js';
import type { PortableTextBlock } from './types.js';

const block = (extra: Record<string, unknown>): PortableTextBlock => ({
  _type: 'block',
  _key: 'b1',
  ...extra,
});

describe('extractUnits', () => {
  it('extracts each span as a translation unit', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [
          { _type: 'span', _key: 's1', text: 'Hello', marks: [] },
          { _type: 'span', _key: 's2', text: 'world', marks: [] },
        ],
        markDefs: [],
      }),
    ];
    const units = extractUnits(blocks);
    expect(units).toHaveLength(2);
    expect(units[0]!.text).toBe('Hello');
    expect(units[0]!.id).toBe('0.span:0');
    expect(units[0]!.preserveEnglish).toBe(false);
  });

  it('marks spans inside a preserved mark as preserveEnglish', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [
          { _type: 'span', _key: 's1', text: 'Roger that', marks: ['m1'] },
          { _type: 'span', _key: 's2', text: 'something else', marks: [] },
        ],
        markDefs: [{ _key: 'm1', _type: 'codeSpan' }],
      }),
    ];
    const units = extractUnits(blocks, [{ markType: 'codeSpan' }]);
    expect(units[0]!.preserveEnglish).toBe(true);
    expect(units[1]!.preserveEnglish).toBe(false);
  });

  it('extracts image alt and caption when present', () => {
    const blocks: PortableTextBlock[] = [
      { _type: 'image', _key: 'i1', alt: 'A photo', caption: 'A caption' },
    ];
    const units = extractUnits(blocks);
    expect(units).toHaveLength(2);
    expect(units[0]!.context).toBe('image.alt');
    expect(units[1]!.context).toBe('image.caption');
  });

  it('passes through unknown block types with no units', () => {
    const blocks: PortableTextBlock[] = [
      { _type: 'customDiagram', _key: 'd1', payload: { whatever: true } },
    ];
    expect(extractUnits(blocks)).toEqual([]);
  });

  it('skips empty span text', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [
          { _type: 'span', _key: 's1', text: '', marks: [] },
          { _type: 'span', _key: 's2', text: 'real', marks: [] },
        ],
        markDefs: [],
      }),
    ];
    expect(extractUnits(blocks)).toHaveLength(1);
  });
});

describe('applyTranslations', () => {
  it('replaces span text by stable id', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [
          { _type: 'span', _key: 's1', text: 'Hello', marks: [] },
          { _type: 'span', _key: 's2', text: 'world', marks: [] },
        ],
        markDefs: [],
      }),
    ];
    const translated = applyTranslations(blocks, {
      '0.span:0': 'Bonjour',
      '0.span:1': 'le monde',
    });
    const children = translated[0]!['children'] as Array<{ text: string }>;
    expect(children[0]!.text).toBe('Bonjour');
    expect(children[1]!.text).toBe('le monde');
  });

  it('preserves _key and marks unchanged', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [{ _type: 'span', _key: 's1', text: 'Hello', marks: ['m1'] }],
        markDefs: [{ _key: 'm1', _type: 'strong' }],
      }),
    ];
    const translated = applyTranslations(blocks, { '0.span:0': 'Bonjour' });
    const child = (translated[0]!['children'] as Array<Record<string, unknown>>)[0]!;
    expect(child._key).toBe('s1');
    expect(child.marks).toEqual(['m1']);
  });

  it('refuses to overwrite preserveEnglish spans even if a translation is supplied', () => {
    const blocks: PortableTextBlock[] = [
      block({
        children: [{ _type: 'span', _key: 's1', text: 'Roger that', marks: ['m1'] }],
        markDefs: [{ _key: 'm1', _type: 'codeSpan' }],
      }),
    ];
    const translated = applyTranslations(
      blocks,
      { '0.span:0': 'Roger ça' },
      [{ markType: 'codeSpan' }],
    );
    const child = (translated[0]!['children'] as Array<Record<string, unknown>>)[0]!;
    expect(child.text).toBe('Roger that');
  });

  it('passes through unknown block types verbatim', () => {
    const blocks: PortableTextBlock[] = [
      { _type: 'customDiagram', _key: 'd1', payload: { whatever: true } },
    ];
    expect(applyTranslations(blocks, {})).toEqual(blocks);
  });

  it('updates image alt and caption', () => {
    const blocks: PortableTextBlock[] = [
      { _type: 'image', _key: 'i1', alt: 'A photo', caption: 'A caption' },
    ];
    const translated = applyTranslations(blocks, {
      '0.image.alt': 'Une photo',
      '0.image.caption': 'Une légende',
    });
    expect(translated[0]!['alt']).toBe('Une photo');
    expect(translated[0]!['caption']).toBe('Une légende');
  });
});
