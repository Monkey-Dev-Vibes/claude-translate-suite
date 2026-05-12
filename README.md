# claude-translate-suite

[![CI](https://github.com/Monkey-Dev-Vibes/claude-translate-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Monkey-Dev-Vibes/claude-translate-suite/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![typescript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.base.json)

> Production-grade Claude translation pipelines that **don't** put raw LLM output into your product. Two-pass translate-then-review with verdict reconciliation, structural validation, frozen-keys protection, diff-mode, and checkpoint resumability. Plug it into your i18next JSON files, your Sanity CMS — or build your own adapter on the shared core.

## The problem this solves

You can wire up `JSON.stringify(en) → Claude → JSON.parse → ship` in an afternoon. The problem is what happens on the *fourth* run, when:

- one dropped `{{count}}` interpolation token silently breaks a sign-up flow in three locales,
- a re-run regresses every hand-finalised module title because the prompt drifted by a few sentences,
- the Russian build is missing two CLDR plural forms and the runtime renders raw `_one` keys,
- a malformed JSON response crashes a batch halfway through, leaving the checkpoint half-written,
- the model declared `"approved"` while listing a critical issue, and now it's in production.

This suite was built to make every one of those failure modes mechanically impossible — and to do it cheaply enough on re-runs that you can leave it on indefinitely.

## What's in the box

| Package | What it does |
| --- | --- |
| [`@monkey-dev-vibes/claude-translate-core`](./packages/core) | Reusable Claude primitives — API wrapper with streaming + retry, JSON-parse with auto-retry on truncation, reviewer-verdict parser, glossary block renderer, hard-rules block renderer. No domain content. No default model. |
| [`@monkey-dev-vibes/claude-translate-i18next`](./packages/i18next) | Translate `locales/en/*.json` into any target. Frozen-keys manifest, diff-mode, CLDR plural expansion (all 6 forms for Arabic, none for Chinese), interpolation-token preservation, atomic file writes, per-namespace checkpoint, cost preflight. |
| [`@monkey-dev-vibes/claude-translate-sanity`](./packages/sanity) | Translate Sanity CMS documents with verdict states (`approved` / `needs-human` / `rejected`), Portable Text-safe extraction (pluggable preserved marks), deterministic translation `_id`s, refiner-pass for `needs-human` → `approved` promotion. |

Install one, two, or all three — they're published independently. They share a single `core` peer dependency so version skew between adapters is impossible.

## The two-pass quality gate

Most LLM translation pipelines write raw model output straight to disk. This suite adds a **dedicated reviewer call** that audits the translation against the source and emits one of three verdicts:

```text
                source content
                       │
                       ▼
              ┌────────────────────┐
              │ Translator (Claude)│
              └────────────────────┘
                       │
                       ▼
              ┌────────────────────┐
              │ Structural checks  │  free, runs locally
              │ - shape parity     │  short-circuits on critical
              │ - interpolation    │
              │ - plural coverage  │
              └────────────────────┘
                       │
                       ▼
              ┌────────────────────┐
              │ Reviewer (Claude)  │
              │ verdict + issues   │
              │ + confidence + notes
              └────────────────────┘
                       │
              reconcileVerdict()    ← trusts the issues list over the label
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    approved      needs-human     rejected
        │              │              │
        ▼              ▼              ▼
   write + cp    write + cp     retry with
                                reviewer's
                                feedback
```

The reconciler is the secret weapon. It catches the failure mode where the model declares `"approved"` while listing a `critical`-severity issue (silently demotes to `rejected`) and downgrades borderline `confidence < 70` outputs to `needs-human` even when the model said `approved`. You can trust the verdict because the verdict is computed, not asserted.

## Five features that move the needle

### 1. Diff-mode by default

A re-run after adding ten English keys translates ten keys — not the whole namespace. Diff-mode walks the source bundle, compares it to the on-disk target, and only sends the missing or stale entries to the translator. Plural groups stay atomic (any change pulls in the whole `_one`/`_few`/`_many`/`_other` set) so the structural validator never sees a half-translated group.

### 2. Frozen-keys manifest

Some translations are not for the model to touch — brand strings, legal disclaimers, hand-finalised module names. A simple JSON manifest with `*` wildcards locks them. Re-runs preserve frozen values byte-for-byte and even *skip* them in diff-mode so they don't waste tokens.

### 3. Auto-retry on truncated JSON

Claude occasionally truncates output near `max_tokens`. A naive retry wrapper handles 429s and 5xxs but lets the resulting JSON parse error crash the run. This pipeline wraps the entire `call → parse` cycle in a single retry envelope and treats `PipelineParseError` as retryable exactly once. Two consecutive parse failures are re-thrown immediately so the process fails loudly instead of burning tokens.

### 4. Per-namespace / per-doc checkpointing

Every completed unit is recorded to `.translate-checkpoint/` with an atomic temp-file + rename. A killed or crashed run resumes from the last successful unit on re-invoke. Checkpoints are plain JSON, safe to commit, and provide an audit trail.

### 5. Pluggable domain rules — zero content baked in

Brand names that stay in English, regulation citations that round-trip verbatim, industry-specific glossaries — all caller-supplied via your config. The suite ships exactly **no** baked-in vocabulary, so it works equally well for a legal-tech CMS, an e-commerce site, a medical reference, or a developer tool.

```ts
import { buildHardRulesBlock, renderGlossary } from '@monkey-dev-vibes/claude-translate-core';

const config = {
  domainRules: buildHardRulesBlock(
    [
      'Brand names "Acme" and "AcmePro" stay in English in every language.',
      'Regulation citations like "ISO 9001" or "GDPR Article 17" stay verbatim.',
    ],
    { includeGeneric: true },
  ),
  glossaryBlocks: {
    fr: renderGlossary('fr', [
      { en: 'dashboard', target: 'tableau de bord' },
      { en: 'checkout', target: 'caisse' },
    ]),
  },
};
```

## Quickstart (i18next)

```bash
npm install -D @monkey-dev-vibes/claude-translate-i18next @anthropic-ai/sdk
export ANTHROPIC_API_KEY=sk-ant-...

npx claude-translate-i18next \
  --target fr \
  --translator-model claude-3-5-sonnet-latest \
  --reviewer-model claude-opus-4-latest
```

That's it. Drop a `translate.config.ts` next to your `locales/` directory and you're translating. See [`packages/i18next/README.md`](./packages/i18next/README.md) for the full quickstart.

## Quickstart (Sanity)

```bash
npm install -D @monkey-dev-vibes/claude-translate-sanity @anthropic-ai/sdk @sanity/client
export ANTHROPIC_API_KEY=sk-ant-...
export SANITY_PROJECT_ID=...
export SANITY_API_TOKEN=...

npx claude-translate-sanity run \
  --target fr \
  --translator-model claude-3-5-sonnet-latest \
  --reviewer-model claude-opus-4-latest
```

See [`packages/sanity/README.md`](./packages/sanity/README.md) for full configuration including Portable Text handling and the refiner pass.

## Design choices worth knowing

- **No default model ID.** The translator and reviewer model strings are caller-supplied. Silent model upgrades are exactly the kind of regression that breaks production runs — pinning is your responsibility.
- **No baked-in domain content.** The package ships zero industry-specific vocabulary, zero hardcoded glossaries, zero example client names. Bring your own.
- **Structural validators are free.** Interpolation parity, plural coverage, and shape parity run locally before any reviewer call. Catastrophic translator output gets caught without spending Opus tokens on a review.
- **Streaming above 16k tokens.** The Anthropic SDK enforces a 10-minute non-streaming timeout. The wrapper auto-switches to streaming above the threshold so larger payloads don't get aborted at the SDK timeout boundary.
- **One retry for `PipelineParseError`.** Two consecutive parse failures is structural, not stochastic. We fail loudly rather than burning tokens.
- **Atomic file writes.** Locale files and checkpoints are written as `tmp` + `rename`. A killed process never leaves a half-written JSON that crashes i18next at runtime.

## Repo layout

```text
claude-translate-suite/
├── packages/
│   ├── core/         shared primitives
│   ├── i18next/      JSON locale adapter
│   └── sanity/       Sanity CMS adapter
├── package.json      npm workspaces root
└── tsconfig.base.json
```

## Local development

```bash
git clone https://github.com/Monkey-Dev-Vibes/claude-translate-suite
cd claude-translate-suite
npm install
npm test          # runs every package's test suite
npm run build     # builds every package
npm run typecheck # strict TS across the suite
```

Every package's test suite uses injected mocks for the translator and reviewer — zero Anthropic tokens are spent during local development or CI.

## License

[MIT](./LICENSE) — use it however you like, including in commercial products.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, architecture invariants, and the three load-bearing rules (core stays runtime-dep-free, no baked-in domain content, every change ships with mocked tests).
