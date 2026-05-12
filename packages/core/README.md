# @monkey-dev-vibes/claude-translate-core

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![typescript](https://img.shields.io/badge/typescript-strict-blue.svg)](./tsconfig.json)

> The reusable primitives behind the [claude-translate-suite](https://github.com/monkey-dev-vibes/claude-translate-suite) translation pipelines. A Claude API wrapper that auto-streams + auto-retries, JSON parsing that survives truncated output, a reviewer-verdict parser that catches "approved with a critical issue" silently, plus prompt-block renderers for glossaries and hard rules.
>
> No domain content. No default model. Build your own pipeline on top.

## Why this exists

Every Claude-powered batch job runs into the same handful of problems:

- **Truncated JSON.** A response cut off mid-object throws `JSON.parse` and kills your run. Generic retry libraries don't help — they only watch for transport failures.
- **Verdict mismatches.** The model declares `"approved"` and then lists a `critical`-severity issue right beneath it. You need a reconciliation step that trusts the issues list over the label.
- **Timeout cliffs.** The Anthropic SDK aborts non-streaming calls at 10 minutes. Larger payloads with `max_tokens: 32000` need streaming — but you don't want to write two code paths.
- **Glossary drift.** The same technical term gets three spellings across a long run because nothing pinned it. You need a way to inject a `term → translation` table into the system prompt as mechanical substitution.
- **Hard-rule fatigue.** Per-prompt directives ("brand names stay in English", "regulation citations are verbatim") need consistent formatting and a baseline of always-on rules so you don't reinvent them per project.

This package is the small toolkit that solves all five — and nothing else. Use it as the substrate for your own translation, summarisation, or QA pipelines.

## What's in the box

```ts
import {
  // The Claude API wrapper — auto-streams + auto-retries.
  callClaude,
  callClaudeWithParser,
  STREAMING_MIN_TOKENS,

  // Retry envelope — exponential backoff with parse-error recovery.
  withRetry,

  // JSON-safe response parsing.
  safeParseJson,
  stripCodeFence,
  PipelineParseError,

  // Reviewer-verdict parsing and reconciliation.
  parseReviewerResponse,
  reconcileVerdict,

  // Prompt-block renderers.
  renderGlossary,
  findGlossaryDrift,
  buildHardRulesBlock,
  GENERIC_HARD_RULES,
} from '@monkey-dev-vibes/claude-translate-core';
```

## Install

```bash
npm install @monkey-dev-vibes/claude-translate-core @anthropic-ai/sdk
```

`@anthropic-ai/sdk` is a **peer dependency** — bring your own version so you control model availability.

## The headline patterns

### Pattern 1: one retry-safe Claude call

```ts
import Anthropic from '@anthropic-ai/sdk';
import { callClaude } from '@monkey-dev-vibes/claude-translate-core';

const client = new Anthropic();
const { raw, inputTokens, outputTokens } = await callClaude({
  client,
  model: 'claude-3-5-sonnet-latest',   // caller-supplied; no default
  maxTokens: 4096,
  system: 'You are a JSON-only translation API.',
  user: 'Translate { "hi": "hello" } to French.',
  role: 'Translator',                   // shows up in error messages
});
```

`callClaude` retries 429s, 5xxs, socket failures, and bare `"Connection error."` strings the SDK surfaces. Above `STREAMING_MIN_TOKENS` (16k) it auto-switches to streaming so larger payloads don't hit the SDK's 10-minute non-streaming timeout.

### Pattern 2: parse-retry on truncated output

```ts
import { callClaudeWithParser, PipelineParseError } from '@monkey-dev-vibes/claude-translate-core';

const { parsed } = await callClaudeWithParser(
  { client, model, maxTokens, system, user, role: 'Translator' },
  (raw) => {
    const obj = JSON.parse(raw) as Record<string, string>;
    if (!obj.translations) throw new PipelineParseError('missing translations', raw);
    return obj;
  },
);
```

The whole `call → parse` cycle runs inside one retry envelope. If Claude truncates output near `max_tokens` and the parser throws `PipelineParseError`, the wrapper retries the entire call **exactly once**. Two consecutive parse failures is structural, not stochastic — it re-throws immediately so the process fails loudly instead of burning tokens.

### Pattern 3: verdict reconciliation

The expected reviewer output shape (shown with TypeScript-style unions for clarity):

```jsonc
{
  "verdict":    "approved" | "needs-human" | "rejected",
  "confidence": 0-100,
  "issues": [
    { "severity":      "critical" | "major" | "minor",
      "description":   "...",
      "suggestion":    "...",
      "<locationKey>": "..." }
  ],
  "notes": "..."
}
```

```ts
import { parseReviewerResponse, reconcileVerdict } from '@monkey-dev-vibes/claude-translate-core';

const review = parseReviewerResponse(rawReviewerOutput, 'field');
const verdict = reconcileVerdict(review);
// → 'rejected' when issues contain ANY critical,
//   'needs-human' on any major OR confidence < 70,
//   'approved' otherwise.
```

The reconciler is the safety net against the failure mode where the model declares `"approved"` while listing a `critical`-severity issue. The label is asserted; the verdict is computed.

### Pattern 4: glossary blocks

Stochastic generation drifts on technical vocabulary. The fix is to inject a `term → translation` table into the system prompt so the right form is mechanical:

```ts
import { renderGlossary } from '@monkey-dev-vibes/claude-translate-core';

const block = renderGlossary('fr', [
  { en: 'dashboard', target: 'tableau de bord' },
  { en: 'checkout',  target: 'caisse' },
]);
// → REQUIRED TERMINOLOGY for fr — use exactly these forms:
//   - dashboard → tableau de bord
//   - checkout → caisse
```

After translation, `findGlossaryDrift(source, translation, glossary)` returns the entries whose source term was present but whose target form is missing — a free post-hoc validator.

### Pattern 5: hard-rules blocks

```ts
import { buildHardRulesBlock } from '@monkey-dev-vibes/claude-translate-core';

const block = buildHardRulesBlock(
  [
    'Brand names "Acme" and "AcmePro" stay in English in every language.',
    'Regulation citations like "ISO 9001" or "GDPR Article 17" stay verbatim.',
  ],
  { includeGeneric: true },
);
// → HARD RULES — these override any translation convenience:
//   1. Interpolation tokens such as {{name}}, {0}, %s ...
//   2. Numerical values and their units are preserved exactly ...
//   3. HTML tags, markdown syntax ...
//   4. URLs, email addresses, file paths ...
//   5. Brand names "Acme" and "AcmePro" stay in English ...
//   6. Regulation citations ...
```

`GENERIC_HARD_RULES` is exported as an array if you want to inspect or filter the baseline before composing.

## API reference

| Export | Type | Purpose |
| --- | --- | --- |
| `callClaude(params)` | `(p) => Promise<{ raw, inputTokens, outputTokens }>` | One retry-safe Claude call. Auto-streams above 16k tokens. |
| `callClaudeWithParser(params, parser)` | `(p, fn) => Promise<{ parsed, raw, ... }>` | Wraps the call + parse cycle in one retry envelope. |
| `STREAMING_MIN_TOKENS` | `number` (16000) | The cut-over threshold. |
| `withRetry(fn, options?)` | `(fn) => Promise<T>` | Generic exponential-backoff retry wrapper. |
| `safeParseJson(raw)` | `(s) => unknown` | `JSON.parse` plus code-fence stripping; throws `PipelineParseError`. |
| `stripCodeFence(raw)` | `(s) => string` | Strips a leading/trailing ` ```json ` fence if present. |
| `PipelineParseError` | `class` | Carries the original `raw` string for debugging. |
| `parseReviewerResponse(raw, locationKey)` | `(s, k) => ParsedReviewerResponse` | Parses the reviewer JSON shape. |
| `reconcileVerdict(review)` | `(r) => 'approved' \| 'needs-human' \| 'rejected'` | Computes the verdict from severities + confidence. |
| `renderGlossary(lang, entries, options?)` | `(...) => string` | Renders a prompt block from `[{en, target}]`. |
| `findGlossaryDrift(source, translation, entries)` | `(...) => GlossaryEntry[]` | Post-hoc validator. |
| `buildHardRulesBlock(rules, options?)` | `(...) => string` | Renders numbered HARD RULES block; optionally prepends `GENERIC_HARD_RULES`. |
| `GENERIC_HARD_RULES` | `string[]` | Always-on baseline rules (interpolation tokens, numerals, markup, URLs/dates). |

## Design choices

- **No default model.** Calling `callClaude` requires an explicit `model` string. Silent model upgrades are exactly the kind of regression that breaks production runs.
- **No bundled glossary or domain content.** Brand names, regulation citations, industry vocabulary — all come from your config. This package ships only formatting primitives.
- **Streaming above 16k tokens.** Hard limit; not configurable. The Anthropic SDK timeout boundary doesn't move.
- **One retry for `PipelineParseError`.** Two consecutive parse failures is structural, not stochastic.
- **Structural type guards.** The text-block filter for `response.content` uses a structural narrow rather than a versioned namespace import — survives SDK major-version churn.

## Testing

```bash
npm test
```

42 tests across parsing, retry semantics, glossary rendering, drift detection, and hard-rules composition. All run via injected mocks; zero Anthropic tokens spent.

## License

[MIT](../../LICENSE)
