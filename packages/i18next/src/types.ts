/**
 * Public types for the i18next translation pipeline.
 *
 * Languages are identified by BCP-47 strings (`en`, `fr`, `pt-BR`, …). The
 * pipeline accepts any string; callers must supply a matching `cldrPlurals`
 * entry in their config for non-default targets.
 */

import type { Verdict } from '@monkey-dev-vibes/claude-translate-core';

/** Nested locale JSON tree. Leaves are strings; branches are recursive bundles. */
export type LocaleBundle = { [key: string]: LocaleBundle | string };

/** CLDR plural category. Most languages use a subset. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** A leaf entry after flattening — dotted path + value + metadata. */
export interface Leaf {
  /** Dotted key path, e.g. `register.errors.passwordMinLength`. */
  path: string;
  /** English source text. */
  en: string;
  /** Plural stem if this is part of a `_one`/`_other` group; otherwise null. */
  pluralStem: string | null;
  /** Extracted i18next interpolation variable names. */
  interpolationVars: string[];
}

export interface PluralGroup {
  stem: string;
  one: Leaf;
  other: Leaf;
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  /** Dotted key path the issue applies to, if any. */
  key?: string;
  description: string;
  suggestion?: string;
}

export interface TranslatorOutput {
  /** Flat dotted-path → translation map (plurals already expanded). */
  translations: Record<string, string>;
  raw: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ReviewerOutput {
  verdict: Verdict;
  confidence: number;
  issues: ReviewIssue[];
  notes: string;
  raw: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface NamespaceResult {
  namespace: string;
  targetLanguage: string;
  /** Final translations keyed by dotted path. null when rejected. */
  translations: Record<string, string> | null;
  review: ReviewerOutput;
  attempts: number;
  totalTranslatorInputTokens: number;
  totalTranslatorOutputTokens: number;
  totalReviewerInputTokens: number;
  totalReviewerOutputTokens: number;
  summary: string;
}

/**
 * Caller-supplied pipeline configuration. Every project-specific detail —
 * paths, languages, glossaries, brand-name rules — lives here.
 */
export interface PipelineConfig {
  /**
   * Directory containing per-language locale folders, e.g. `./locales`. The
   * loader expects `<sourceDir>/<lang>/<namespace>.json`.
   */
  sourceDir: string;
  /** Source language code (default `en`). */
  sourceLanguage?: string;
  /**
   * Required plural categories per target language. Defaults to a sensible
   * table covering the common BCP-47 codes (see DEFAULT_CLDR_PLURALS). Add
   * entries for any target not in the defaults.
   */
  cldrPlurals?: Record<string, readonly PluralCategory[]>;
  /**
   * Domain-specific hard rules injected into translator + reviewer prompts.
   * Use `buildHardRulesBlock` from `@monkey-dev-vibes/claude-translate-core`
   * to compose. Pass an empty string for no extra rules.
   */
  domainRules?: string;
  /**
   * Per-language glossary blocks. Pre-rendered with `renderGlossary`. Each
   * entry is injected into prompts when translating its language.
   */
  glossaryBlocks?: Record<string, string>;
  /**
   * Per-language free-form notes injected into the prompt under a
   * "Language notes" header. Use for registers, plural quirks, script
   * conventions, etc.
   */
  languageNotes?: Record<string, string>;
  /**
   * Short app description injected into translator + reviewer system prompts
   * so the model knows the deployment context. Default: a generic UI string.
   */
  appDescription?: string;
}

export interface PipelineOptions {
  targetLanguage: string;
  /** Subset to process. Defaults to all `*.json` files in source-lang folder. */
  namespaces?: string[];
  dryRun?: boolean;
  maxAttempts?: number;
  /** Directory for checkpoint files. Defaults to `.translate-checkpoint/` in cwd. */
  checkpointPath?: string;
  /** When true, freeze manifest is ignored for this run. */
  ignoreFreeze?: boolean;
  /** When true (default), only changed/missing keys are translated. */
  diffMode?: boolean;
  /** Path to a freeze manifest file. Optional. */
  freezeManifestPath?: string;
  /** Translator model ID (caller-supplied; no built-in default). */
  translatorModel: string;
  /** Reviewer model ID (caller-supplied; no built-in default). */
  reviewerModel: string;
  /** Max output tokens for translator. Default 8000. */
  translatorMaxTokens?: number;
  /** Max output tokens for reviewer. Default 4096. */
  reviewerMaxTokens?: number;
  /** Optional in-memory mocks for testing without burning Claude tokens. */
  mockTranslator?: (
    namespace: string,
    source: LocaleBundle,
    lang: string,
  ) => Promise<TranslatorOutput>;
  mockReviewer?: (
    namespace: string,
    source: LocaleBundle,
    translation: Record<string, string>,
    lang: string,
  ) => Promise<ReviewerOutput>;
}
