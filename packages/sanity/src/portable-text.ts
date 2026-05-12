/**
 * Generic Portable Text walker.
 *
 * Naively translating an entire PT array via "JSON in, JSON out" is unsafe —
 * the model can drop `_key`s, reorder spans, mutate markDefs, or invent
 * block types. The walker isolates the only mutations we want (span text +
 * standard image alt/caption) into a flat list of translation units keyed
 * by stable path identifiers. After translation, `applyTranslations`
 * reconstructs the tree verbatim, swapping in the translated strings.
 *
 * What the walker translates:
 *   - `block.children[i].text` for spans whose marks DO NOT reference a
 *     `preserveEnglish` markDef.
 *   - `image.alt` and `image.caption` (top-level string fields on a block
 *     whose `_type === 'image'`).
 *
 * What the walker preserves verbatim (no model touch):
 *   - All `_key` and `_type` values.
 *   - All `markDefs` arrays (refs, types, props).
 *   - Span `marks` arrays and ordering.
 *   - Any block type that isn't a standard `block` or `image`.
 *
 * The walker is intentionally schema-light. Custom block types specific to
 * your studio (illustrations, callouts, embedded references) are passed
 * through verbatim — their nested string fields are NOT translated. If you
 * need to translate inside a custom block type, walk it yourself before
 * handing the outer doc to the pipeline.
 */

import type { PortableTextBlock, PreservedMark } from './types.js';

export interface TranslationUnit {
  /** Stable identifier of form `<block_index>.<sub>`. */
  id: string;
  /** Source text to translate. */
  text: string;
  /** When true, the unit must stay in the source language. */
  preserveEnglish: boolean;
  /** Where the unit lives — useful for reviewer issue anchoring. */
  context: 'block.span' | 'image.alt' | 'image.caption';
}

interface WalkContext {
  preservedMarkTypes: ReadonlySet<string>;
}

function buildContext(marks: PreservedMark[] | undefined): WalkContext {
  return {
    preservedMarkTypes: new Set((marks ?? []).map((m) => m.markType)),
  };
}

/** Extract translation units from a Portable Text array. */
export function extractUnits(
  blocks: ReadonlyArray<PortableTextBlock>,
  preservedMarks?: PreservedMark[],
): TranslationUnit[] {
  const ctx = buildContext(preservedMarks);
  const out: TranslationUnit[] = [];
  for (let i = 0; i < blocks.length; i++) {
    walkBlock(blocks[i]!, String(i), out, ctx);
  }
  return out;
}

function walkBlock(
  block: PortableTextBlock,
  blockId: string,
  out: TranslationUnit[],
  ctx: WalkContext,
): void {
  if (block._type === 'block') {
    walkStandardBlock(block, blockId, out, ctx);
    return;
  }
  if (block._type === 'image') {
    walkImageBlock(block, blockId, out);
    return;
  }
  // Unknown block type — pass through (no units extracted).
}

function walkStandardBlock(
  block: PortableTextBlock,
  blockId: string,
  out: TranslationUnit[],
  ctx: WalkContext,
): void {
  const markDefs = (block['markDefs'] as Array<Record<string, unknown>> | undefined) ?? [];
  const preservedMarkKeys = new Set(
    markDefs
      .filter((md) => typeof md._type === 'string' && ctx.preservedMarkTypes.has(md._type as string))
      .map((md) => md._key as string)
      .filter((k): k is string => typeof k === 'string'),
  );
  const children = (block['children'] as Array<Record<string, unknown>> | undefined) ?? [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child._type !== 'span' || typeof child.text !== 'string' || !child.text) continue;
    const marks = (child.marks as string[] | undefined) ?? [];
    const preserveEnglish = marks.some((m) => preservedMarkKeys.has(m));
    out.push({
      id: `${blockId}.span:${i}`,
      text: child.text,
      preserveEnglish,
      context: 'block.span',
    });
  }
}

function walkImageBlock(
  block: PortableTextBlock,
  blockId: string,
  out: TranslationUnit[],
): void {
  const alt = block['alt'];
  if (typeof alt === 'string' && alt.trim()) {
    out.push({
      id: `${blockId}.image.alt`,
      text: alt,
      preserveEnglish: false,
      context: 'image.alt',
    });
  }
  const caption = block['caption'];
  if (typeof caption === 'string' && caption.trim()) {
    out.push({
      id: `${blockId}.image.caption`,
      text: caption,
      preserveEnglish: false,
      context: 'image.caption',
    });
  }
}

/**
 * Reconstruct a Portable Text array, replacing each unit's text with its
 * translation. Unknown blocks are passed through untouched. Preserved units
 * (preserveEnglish=true) are NOT replaced even if a translation is supplied
 * — this is the safety net against a model that ignored the instruction.
 */
export function applyTranslations(
  blocks: ReadonlyArray<PortableTextBlock>,
  translations: Record<string, string>,
  preservedMarks?: PreservedMark[],
): PortableTextBlock[] {
  const ctx = buildContext(preservedMarks);
  return blocks.map((block, i) => rebuildBlock(block, String(i), translations, ctx));
}

function rebuildBlock(
  block: PortableTextBlock,
  blockId: string,
  translations: Record<string, string>,
  ctx: WalkContext,
): PortableTextBlock {
  if (block._type === 'block') return rebuildStandardBlock(block, blockId, translations, ctx);
  if (block._type === 'image') return rebuildImageBlock(block, blockId, translations);
  return block;
}

function rebuildStandardBlock(
  block: PortableTextBlock,
  blockId: string,
  translations: Record<string, string>,
  ctx: WalkContext,
): PortableTextBlock {
  const markDefs = (block['markDefs'] as Array<Record<string, unknown>> | undefined) ?? [];
  const preservedMarkKeys = new Set(
    markDefs
      .filter((md) => typeof md._type === 'string' && ctx.preservedMarkTypes.has(md._type as string))
      .map((md) => md._key as string)
      .filter((k): k is string => typeof k === 'string'),
  );
  const children = (block['children'] as Array<Record<string, unknown>> | undefined) ?? [];
  const next = children.map((child, i) => {
    if (child._type !== 'span' || typeof child.text !== 'string') return child;
    const marks = (child.marks as string[] | undefined) ?? [];
    const isPreserved = marks.some((m) => preservedMarkKeys.has(m));
    if (isPreserved) return child;
    const id = `${blockId}.span:${i}`;
    const translated = translations[id];
    if (typeof translated === 'string' && translated.length > 0) {
      return { ...child, text: translated };
    }
    return child;
  });
  return { ...block, children: next };
}

function rebuildImageBlock(
  block: PortableTextBlock,
  blockId: string,
  translations: Record<string, string>,
): PortableTextBlock {
  const out: PortableTextBlock = { ...block };
  const altKey = `${blockId}.image.alt`;
  const capKey = `${blockId}.image.caption`;
  if (typeof translations[altKey] === 'string' && translations[altKey].length > 0) {
    out['alt'] = translations[altKey];
  }
  if (typeof translations[capKey] === 'string' && translations[capKey].length > 0) {
    out['caption'] = translations[capKey];
  }
  return out;
}
