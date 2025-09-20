import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadComponents } from '../services/component-store.js';
import { normalizeComponentId, promptComponentDetails, registerComponent } from '../services/component-manager.js';
import { loadComponentRouting } from '../services/component-routing-store.js';
import { c } from '../lib/colors.js';
import { canPrompt, promptConfirm } from '../lib/interactive.js';

interface AddComponentOptions {
  interactive?: boolean;
  id?: string;
  repos?: string;
}

export function registerComponentCommand(program: Command): void {
  const component = program
    .command('component')
    .description('Manage components taxonomy')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston component add --id web --repos repo.web\n  $ houston component add --interactive\n  $ houston component list\n`,
    );

  component
    .command('add')
    .description('Add or update a component')
    .option('--id <component>', 'component identifier (slug)')
    .option('--repos <list>', 'comma separated repo ids associated with the component')
    .option('-i, --interactive', 'prompt for fields when omitted')
    .action(async (opts: AddComponentOptions) => {
      if (!opts.id && !opts.repos) {
        opts.interactive = true;
      }
      await handleComponentAdd(opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston component add --id web --repos repo.web,repo.api\n  $ houston component add --interactive\n`,
    );

  component
    .command('list')
    .description('List configured components')
    .option('-j, --json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig();
      const components = loadComponents(config);
      if (opts.json) {
        console.log(JSON.stringify(components, null, 2));
        return;
      }
      if (components.length === 0) {
        console.log('No components defined.');
        return;
      }
      for (const componentId of components) {
        console.log(componentId);
      }
    })
    .addHelpText('after', `\nExamples:\n  $ houston component list\n  $ houston component list --json\n`);
}

async function handleComponentAdd(opts: AddComponentOptions): Promise<void> {
  const config = loadConfig();
  const interactive = Boolean(opts.interactive || !opts.id);
  if (interactive && !canPrompt()) {
    throw new Error('Missing required options: --id. Re-run with --interactive in a terminal or provide all flags.');
  }

  if (interactive) {
    const routing = loadComponentRouting(config);
    const normalizedInitialId = opts.id ? normalizeComponentId(opts.id) : undefined;
    const defaultReposFromRouting = normalizedInitialId ? routing.routes[normalizedInitialId] ?? [] : [];
    const initialRepos = opts.repos ? splitList(opts.repos) : defaultReposFromRouting;
    // First entry
    const details = await promptComponentDetails(config, {
      initialId: opts.id,
      allowEditId: true,
      initialRepos,
    });
    registerComponent(config, details);
    console.log(c.ok(`Recorded ${c.id(details.id)} in taxonomies/components.yaml`));

    // Offer to add more entries (default: No)
    if (canPrompt()) {
      while (true) {
        const again = await promptConfirm('Add another component?', false);
        if (!again) break;
        const next = await promptComponentDetails(config, {
          allowEditId: true,
        });
        registerComponent(config, next);
        console.log(c.ok(`Recorded ${c.id(next.id)} in taxonomies/components.yaml`));
      }
    }
    return;
  }

  if (!opts.id) {
    throw new Error('Missing required option --id when not running interactively.');
  }

  const componentId = normalizeComponentId(opts.id);
  const repoIds = splitList(opts.repos);
  registerComponent(config, { id: componentId, repos: repoIds });
  console.log(c.ok(`Recorded ${c.id(componentId)} in taxonomies/components.yaml`));
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
