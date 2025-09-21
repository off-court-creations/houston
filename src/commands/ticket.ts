import { Command } from 'commander';
import { registerNewCommand } from './new.js';
import { registerAssignCommand } from './assign.js';
import { registerStatusCommand } from './status.js';
import { registerLabelCommand } from './label.js';
import { registerLinkCommand } from './link.js';
import { registerCodeCommand } from './code.js';
import { handleDescribe } from './describe.js';
import { handleLogTime } from './bug.js';
import { loadConfig } from '../config/config.js';
import {
  buildWorkspaceAnalytics,
  compareTicketRecency,
  type TicketOverview,
  type WorkspaceAnalytics,
} from '../services/workspace-analytics.js';
import { collectWorkspaceInventory, type TicketType } from '../services/workspace-inventory.js';
import { formatTable, printOutput } from '../lib/printer.js';
import { shortenTicketId } from '../lib/id.js';

interface DescribeOptions {
  edit?: boolean;
  file?: 'ticket' | 'description';
}

interface TicketListOptions {
  json?: boolean;
  type?: TicketType[];
  status?: string[];
  assignee?: string[];
  repo?: string[];
  sprint?: string[];
  component?: string[];
  label?: string[];
  limit?: number;
  sort?: 'id' | 'status' | 'assignee' | 'updated';
}

export function registerTicketCommand(program: Command): void {
  const ticket = program
    .command('ticket')
    .description('Ticket operations')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket new story --title "Checkout v2" --assignee user:alice --components web\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000\n  $ houston ticket assign ST-550e8400-e29b-41d4-a716-446655440000 user:bob\n  $ houston ticket label ST-550e8400-e29b-41d4-a716-446655440000 +frontend -needs-spec\n  $ houston ticket link --child ST-550e8400-e29b-41d4-a716-446655440000 --parent EPIC-11111111-1111-1111-1111-111111111111\n  $ houston ticket time log BG-44444444-4444-4444-4444-444444444444 30 "triage and repro"\n  $ houston ticket code start ST-550e8400-e29b-41d4-a716-446655440000 --repo repo.web\n  $ houston ticket list --type story --label frontend --json\n`,
    );

  // Ticket creation
  registerNewCommand(ticket);

  // Ticket mutations
  registerAssignCommand(ticket);
  registerStatusCommand(ticket);
  registerLabelCommand(ticket);
  registerLinkCommand(ticket);

  // Ticket details
  const show = ticket
    .command('show')
    .description('Show ticket details (optionally open in editor)')
    .argument('<ticketId>')
    .option('--edit', 'open editor for the selected file')
    .option('--file <target>', 'target file to edit (ticket|description)', 'description')
    .action(async (ticketId: string, options: DescribeOptions) => {
      await handleDescribe(ticketId, options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000 --edit\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000 --edit --file ticket\n`,
    );

  // Time tracking (formerly bug log-time)
  const time = ticket
    .command('time')
    .description('Time tracking commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket time log BUG-77 45 "investigation"\n`,
    );
  time
    .command('log')
    .description('Append a time tracking entry to a bug ticket')
    .argument('<ticketId>')
    .argument('<minutes>')
    .argument('[note...]')
    .action(async (ticketId: string, minutes: string, noteParts: string[]) => {
      await handleLogTime(ticketId, Number.parseInt(minutes, 10), noteParts.join(' '));
    });

  // Code integration helpers (moved under ticket)
  registerCodeCommand(ticket);

  // Ticket listing
  ticket
    .command('list')
    .description('List tickets in the current workspace')
    .option('-j, --json', 'output as JSON')
    .option('-t, --type <type...>', 'filter by ticket type (epic|story|subtask|bug)')
    .option('-s, --status <status...>', 'filter by ticket status')
    .option('-a, --assignee <assignee...>', 'filter by assignee id')
    .option('-r, --repo <repo...>', 'filter by repository id referenced by tickets')
    .option('--sprint <sprint...>', 'filter by sprint id')
    .option('-c, --component <component...>', 'filter by component name')
    .option('-l, --label <label...>', 'filter by label')
    .option('--sort <field>', 'sort field (id|status|assignee|updated)', 'updated')
    .option('--limit <count>', 'limit number of tickets returned', parsePositiveInt)
    .action(async (options: TicketListOptions) => {
      await handleTicketList(options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket list\n  $ houston ticket list --type story --label frontend --sort updated\n  $ houston ticket list --assignee user:alice --limit 10 --json\nFilters:\n  --type <type...>         epic|story|subtask|bug\n  --status <status...>     workflow status values\n  --assignee <user...>     user ids e.g. user:alice\n  --repo <repo...>         repository ids\n  --sprint <sprint...>     sprint ids\n  --component <name...>    component names\n  --label <label...>       label values\n`,
    );
}

async function handleTicketList(options: TicketListOptions): Promise<void> {
  const { analytics } = loadAnalytics();
  const filters = normalizeTicketFilters(options, analytics);
  let tickets = analytics.tickets.slice();
  tickets = applyTicketFilters(tickets, filters);
  tickets = sortTickets(tickets, filters.sort);
  if (filters.limit !== undefined) {
    tickets = tickets.slice(0, filters.limit);
  }

  const payload = {
    count: tickets.length,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      shortId: shortenTicketId(ticket.id),
      type: ticket.type,
      status: ticket.status,
      assignee: ticket.assignee,
      components: ticket.components,
      labels: ticket.labels,
      sprintId: ticket.sprintId,
      repoIds: ticket.repoIds,
      summary: ticket.summary ?? ticket.title ?? '',
      path: ticket.path,
    })),
  };

  const lines: string[] = [];
  if (tickets.length === 0) {
    lines.push('No tickets matched the provided filters.');
  } else {
    const table = formatTable(tickets, [
      { header: 'ID', value: (row) => shortenTicketId(row.id) },
      { header: 'Type', value: (row) => row.type },
      { header: 'Status', value: (row) => row.status ?? '-' },
      { header: 'Assignee', value: (row) => row.assignee ?? '-' },
      { header: 'Sprint', value: (row) => row.sprintId ?? '-' },
      { header: 'Repos', value: (row) => (row.repoIds.length ? row.repoIds.join(',') : '-') },
      { header: 'Summary', value: (row) => truncate(row.summary ?? row.title ?? '', 40) },
    ]);
    lines.push(...table);
  }

  printOutput(payload, lines, options);
}

function loadAnalytics(): {
  analytics: WorkspaceAnalytics;
} {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { analytics };
}

interface TicketFilters {
  types?: TicketType[];
  statuses?: string[];
  assignees?: string[];
  repos?: string[];
  sprints?: string[];
  components?: string[];
  labels?: string[];
  limit?: number;
  sort: 'id' | 'status' | 'assignee' | 'updated';
}

function normalizeTicketFilters(options: TicketListOptions, analytics: WorkspaceAnalytics): TicketFilters {
  const filters: TicketFilters = {
    sort: normalizeSort(options.sort),
  };
  if (options.limit !== undefined) {
    filters.limit = options.limit;
  }
  if (options.type) {
    const normalized = options.type.map((value) => value.toLowerCase()) as TicketType[];
    const invalid = normalized.filter((value) => !['epic', 'story', 'subtask', 'bug'].includes(value));
    if (invalid.length) {
      throw new Error(`Unknown ticket type(s): ${invalid.join(', ')}`);
    }
    filters.types = normalized;
  }
  if (options.status) {
    filters.statuses = options.status;
  }
  if (options.assignee) {
    filters.assignees = options.assignee;
  }
  if (options.repo) {
    filters.repos = options.repo;
  }
  if (options.sprint) {
    filters.sprints = options.sprint;
  }
  if (options.component) {
    filters.components = options.component;
  }
  if (options.label) {
    filters.labels = options.label;
  }

  // Validate repo filters against list of known repos if available
  if (filters.repos) {
    const configuredRepoIds = new Set(analytics.repoUsage.map((entry) => entry.config.id));
    const referencedRepoIds = new Set<string>();
    for (const ticket of analytics.tickets) {
      for (const repoId of ticket.repoIds) {
        referencedRepoIds.add(repoId);
      }
    }
    const unknown = filters.repos.filter(
      (repoId) => !configuredRepoIds.has(repoId) && !referencedRepoIds.has(repoId),
    );
    if (unknown.length) {
      throw new Error(`Unknown repo id(s): ${unknown.join(', ')}`);
    }
  }

  return filters;
}

function applyTicketFilters(tickets: TicketOverview[], filters: TicketFilters): TicketOverview[] {
  return tickets.filter((ticket) => {
    if (filters.types && !filters.types.includes(ticket.type)) {
      return false;
    }
    if (filters.statuses && (!ticket.status || !filters.statuses.includes(ticket.status))) {
      return false;
    }
    if (filters.assignees && (!ticket.assignee || !filters.assignees.includes(ticket.assignee))) {
      return false;
    }
    if (filters.repos && !filters.repos.some((repo) => ticket.repoIds.includes(repo))) {
      return false;
    }
    if (filters.sprints && (!ticket.sprintId || !filters.sprints.includes(ticket.sprintId))) {
      return false;
    }
    if (filters.components && !filters.components.some((component) => ticket.components.includes(component))) {
      return false;
    }
    if (filters.labels && !filters.labels.some((label) => ticket.labels.includes(label))) {
      return false;
    }
    return true;
  });
}

function sortTickets(tickets: TicketOverview[], sort: TicketFilters['sort']): TicketOverview[] {
  const sorted = tickets.slice();
  switch (sort) {
    case 'status':
      sorted.sort((a, b) => (a.status ?? '').localeCompare(b.status ?? '') || a.id.localeCompare(b.id));
      break;
    case 'assignee':
      sorted.sort((a, b) => (a.assignee ?? '').localeCompare(b.assignee ?? '') || a.id.localeCompare(b.id));
      break;
    case 'updated':
      sorted.sort(compareTicketRecency);
      break;
    case 'id':
    default:
      sorted.sort((a, b) => a.id.localeCompare(b.id));
      break;
  }
  return sorted;
}

function normalizeSort(sortValue: TicketListOptions['sort']): TicketFilters['sort'] {
  if (!sortValue) {
    return 'updated';
  }
  if (['id', 'status', 'assignee', 'updated'].includes(sortValue)) {
    return sortValue as TicketFilters['sort'];
  }
  throw new Error(`Unknown sort field: ${sortValue}`);
}


function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Count must be a positive integer');
  }
  return parsed;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
