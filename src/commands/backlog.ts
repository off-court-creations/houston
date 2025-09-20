import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadBacklog, saveBacklog } from '../services/backlog-store.js';
import { loadTicket } from '../services/ticket-store.js';
import { loadConfig as loadCliConfig } from '../config/config.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { buildWorkspaceAnalytics, type WorkspaceAnalytics } from '../services/workspace-analytics.js';
import { printOutput } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import { emptyScope, loadSprint, saveSprintScope, ensureSprintStructure } from '../services/sprint-store.js';

interface PlanOptions {
  sprint: string;
  take?: number;
}

export function registerBacklogCommand(program: Command): void {
  const backlog = program
    .command('backlog')
    .description('Backlog management commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate backlog add ST-123 ST-124\n  $ stardate backlog plan --sprint S-2025-10-01_2025-10-14 --take 5\n  $ stardate backlog show\n`,
    );

  backlog
    .command('add')
    .description('Append tickets to backlog in order')
    .argument('<ticketIds...>')
    .action(async (ticketIds: string[]) => {
      await handleBacklogAdd(ticketIds);
    })
    .addHelpText('after', `\nExamples:\n  $ stardate backlog add ST-123 ST-124\n`);

  backlog
    .command('plan')
    .description('Move top backlog items into a sprint scope')
    .requiredOption('--sprint <id>', 'sprint identifier')
    .option('--take <count>', 'number of tickets to plan', (value) => Number.parseInt(value, 10))
    .action(async (options: PlanOptions) => {
      await handleBacklogPlan(options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate backlog plan --sprint S-2025-10-01_2025-10-14\n  $ stardate backlog plan --sprint S-2025-10-01_2025-10-14 --take 10\n`,
    );

  backlog
    .command('show')
    .description('Show backlog and next sprint candidates')
    .option('-j, --json', 'output as JSON')
    .option('--include-missing', 'include missing ticket references')
    .action(async (options: { json?: boolean; includeMissing?: boolean }) => {
      await handleBacklogShow(options);
    })
    .addHelpText('after', `\nExamples:\n  $ stardate backlog show\n  $ stardate backlog show --json\n`);
}

async function handleBacklogAdd(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) {
    console.log('No tickets provided.');
    return;
  }
  const config = loadConfig();
  const backlog = loadBacklog(config);
  const ordered = backlog.ordered ?? [];
  for (const id of ticketIds) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  backlog.ordered = ordered;
  backlog.generated_by = config.metadata.generator;
  saveBacklog(config, backlog);
  console.log(c.ok(`Added ${ticketIds.length} ticket(s) to backlog`));
}

async function handleBacklogPlan(options: PlanOptions): Promise<void> {
  const config = loadConfig();
  const take = options.take && options.take > 0 ? options.take : 10;
  const backlog = loadBacklog(config);
  const ordered = [...(backlog.ordered ?? [])];
  if (ordered.length === 0) {
    console.log('Backlog is empty.');
    return;
  }
  const selection = ordered.splice(0, take);
  backlog.ordered = ordered;
  saveBacklog(config, backlog);

  ensureSprintStructure(config, options.sprint);
  const sprint = loadSprint(config, options.sprint);
  const scope = sprint?.scope ?? emptyScope(config.metadata.generator);

  for (const ticketId of selection) {
    try {
      const ticket = loadTicket(config, ticketId);
      switch (ticket.type) {
        case 'epic':
          scope.epics = uniquePush(scope.epics, ticketId);
          break;
        case 'story':
          scope.stories = uniquePush(scope.stories, ticketId);
          break;
        case 'subtask':
          scope.subtasks = uniquePush(scope.subtasks, ticketId);
          break;
        case 'bug':
          scope.bugs = uniquePush(scope.bugs, ticketId);
          break;
      }
    } catch (error) {
      console.warn(`Skipping ${ticketId}: ${(error as Error).message}`);
    }
  }

  saveSprintScope(config, options.sprint, scope);
  console.log(c.ok(`Planned ${selection.length} ticket(s) into ${c.id(options.sprint)}`));
}

function uniquePush(list: string[] | undefined, id: string): string[] {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(id)) {
    next.push(id);
  }
  return next;
}

async function handleBacklogShow(options: { json?: boolean; includeMissing?: boolean }): Promise<void> {
  const { analytics } = loadAnalytics();

  const payload = {
    backlog: {
      path: analytics.backlog.path,
      ticketIds: analytics.backlog.tickets.map((ticket) => ticket.id),
      missing: analytics.backlog.missing,
    },
    nextSprint: {
      path: analytics.nextSprint.path,
      ticketIds: analytics.nextSprint.tickets.map((ticket) => ticket.id),
      missing: analytics.nextSprint.missing,
    },
  };

  const lines: string[] = [];
  lines.push(c.heading(`Backlog (${analytics.backlog.path})`));
  if (analytics.backlog.tickets.length === 0) {
    lines.push(indentLine('No backlog items.'));
  } else {
    analytics.backlog.tickets.forEach((ticket, index) => {
      lines.push(indentLine(`${index + 1}. ${renderTicketLine(ticket)}`));
    });
  }
  if (options.includeMissing && analytics.backlog.missing.length) {
    lines.push(indentLine(`Missing: ${analytics.backlog.missing.join(', ')}`));
  }
  lines.push('');
  lines.push(c.heading(`Next Sprint Candidates (${analytics.nextSprint.path})`));
  if (analytics.nextSprint.tickets.length === 0) {
    lines.push(indentLine('No next sprint candidates.'));
  } else {
    analytics.nextSprint.tickets.forEach((ticket, index) => {
      lines.push(indentLine(`${index + 1}. ${renderTicketLine(ticket)}`));
    });
  }
  if (options.includeMissing && analytics.nextSprint.missing.length) {
    lines.push(indentLine(`Missing: ${analytics.nextSprint.missing.join(', ')}`));
  }

  printOutput(payload, lines, options);
}

function loadAnalytics(): { analytics: WorkspaceAnalytics } {
  const config = loadCliConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { analytics };
}

function indentLine(text: string): string {
  return `  ${text}`;
}

function renderTicketLine(ticket: { id: string; status?: string; assignee?: string; title?: string; summary?: string }): string {
  const status = ticket.status ? `[${ticket.status}]` : '';
  const assignee = ticket.assignee ? `@${ticket.assignee}` : '';
  const summary = ticket.summary ?? ticket.title ?? '';
  return `${ticket.id} ${status} ${assignee} ${summary}`.replace(/\s+/g, ' ').trim();
}
