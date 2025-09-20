import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { buildWorkspaceAnalytics, type WorkspaceAnalytics } from '../services/workspace-analytics.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { printOutput, formatTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repository inspection commands')
    .addHelpText('after', `\nExamples:\n  $ stardate repo list\n  $ stardate repo list --json\n`);

  repo
    .command('list')
    .description('List configured repositories and ticket links')
    .option('-j, --json', 'output as JSON')
    .action(async (options: { json?: boolean }) => {
      await handleRepoList(options);
    })
    .addHelpText('after', `\nExamples:\n  $ stardate repo list\n  $ stardate repo list --json\n`);
}

async function handleRepoList(options: { json?: boolean }): Promise<void> {
  const { analytics } = loadAnalytics();

  const payload = {
    count: analytics.repoUsage.length,
    repos: analytics.repoUsage.map((entry) => ({
      id: entry.config.id,
      provider: entry.config.provider,
      remote: entry.config.remote,
      ticketIds: entry.tickets.map((ticket) => ticket.id),
    })),
    unknownReferences: analytics.unknownRepoTickets.map((ticket) => ticket.id),
  };

  const lines: string[] = [];
  if (analytics.repoUsage.length === 0) {
    lines.push('No repositories configured.');
  } else {
    const rows = analytics.repoUsage.map((entry) => ({
      id: entry.config.id,
      provider: entry.config.provider,
      remote: entry.config.remote,
      tickets: entry.tickets.length ? entry.tickets.map((t) => t.id).join(',') : '-',
    }));
    const table = formatTable(rows, [
      { header: 'ID', value: (row) => row.id },
      { header: 'Provider', value: (row) => row.provider },
      { header: 'Remote', value: (row) => row.remote },
      { header: 'Tickets', value: (row) => row.tickets },
    ]);
    lines.push(...table);
  }

  if (analytics.unknownRepoTickets.length) {
    lines.push('');
    lines.push(c.warn(`Unknown repo references: ${analytics.unknownRepoTickets.map((t) => t.id).join(', ')}`));
  }

  printOutput(payload, lines, options);
}

function loadAnalytics(): { analytics: WorkspaceAnalytics } {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { analytics };
}
