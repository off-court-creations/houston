import { Command } from 'commander';
import { loadConfig, type CliConfig } from '../config/config.js';
import { addLabels, loadLabels } from '../services/label-store.js';
import { canPrompt, promptConfirm, promptText } from '../lib/interactive.js';
import { c } from '../lib/colors.js';

interface AddLabelOptions {
  interactive?: boolean;
  id?: string;
  labels?: string;
}

export function registerLabelCommand(program: Command): void {
  const label = program
    .command('label')
    .description('Manage labels taxonomy')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston label add --id frontend\n  $ houston label add --labels frontend,backend,docs --no-interactive\n  $ houston label add --interactive\n  $ houston label list\n`,
    );

  label
    .command('add')
    .description('Add one or more labels to taxonomies/labels.yaml')
    .option('--id <label>', 'single label value')
    .option('--labels <list>', 'comma separated labels')
    .option('-i, --interactive', 'prompt for values when omitted')
    .action(async (opts: AddLabelOptions) => {
      if (!opts.id && !opts.labels) {
        opts.interactive = true;
      }
      await handleLabelAdd(opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston label add --id frontend\n  $ houston label add --labels frontend,backend,infra\n  $ houston label add --interactive\n`,
    );

  label
    .command('list')
    .description('List configured labels')
    .option('-j, --json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig();
      const labels = loadLabels(config);
      if (opts.json) {
        console.log(JSON.stringify(labels, null, 2));
        return;
      }
      if (labels.length === 0) {
        console.log('No labels defined.');
        return;
      }
      for (const value of labels) {
        console.log(value);
      }
    })
    .addHelpText('after', `\nExamples:\n  $ houston label list\n  $ houston label list --json\n`);
}

async function handleLabelAdd(opts: AddLabelOptions): Promise<void> {
  const config = loadConfig();
  const interactive = Boolean(opts.interactive || (!opts.id && !opts.labels));
  if (interactive && !canPrompt()) {
    throw new Error('Missing required options: --id or --labels. Re-run with --interactive in a terminal or provide flags.');
  }

  if (interactive) {
    await runInteractiveLabelAdd(config);
    return;
  }

  const values = collectLabels(opts);
  if (values.length === 0) {
    throw new Error('No labels provided. Use --id, --labels, or --interactive.');
  }
  addLabels(config, values);
  console.log(c.ok(`Recorded ${values.length} label(s) in taxonomies/labels.yaml`));
}

function collectLabels(opts: AddLabelOptions): string[] {
  const result: string[] = [];
  if (opts.id) result.push(...parseLabelInput(opts.id));
  if (opts.labels) {
    result.push(...parseLabelInput(opts.labels));
  }
  return dedupeLabels(result);
}

async function runInteractiveLabelAdd(config: CliConfig): Promise<void> {
  await addPromptedLabels(config);
  if (!canPrompt()) return;
  while (true) {
    const again = await promptConfirm('Add another label?', false);
    if (!again) break;
    await addPromptedLabels(config);
  }
}

async function addPromptedLabels(config: CliConfig): Promise<void> {
  const values = await promptForLabelValues();
  if (values.length === 0) {
    return;
  }
  addLabels(config, values);
  for (const value of values) {
    console.log(c.ok(`Recorded label ${c.id(value)} in taxonomies/labels.yaml`));
  }
}

async function promptForLabelValues(): Promise<string[]> {
  while (true) {
    const value = await promptText('Label (e.g., frontend, backend, docs)', {
      required: true,
      validate: (input) => (input.trim() === '' ? 'Label is required.' : null),
    });
    const labels = dedupeLabels(parseLabelInput(value));
    if (labels.length > 0) {
      return labels;
    }
    console.log('Provide at least one label (comma separated).');
  }
}

function parseLabelInput(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value === '') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
