# @monkey-dev-vibes/claude-translate-i18next

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![typescript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.json)

> A two-pass Claude translation pipeline for **i18next-style JSON locale files**. Translates every namespace in `locales/en/` into any target language, audits the output with a dedicated reviewer call, and writes the result atomically — with frozen-keys protection, diff-mode incremental translation, CLDR plural expansion, and interpolation-token preservation.
>
> Designed so you can leave it on indefinitely: re-runs cost roughly as much as the keys that changed.

## What it does, in one sentence

`locales/en/*.json` → Claude translator → structural validator → Claude reviewer → verdict reconciler → atomic write of `locales/<lang>/*.json` + checkpoint.

## Why most JSON translation scripts fall over

You can wire up `JSON.stringify → Claude → JSON.parse → fs.writeFileSync` in fifteen minutes. The interesting failures show up later:

| Failure mode | What this pipeline does about it |
| --- | --- |
| One dropped `{{count}}` interpolation token silently breaks a sign-up flow | Structural validator extracts placeholder sets from source + translation and flags any drift as `critical`. Catches it before the reviewer even sees it. |
| Re-running regresses every hand-finalised module title | Frozen-keys manifest with `*` wildcards locks values once they're on disk. Re-runs preserve frozen entries byte-for-byte and skip them in diff-mode. |
| Russian build is missing two CLDR plural categories | Plural validator enforces the full required set per language. Arabic gets all 6 forms; Chinese collapses to `_other`. Missing or extra categories are `critical`. |
| Adding 2 English keys re-translates the entire 1,200-key namespace | Diff-mode (default) only sends missing or source-mirroring keys to the translator. Plural groups stay atomic. |
| A killed process leaves a half-written `fr.json` that crashes i18next at runtime | Atomic writes: `tmp` file + `rename`. The runtime never sees a partial locale. |
| The model declares `"approved"` while listing a critical issue | Verdict reconciler trusts the issues list over the label. Critical → `rejected`, major or confidence < 70 → `needs-human`. |
| A crashed run loses an hour of progress | Per-namespace checkpoint. Re-invoking the same command resumes where it stopped. |

## Install

```bash
npm install -D @monkey-dev-vibes/claude-translate-i18next @anthropic-ai/sdk
```

Node 18+. `@anthropic-ai/sdk` is a peer dependency — bring your own version.

## Quickstart

### 1. Drop a config file in your project root

```ts
// translate.config.ts
import { buildHardRulesBlock, renderGlossary } from '@monkey-dev-vibes/claude-translate-core';
import type { PipelineConfig } from '@monkey-dev-vibes/claude-translate-i18next';

const config: PipelineConfig = {
  sourceDir: './locales',
  appDescription: 'a SaaS project-management web app',
  domainRules: buildHardRulesBlock(
    [
      'Brand names "Acme" and "AcmePro" stay in English in every language.',
      'Code identifiers in backticks stay verbatim.',
    ],
    { includeGeneric: true },
  ),
  glossaryBlocks: {
    fr: renderGlossary('fr', [
      { en: 'dashboard', target: 'tableau de bord' },
      { en: 'checkout', target: 'caisse' },
    ]),
  },
  languageNotes: {
    fr: 'Use formal register (vous). Prefer concise verbal phrasing for buttons.',
  },
};

export default config;
```

### 2. Translate

```bash
export ANTHROPIC_API_KEY=sk-ant-...

npx claude-translate-i18next \
  --target fr \
  --translator-model claude-3-5-sonnet-latest \
  --reviewer-model claude-opus-4-latest
```

That's it. Run it again tomorrow after adding two English keys and only those two keys will hit Claude — diff-mode is on by default.

### 3. Or call the API directly

```ts
import Anthropic from '@anthropic-ai/sdk';
import { run } from '@monkey-dev-vibes/claude-translate-i18next';
import config from './translate.config.js';

const client = new Anthropic();
const { results, skipped } = await run({
  client,
  config,
  options: {
    targetLanguage: 'fr',
    translatorModel: 'claude-3-5-sonnet-latest',
    reviewerModel: 'claude-opus-4-latest',
  },
});

for (const r of results) console.log(r.summary);
```

## The pipeline

```text
locales/en/<namespace>.json
         │
         ▼
┌────────────────────┐     ┌──────────────────────────┐
│ Diff subset        │────▶│ only missing or          │
│ (default)          │     │ source-mirroring keys    │
└────────────────────┘     └──────────────────────────┘
         │
         ▼
┌────────────────────┐     ┌──────────────────────────┐
│ Translator pass    │────▶│ flat translations        │
│ (Claude)           │     │ + expanded plural forms  │
└────────────────────┘     └──────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Structural validator (free)    │
│ - dotted-key shape parity      │
│ - interpolation preservation   │
│ - CLDR plural coverage         │
│ - non-empty translations       │
└────────────────────────────────┘
         │  short-circuit retry on critical
         ▼
┌────────────────────────────────┐
│ Reviewer pass (Claude)         │
│ verdict + issues + confidence  │
└────────────────────────────────┘
         │
   reconcileVerdict()
         │
   ┌─────┴───────────┬──────────────┐
   ▼                 ▼              ▼
approved        needs-human      rejected
   │                 │              │
   └──► atomic write + checkpoint   └──► retry (with reviewer notes)
```

## Five features worth knowing

### Diff-mode by default

Diff-mode only sends keys to the translator when the target locale is missing the key OR the on-disk value still mirrors English. Everything else is left alone. Plural groups (`_one`, `_few`, `_many`, `_other`) are atomic — any change pulls in the whole group so the structural validator never sees a half-translated group. Frozen keys are excluded from the subset entirely.

Pass `--force` to disable diff-mode and retranslate everything.

### Frozen-keys manifest

A simple JSON file pins translated values that must never regress:

```json
{
  "_notes": "Anything here is ignored by the loader.",
  "frozenKeys": {
    "common":   ["brand.*", "legal.disclaimer"],
    "settings": ["languageNote"]
  }
}
```

Patterns are dotted paths with `*` as a **single-segment** wildcard (`**` is reserved and rejected). Frozen keys are preserved byte-for-byte during the merge AND skipped in diff-mode so they don't waste tokens.

Pass `--ignore-freeze` when first-translating a new language whose locale file is still an English mirror copy — you want that initial pass to overwrite.

### Full CLDR plural coverage

The pipeline ships a default table for 18 common languages — Arabic gets all 6 forms (`zero`/`one`/`two`/`few`/`many`/`other`), Russian gets 4, Romanian and Polish get 3, Chinese collapses to `other`, etc. For any other language, supply a `cldrPlurals` entry in your config:

```ts
const config: PipelineConfig = {
  sourceDir: './locales',
  cldrPlurals: {
    'pt-BR': ['one', 'other'],
  },
};
```

English `_one` / `_other` pairs are auto-expanded into the full required set. Missing or extra categories are `critical` structural issues, flagged before the reviewer is even called.

### Interpolation-token preservation

Every `{{var}}` placeholder in the source must appear verbatim in the translation. The validator extracts placeholder sets from both sides and flags drift as `critical`. Common failure modes caught:

- Translator drops a placeholder (`{{count}}` missing from the translation).
- Translator translates the variable name (`{{name}}` → `{{nom}}`).
- Translator invents an extra placeholder.

### Atomic writes + per-namespace checkpoint

The locale file is written via `tmp` + `rename`. The runtime never sees a half-written JSON. After the write, a checkpoint entry lands at `.translate-checkpoint/<lang>-<namespace>.json` so the next invocation skips this namespace. `approved` and `needs-human` count as "done"; `rejected` retries on the next run.

## CLI

```text
claude-translate-i18next --target <lang> [options]
```

| Flag | Description |
| --- | --- |
| `--target <lang>` | **Required.** Target BCP-47 language code. |
| `--translator-model <id>` | **Required.** Claude model for the translator pass. |
| `--reviewer-model <id>` | **Required.** Claude model for the reviewer pass. |
| `--config <path>` | Config file path. Default: `./translate.config.{ts,mjs,js,json}`. |
| `--namespace <list>` | Comma-separated namespaces. Default: every JSON in source-lang folder. |
| `--dry-run` | Run translator + reviewer; skip disk writes and checkpoint. |
| `--force` | Disable diff-mode; retranslate every key. |
| `--ignore-freeze` | Bypass the freeze manifest for this run. |
| `--freeze-manifest <path>` | Freeze manifest JSON file. |
| `-h, --help` | Show help. |

## Configuration reference

```ts
interface PipelineConfig {
  sourceDir: string;                          // root of <lang>/*.json folders
  sourceLanguage?: string;                    // default 'en'
  cldrPlurals?: Record<string, readonly PluralCategory[]>;
  domainRules?: string;                       // pre-rendered HARD RULES block
  glossaryBlocks?: Record<string, string>;    // per-language glossary blocks
  languageNotes?: Record<string, string>;     // per-language free-form notes
  appDescription?: string;                    // injected into system prompts
}

interface PipelineOptions {
  targetLanguage: string;
  namespaces?: string[];
  dryRun?: boolean;
  maxAttempts?: number;                       // default 2
  checkpointPath?: string;                    // default ./.translate-checkpoint
  ignoreFreeze?: boolean;
  diffMode?: boolean;                         // default true
  freezeManifestPath?: string;
  translatorModel: string;
  reviewerModel: string;
  translatorMaxTokens?: number;               // default 8000
  reviewerMaxTokens?: number;                 // default 4096
  mockTranslator?: ...;                       // testing hook
  mockReviewer?: ...;
}
```

## Design choices

- **No default model.** Caller supplies translator + reviewer model IDs. Silent model upgrades are exactly the kind of regression that breaks production runs.
- **No baked-in domain content.** Every brand name, every regulation citation, every glossary entry comes from your config. The package works equally well for legal-tech, e-commerce, medical reference, or developer tooling.
- **Structural validators are free.** Plural coverage and interpolation parity run locally. A translator that drops a `{{count}}` never reaches the reviewer.
- **Plural groups are atomic.** Splitting a plural group across diff-mode runs would break runtime fallback rules. Pulling in the whole group is the safer default.
- **Atomic writes.** `tmp` + `rename`. The runtime never sees a partial locale file.

## Testing

```bash
npm test
```

42 tests across plural tables, interpolation drift detection, loader behaviour, freeze-pattern compilation, and full pipeline orchestration via injected mocks. Spends zero Anthropic tokens.

## License

[MIT](../../LICENSE)
