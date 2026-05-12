# Contributing

PRs welcome. Three rules:

1. **The `core` package must remain runtime-dependency-free** except for its peer on `@anthropic-ai/sdk`.
2. **No domain-specific vocabulary, brand names, or industry rules** in any package. Domain content belongs in user config.
3. **New behaviour ships with tests** that exercise it via the injected mock path. No real Claude calls in the suite.

## Development

```bash
git clone https://github.com/Monkey-Dev-Vibes/claude-translate-suite
cd claude-translate-suite
npm install
npm test          # runs every package's test suite (vitest, mocked)
npm run typecheck # strict TS across the suite
npm run build     # builds every package via tsup
```

Every package's test suite uses injected mocks for the translator and reviewer — zero Anthropic tokens are spent during local development or CI.

## Before opening a PR

- [ ] `npm test` passes across all workspaces
- [ ] `npm run typecheck` passes (strict mode)
- [ ] `npm run build` succeeds
- [ ] New behaviour is covered by a test that uses the mock translator/reviewer
- [ ] No new runtime dependency in `core`
- [ ] No domain-specific vocabulary added to any package

## Architecture invariants

These are load-bearing — please respect them in PRs:

- **`core` ships zero default model IDs.** Translator and reviewer model strings are caller-supplied.
- **Structural validators run before reviewer calls.** Catastrophic translator output gets caught locally without spending Opus tokens.
- **`PipelineParseError` retries exactly once.** Two consecutive parse failures are re-thrown loudly.
- **File writes are atomic** (`tmp` + `rename`). Never leave a half-written JSON.

## Reporting bugs

Open an [issue](https://github.com/Monkey-Dev-Vibes/claude-translate-suite/issues) with: which adapter (`i18next` / `sanity` / `core`), the relevant config snippet (redact API keys), the source/target content if shareable, and the observed vs expected output. Stack traces from `PipelineParseError` or the verdict reconciler are especially useful.
