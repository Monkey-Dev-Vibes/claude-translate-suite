# @monkey-dev-vibes/claude-translate-sanity

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![typescript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.json)

> A two-pass Claude translation pipeline for **Sanity CMS documents**. Verdict states (`approved` / `needs-human` / `rejected`), Portable Text-safe extraction, deterministic translation `_id`s, a refiner pass that promotes borderline translations, and checkpoint resumability.
>
> Built for content teams who need to translate at scale without putting raw LLM output into production.

## What it does, in one sentence

For every English document of every configured `_type`: Claude translates the configured fields → Claude reviews the translation → a reconciler computes the final verdict → approved + needs-human translations are written to Sanity with `createOrReplace` under a deterministic `_id` → rejected drafts retry up to `maxAttempts` → every result lands in a checkpoint so a killed run resumes cleanly.

## Verdict-state model — the secret weapon

Most LLM translation tools write raw output straight to your CMS. This one runs every translation through a dedicated reviewer call and stores the verdict on the translated document, so your content team has a triage queue baked into the schema:

| Field | Values | Meaning |
| --- | --- | --- |
| `translationStatus` | `needs-review` / `draft` | Sanity workflow status. `draft` = rejected by the pipeline. |
| `aiReviewVerdict` | `approved` / `needs-human` / `rejected` | Reconciled verdict — see below. |
| `aiReviewConfidence` | `0–100` | Reviewer's confidence score. Below 70 downgrades to `needs-human`. |
| `aiReviewNotes` | markdown | Review summary persisted on the doc for human triage. |
| `sourceRef` | reference | Pointer back to the source document. |
| `language` | BCP-47 code | The target language. |

The reconciler is the safety net against the failure mode where the model declares `"approved"` while listing a `critical`-severity issue. The label is what the model said; the verdict is what the issues actually mean:

- Any `critical` issue → **rejected** (and never written to Sanity).
- Any `major` issue, or confidence < 70 → **needs-human** (written, flagged for a human).
- Otherwise → **approved**.

Rejected docs stay in the checkpoint for inspection. Approved + needs-human docs go to Sanity with the appropriate status.

## Install

```bash
npm install -D @monkey-dev-vibes/claude-translate-sanity @anthropic-ai/sdk @sanity/client
```

Node 18+. `@anthropic-ai/sdk` and `@sanity/client` are peer dependencies — bring your own versions.

## Quickstart

### 1. Drop a config file in your project root

```ts
// translate.config.ts
import { buildHardRulesBlock, renderGlossary } from '@monkey-dev-vibes/claude-translate-core';
import type { PipelineConfig } from '@monkey-dev-vibes/claude-translate-sanity';

const config: PipelineConfig = {
  docTypes: {
    article: { fields: ['title', 'summary', 'body'] },
    faq:     { fields: ['question', 'answer'], fetchPredicate: 'published == true' },
  },
  appDescription: 'a publishing site',
  domainRules: buildHardRulesBlock(
    [
      'Brand names "Acme" and "AcmePro" stay in English in every language.',
      'Code snippets in triple backticks stay verbatim.',
    ],
    { includeGeneric: true },
  ),
  glossaryBlocks: {
    fr: renderGlossary('fr', [
      { en: 'release',  target: 'version' },
      { en: 'pipeline', target: 'pipeline' },
    ]),
  },
  preservedMarks: [{ markType: 'codeSpan', label: 'inline code' }],
};

export default config;
```

### 2. Translate

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export SANITY_PROJECT_ID=your-project-id
export SANITY_API_TOKEN=your-editor-token

npx claude-translate-sanity run \
  --target fr \
  --translator-model claude-3-5-sonnet-latest \
  --reviewer-model claude-opus-4-latest \
  --type article
```

### 3. Or call the API directly

```ts
import Anthropic from '@anthropic-ai/sdk';
import { run, createSanityClient } from '@monkey-dev-vibes/claude-translate-sanity';
import config from './translate.config.js';

const anthropic = new Anthropic();
const sanity = createSanityClient();

const { results, skipped } = await run({
  client: anthropic,
  sanity,
  config,
  options: {
    targetLanguage: 'fr',
    translatorModel: 'claude-3-5-sonnet-latest',
    reviewerModel: 'claude-opus-4-latest',
  },
});

for (const r of results) console.log(r.summary);
```

## Portable Text — handled safely

Sanity's Portable Text is a tree of structured blocks, spans, marks, and `markDefs`. Naive whole-document JSON translation is dangerous: the model can drop `_key`s, reorder spans, replace `markDefs`, or invent block types. The package ships a **walker** that isolates the only mutations you actually want — visible English text inside spans, plus standard image `alt` / `caption` — into flat translation units keyed by stable path identifiers:

```ts
import { extractUnits, applyTranslations } from '@monkey-dev-vibes/claude-translate-sanity';

// Pull translation units out of a Portable Text array.
const units = extractUnits(article.body, config.preservedMarks);
// → [{ id: '0.span:0', text: 'Hello', preserveEnglish: false, context: 'block.span' }, ...]

// (Send the units to your translator, get back a Record<id, string>.)

// Rebuild the tree with translations applied.
// _keys, markDefs, span ordering, and unknown block types are preserved verbatim.
const translatedBody = applyTranslations(article.body, translations, config.preservedMarks);
```

**What the walker preserves verbatim:** all `_key`, all `_type`, all `markDefs`, all `marks` arrays, all unknown block types (custom illustrations, callouts, embedded references — passed through untouched).

**What you translate:** span text (when not inside a `preserveEnglish`-marked span) + image `alt` + image `caption`.

**`preservedMarks`** lets you declare mark types whose underlying span text must stay in the source language — e.g. inline code, glossary terms, citations. Even if a misbehaving model returns a translation for a preserved unit, the rebuild step refuses to apply it.

## The refiner pass — promote `needs-human` to `approved`

After a full run, some documents will land at `needs-human`. The refiner re-runs the translator with the original reviewer's issues fed back as explicit "fix this" feedback. If the new verdict is strictly better, the document is rewritten to Sanity and the checkpoint is updated:

```bash
npx claude-translate-sanity refine-nh \
  --target fr \
  --translator-model claude-3-5-sonnet-latest \
  --reviewer-model claude-opus-4-latest
```

Promotion is conservative — only `needs-human` → `approved` triggers a rewrite. No other transitions promote, so the refiner can't accidentally regress an already-good translation.

## Pipeline shape

```text
Sanity source doc (language == sourceLanguage)
         │
         ▼
┌────────────────────┐
│ Translator (Claude)│   translates configured fields per docType
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Reviewer (Claude)  │   verdict + issues + confidence + notes
└────────────────────┘
         │
   reconcileVerdict()    ← trusts the issues list over the label
         │
   ┌─────┴────────┬────────────┐
   ▼              ▼            ▼
approved      needs-human    rejected
   │              │            │
   └──► createOrReplace        └──► retry (with reviewer notes)
        with deterministic
        _id = <src>__<lang>
        + verdict fields on the doc
   + checkpoint entry
```

## CLI

```text
claude-translate-sanity [run|refine-nh] --target <lang> [options]
```

| Flag | Description |
| --- | --- |
| `--target <lang>` | **Required.** Target language code. |
| `--translator-model <id>` | **Required.** Claude model for the translator pass. |
| `--reviewer-model <id>` | **Required.** Claude model for the reviewer pass. |
| `--config <path>` | Config file path. Default: `./translate.config.{ts,mjs,js,json}`. |
| `--type <list>` | Comma-separated doc types. Default: every type in config. |
| `--only-ids <list>` | Comma-separated source `_id` values. |
| `--dry-run` | Skip Sanity writes and checkpoint persistence. |
| `-h, --help` | Show help. |

### Environment

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | **Required** for live runs. |
| `SANITY_PROJECT_ID` | **Required** (or pass to `createSanityClient` programmatically). |
| `SANITY_API_TOKEN` | **Required** — editor-scoped token for write access. |
| `SANITY_DATASET` | Optional. Defaults to `production`. |

## Configuration reference

```ts
interface PipelineConfig {
  docTypes: Record<string, { fields: string[]; fetchPredicate?: string }>;
  sourceLanguage?: string;                  // default 'en'
  preservedMarks?: PreservedMark[];         // Portable Text mark types to preserve
  domainRules?: string;                     // pre-rendered HARD RULES block
  glossaryBlocks?: Record<string, string>;  // per-language glossary
  languageNotes?: Record<string, string>;   // per-language free-form notes
  appDescription?: string;                  // injected into system prompts
}

interface PipelineOptions {
  targetLanguage: string;
  types?: string[];
  dryRun?: boolean;
  onlyIds?: string[];
  maxAttempts?: number;                     // default 2
  checkpointPath?: string;                  // default ./.translate-checkpoint
  translatorModel: string;
  reviewerModel: string;
  translatorMaxTokens?: number;             // default 8000
  reviewerMaxTokens?: number;               // default 4096
  referenceContext?: string;                // optional authoritative reference text
  mockTranslator?: ...;                     // testing hook
  mockReviewer?: ...;
}
```

`fetchPredicate` lets you AND additional GROQ into the source-doc query, e.g. `'published == true'` to translate only published articles.

## Design choices

- **No default model.** Caller supplies translator + reviewer model IDs. Silent model upgrades are exactly the kind of regression that breaks production runs.
- **No baked-in domain content.** Every brand name, regulation citation, and glossary entry comes from your config.
- **Deterministic translation `_id`s.** `<sourceId>__<lang>` so re-runs overwrite cleanly instead of duplicating.
- **Portable Text safety.** The walker preserves every `_key`, every `_type`, every `markDefs` value — even if a misbehaving model returns garbage, the rebuild step refuses to apply translations to preserved spans.
- **System fields stripped on write.** `_id`, `_rev`, `_createdAt`, `_updatedAt`, prior workflow fields are stripped before spreading into the translated document. Translations stay clean.
- **Sanitised review notes.** Code fences stripped, length capped at 4kb, CRLF normalised — keeps Sanity Studio rendering predictable.

## Testing

```bash
npm test
```

25 tests covering the Portable Text walker (including preserved-mark refusal), Sanity helpers (deterministic `_id`s, verdict mapping, note sanitising), and full pipeline orchestration through a fake Sanity client + injected translator/reviewer mocks. Zero Anthropic tokens and zero Sanity API calls.

## License

[MIT](../../LICENSE)
