#!/usr/bin/env node
/**
 * CLI entry for the i18next translation pipeline.
 *
 * The CLI deliberately stays minimal — it expects a config file
 * (`translate.config.{ts,mjs,js,json}`) that exports a `PipelineConfig` and
 * optionally a default model pair. For more flexibility, import `run()` from
 * the package directly in your own script.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

import { run } from './pipeline.js';
import type { PipelineConfig, PipelineOptions } from './types.js';

interface CliArgs {
  configPath?: string;
  target?: string;
  namespaces?: string[];
  dryRun: boolean;
  force: boolean;
  ignoreFreeze: boolean;
  freezeManifest?: string;
  translatorModel?: string;
  reviewerModel?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    force: false,
    ignoreFreeze: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--config':
        out.configPath = argv[++i];
        break;
      case '--target':
        out.target = argv[++i];
        break;
      case '--namespace':
      case '--namespaces': {
        const v = argv[++i];
        if (v) out.namespaces = v.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--force':
        out.force = true;
        break;
      case '--ignore-freeze':
        out.ignoreFreeze = true;
        break;
      case '--freeze-manifest':
        out.freezeManifest = argv[++i];
        break;
      case '--translator-model':
        out.translatorModel = argv[++i];
        break;
      case '--reviewer-model':
        out.reviewerModel = argv[++i];
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      default:
        if (a && a.startsWith('--')) {
          process.stderr.write(`Unknown flag: ${a}\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `claude-translate-i18next — two-pass Claude translation for i18next JSON locale files

Usage:
  claude-translate-i18next --target <lang> [--config <path>] [options]

Required:
  --target <lang>            Target language code (BCP-47).

Config:
  --config <path>            Config file (.ts, .mjs, .js, or .json). Default:
                             ./translate.config.ts → .mjs → .js → .json
                             Must export a PipelineConfig (default export).

Options:
  --namespace <list>         Comma-separated namespace file stems to process.
                             Default: every *.json file in <sourceDir>/<sourceLang>/.
  --dry-run                  Run translator + reviewer; skip disk writes and checkpoint.
  --force                    Disable diff-mode; retranslate every key.
  --ignore-freeze            Bypass the freeze manifest for this run.
  --freeze-manifest <path>   Path to a freeze manifest JSON file.
  --translator-model <id>    Claude model for the translator pass.
  --reviewer-model <id>      Claude model for the reviewer pass.
  -h, --help                 Show this help.

Environment:
  ANTHROPIC_API_KEY          Required for live runs.
`,
  );
}

const CONFIG_CANDIDATES = [
  'translate.config.ts',
  'translate.config.mjs',
  'translate.config.js',
  'translate.config.json',
];

async function loadConfig(configPath?: string): Promise<PipelineConfig> {
  let resolved: string | undefined = configPath;
  if (!resolved) {
    for (const c of CONFIG_CANDIDATES) {
      const full = path.resolve(process.cwd(), c);
      if (fs.existsSync(full)) {
        resolved = full;
        break;
      }
    }
  }
  if (!resolved) {
    throw new Error(
      `No config file found. Expected one of: ${CONFIG_CANDIDATES.join(', ')} in ${process.cwd()}, ` +
        `or pass --config <path>.`,
    );
  }
  if (resolved.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as PipelineConfig;
  }
  const mod = await import(pathToFileURL(resolved).href);
  const cfg = (mod.default ?? mod) as PipelineConfig;
  if (!cfg || typeof cfg !== 'object' || typeof cfg.sourceDir !== 'string') {
    throw new Error(`Config at ${resolved} does not export a PipelineConfig (missing sourceDir).`);
  }
  return cfg;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.target) {
    process.stderr.write('Missing required --target <lang>. See --help.\n');
    process.exit(2);
  }
  if (!args.translatorModel) {
    process.stderr.write('Missing required --translator-model <id>. See --help.\n');
    process.exit(2);
  }
  if (!args.reviewerModel) {
    process.stderr.write('Missing required --reviewer-model <id>. See --help.\n');
    process.exit(2);
  }

  const config = await loadConfig(args.configPath);
  const client = new Anthropic();

  const options: PipelineOptions = {
    targetLanguage: args.target,
    namespaces: args.namespaces,
    dryRun: args.dryRun,
    diffMode: !args.force,
    ignoreFreeze: args.ignoreFreeze,
    freezeManifestPath: args.freezeManifest,
    translatorModel: args.translatorModel,
    reviewerModel: args.reviewerModel,
  };

  const { results, skipped } = await run({ client, config, options });

  process.stdout.write('\n');
  for (const s of skipped) {
    process.stdout.write(`  skipped ${s.namespace} (${s.reason})\n`);
  }
  for (const r of results) {
    process.stdout.write(`  ${r.summary}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
