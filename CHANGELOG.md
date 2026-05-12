# Changelog

All notable changes to the packages in this monorepo are documented here. The three packages — `core`, `i18next`, `sanity` — are versioned and released together until they need to diverge.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-12

Initial public release of the three-package suite.

### `@monkey-dev-vibes/claude-translate-core`

Reusable Claude translation primitives. No domain content, no default model.

- **Anthropic API wrapper** — auto-streams above 16k tokens to dodge the SDK's 10-minute non-streaming timeout. Retries 429 and 5xx with exponential backoff.
- **JSON-parse-with-retry envelope** — wraps `call → parse` as one unit. Truncated JSON triggers exactly one retry; two consecutive parse failures throw `PipelineParseError` rather than burning tokens.
- **Reviewer verdict parser** — parses reviewer JSON, extracts `verdict | confidence | issues | notes`, narrows issue `location` fields by generic parameter.
- **`reconcileVerdict()`** — the core safety net. Demotes `"approved"` to `"rejected"` when the issues list contains a `critical` severity entry; downgrades to `"needs-human"` when `confidence < 70`. Computed, not asserted.
- **Glossary block renderer** — formats per-target-language glossaries into a prompt-stable block. Accepts caller-supplied entries; ships no baked-in vocabulary.
- **Hard-rules block renderer** — emits a deterministic "DO NOT" block from a caller-supplied list of constraints, with optional generic rules (interpolation tokens stay verbatim, plural-form keys preserved, etc.).
- Strict TypeScript, dual ESM + CJS, zero runtime dependencies, `@anthropic-ai/sdk` as a peer.

### `@monkey-dev-vibes/claude-translate-i18next`

Two-pass Claude translation for `locales/<lang>/*.json` files.

- **Diff-mode by default** — translates only keys missing or stale on the target side. Plural groups stay atomic (`_one`/`_few`/`_many`/`_other` move together).
- **Frozen-keys manifest** — JSON manifest with `*` wildcards. Locked values are preserved byte-for-byte and skipped in diff-mode so they cost no tokens.
- **CLDR plural expansion** — emits all required plural forms per target locale (6 for Arabic, none for Chinese, etc.).
- **Interpolation-token preservation** — structural validator catches any dropped `{{token}}` before the reviewer call.
- **Per-namespace checkpoint** — `.translate-checkpoint/` records each completed namespace via atomic temp-file + rename. Killed runs resume from the last successful unit.
- **Cost preflight** — reports estimated input/output tokens and dollar cost before any model call.
- **CLI**: `claude-translate-i18next --target <lang> --translator-model <id> --reviewer-model <id>`.
- Strict TypeScript, dual ESM + CJS, `@anthropic-ai/sdk` as a peer.

### `@monkey-dev-vibes/claude-translate-sanity`

Two-pass Claude translation for Sanity CMS documents.

- **Verdict states** — every translated document carries `approved` / `needs-human` / `rejected`, derived from the reconciled reviewer verdict.
- **Portable Text-safe extraction** — round-trips Portable Text blocks with pluggable preserved marks so model output can never corrupt block structure.
- **Deterministic translation `_id`s** — `<sourceId>__<targetLang>` so re-runs are idempotent.
- **Refiner pass** — promotes `needs-human` translations to `approved` by re-prompting with the reviewer's issues list rather than from scratch.
- **Per-document checkpoint** — atomic temp-file + rename to `.translate-checkpoint/`, safe to commit, audit-trail-friendly.
- **Status mapping** — `verdictToStatus()` maps reviewer outcomes to a `translationStatus` field your editorial workflow can react to.
- **CLI**: `claude-translate-sanity run --target <lang> --translator-model <id> --reviewer-model <id>`.
- Strict TypeScript, dual ESM + CJS, `@anthropic-ai/sdk` and `@sanity/client` as peers.

### Cross-cutting

- **No baked-in domain content** — zero industry-specific vocabulary, brand names, or hardcoded glossaries in any package. Caller-supplied via config.
- **No default model IDs** — translator/reviewer model strings are caller-supplied. Silent model upgrades are exactly the regression class we built this suite to prevent.
- **Atomic file writes everywhere** — locale files and checkpoints are `tmp` + `rename`. A killed process never leaves a half-written JSON that crashes i18next at runtime.
- **Injected-mock test path** — every package's tests use mock translators and reviewers. Zero Anthropic tokens spent during local development or CI.
- **CI on Node 18 / 20 / 22** via GitHub Actions: `npm ci → build → typecheck → test`.

[0.1.0]: https://github.com/Monkey-Dev-Vibes/claude-translate-suite/releases/tag/v0.1.0
