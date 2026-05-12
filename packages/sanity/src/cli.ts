#!/usr/bin/env node
/**
 * CLI entry for the Sanity translation pipeline.
 *
 * Expects a config file (`translate.config.{ts,mjs,js,json}`) exporting a
 * `PipelineConfig`. Translator + reviewer model IDs are caller-supplied; no
 * defaults to keep silent model upgrades from regressing production output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

import { refineNeedsHuman } from './refine.js';
import { run } from './pipeline.js';
import { createSanityClient } from './sanity.js';
import type { PipelineConfig, PipelineOptions } from './types.js';

interface CliArgs {
  command: 'run' | 'refine-nh';
  configPath?: string;
  target?: string;
  types?: string[];
  onlyIds?: string[];
  dryRun: boolean;
  translatorModel?: string;
  reviewerModel?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: 'run', dryRun: false, help: false };
  let i = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    out.command = argv[0] === 'refine-nh' ? 'refine-nh' : 'run';
    i = argv[0] === 'run' || argv[0] === 'refine-nh' ? 1 : 0;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--config': out.configPath = argv[++i]; break;
      case '--target': out.target = argv[++i]; break;
      case '--type':
      case '--types': {
        const v = argv[++i];
        if (v) out.types = v.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--only-ids': {
        const v = argv[++i];
        if (v) out.onlyIds = v.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--dry-run': out.dryRun = true; break;
      case '--translator-model': out.translatorModel = argv[++i]; break;
      case '--reviewer-model': out.reviewerModel = argv[++i]; break;
      case '-h':
      case '--help': out.help = true; break;
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
    `claude-translate-sanity — two-pass Claude translation for Sanity CMS documents

Usage:
  claude-translate-sanity [run|refine-nh] --target <lang> [options]

Commands:
  run         (default) Fetch source docs, translate + review, write to Sanity.
  refine-nh   Re-run the translator on docs previously verdicted "needs-human"
              and promote successful ones to "approved".

Required:
  --target <lang>            Target language code.
  --translator-model <id>    Claude model for the translator pass.
  --reviewer-model <id>      Claude model for the reviewer pass.

Config:
  --config <path>            Config file (.ts, .mjs, .js, or .json). Default:
                             ./translate.config.ts → .mjs → .js → .json

Options:
  --type <list>              Comma-separated doc types. Default: every type in config.
  --only-ids <list>          Comma-separated source _id values to translate.
  --dry-run                  Run translator + reviewer; skip Sanity writes and checkpoint.
  -h, --help                 Show this help.

Environment:
  ANTHROPIC_API_KEY          Required.
  SANITY_PROJECT_ID          Required (or pass programmatically).
  SANITY_API_TOKEN           Required (editor-scoped for write access).
  SANITY_DATASET             Optional. Defaults to "production".
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
  let resolved = configPath;
  if (!resolved) {
    for (const c of CONFIG_CANDIDATES) {
      const full = path.resolve(process.cwd(), c);
      if (fs.existsSync(full)) { resolved = full; break; }
    }
  }
  if (!resolved) {
    throw new Error(
      `No config file found. Expected one of: ${CONFIG_CANDIDATES.join(', ')} or --config <path>.`,
    );
  }
  if (resolved.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as PipelineConfig;
  }
  const mod = await import(pathToFileURL(resolved).href);
  const cfg = (mod.default ?? mod) as PipelineConfig;
  if (!cfg || typeof cfg !== 'object' || typeof cfg.docTypes !== 'object') {
    throw new Error(`Config at ${resolved} does not export a PipelineConfig (missing docTypes).`);
  }
  return cfg;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (!args.target) {
    process.stderr.write('Missing --target. See --help.\n');
    process.exit(2);
  }
  if (!args.translatorModel) {
    process.stderr.write('Missing --translator-model. See --help.\n');
    process.exit(2);
  }
  if (!args.reviewerModel) {
    process.stderr.write('Missing --reviewer-model. See --help.\n');
    process.exit(2);
  }

  const config = await loadConfig(args.configPath);
  const anthropic = new Anthropic();
  const sanity = createSanityClient();

  const options: PipelineOptions = {
    targetLanguage: args.target,
    types: args.types,
    onlyIds: args.onlyIds,
    dryRun: args.dryRun,
    translatorModel: args.translatorModel,
    reviewerModel: args.reviewerModel,
  };

  if (args.command === 'refine-nh') {
    const { attempted, promoted } = await refineNeedsHuman({
      client: anthropic,
      sanity,
      config,
      options,
    });
    process.stdout.write(
      `\nRefiner: ${attempted.length} attempted, ${promoted.length} promoted.\n`,
    );
    for (const r of attempted) process.stdout.write(`  ${r.summary}\n`);
    return;
  }

  const { results, skipped } = await run({
    client: anthropic,
    sanity,
    config,
    options,
  });
  process.stdout.write('\n');
  for (const s of skipped) {
    process.stdout.write(`  skipped ${s.sourceId} (${s.type}, ${s.reason})\n`);
  }
  for (const r of results) {
    process.stdout.write(`  ${r.summary}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
