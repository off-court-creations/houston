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
import { formatTable, printOutput, renderBoxTable } from '../lib/printer.js';
import { shortenTicketId } from '../lib/id.js';
import { canPrompt, intro, outro, promptMultiSelect, promptSelect, promptText } from '../lib/interactive.js';
import { c } from '../lib/colors.js';
import { hasFzf, fzfSelect } from '../lib/fzf.js';
import fs from 'node:fs';
import { resolveTicketPaths } from '../services/path-resolver.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';

interface DescribeOptions {
  edit?: boolean;
  file?: 'ticket' | 'description';
}

async function renderTicketPreview(ticketId: string, analytics: WorkspaceAnalytics): Promise<void> {
  const t = analytics.ticketsById.get(ticketId);
  if (!t) {
    console.log(`Not found: ${ticketId}`);
    return;
  }
  const header = `${shortenTicketId(t.id)} — ${t.summary ?? t.title ?? ''}`;
  console.log(c.heading(header));
  const kv: Array<[string, string]> = [];
  kv.push(['Type', t.type]);
  if (t.status) kv.push(['Status', t.status]);
  if (t.assignee) kv.push(['Assignee', t.assignee]);
  if (t.sprintId) kv.push(['Sprint', t.sprintId]);
  if (t.repoIds.length) kv.push(['Repos', t.repoIds.join(', ')]);
  if (t.labels.length) kv.push(['Labels', t.labels.join(', ')]);
  if (t.components.length) kv.push(['Components', t.components.join(', ')]);
  if (kv.length) {
    const lines = renderBoxTable(kv);
    for (const line of lines) console.log(line);
  }
  try {
    const config = loadConfig();
    const paths = resolveTicketPaths(config, t.id);
    const body = fs.readFileSync(paths.descriptionFile, 'utf-8');
    const trimmed = body.trimEnd().split('\n').slice(0, 15);
    if (trimmed.length) {
      console.log(c.subheading('Description:'));
      for (const line of trimmed) console.log(line);
    }
  } catch {}
}

async function runBulkActions(ids: string[], analytics: WorkspaceAnalytics): Promise<void> {
  const choice = await promptSelect(
    `Bulk actions for ${ids.length} ticket(s)`,
    [
      { label: 'Assign to user…', value: 'assign' },
      { label: 'Set status…', value: 'status' },
      { label: 'Add labels…', value: 'labels:add' },
      { label: 'Remove labels…', value: 'labels:remove' },
      { label: 'Cancel', value: 'cancel' },
    ],
    { allowCustom: false, allowNone: false },
  );
  switch (choice) {
    case 'assign':
      await runAssign(ids);
      break;
    case 'status':
      await runStatus(ids);
      break;
    case 'labels:add':
      await runLabelsAdd(ids);
      break;
    case 'labels:remove':
      await runLabelsRemove(ids);
      break;
    default:
      break;
  }
}

async function runAssign(ids: string[]): Promise<void> {
  const { analytics } = loadAnalytics();
  const user = await promptSelect('Assign to user', analytics.users.map((u) => ({ label: u, value: u })), {
    allowCustom: true,
  });
  if (!user) return;
  const config = loadConfig();
  const actor = resolveActor();
  for (const id of ids) {
    const rec = loadTicket(config, id);
    const prev = (rec as any).assignee as string | undefined;
    (rec as any).assignee = user;
    saveTicket(config, rec as any, { actor, history: { op: 'assign', from: prev, to: user } });
  }
}

async function runStatus(ids: string[]): Promise<void> {
  const { analytics } = loadAnalytics();
  const statuses = Object.keys(analytics.summary.ticketStatusCounts);
  const status = await promptSelect('Set status', statuses.map((s) => ({ label: s, value: s })), {
    allowCustom: true,
  });
  if (!status) return;
  const config = loadConfig();
  const actor = resolveActor();
  for (const id of ids) {
    const rec = loadTicket(config, id);
    const prev = (rec as any).status as string | undefined;
    (rec as any).status = status;
    saveTicket(config, rec as any, { actor, history: { op: 'status', from: prev, to: status } });
  }
}

async function runLabelsAdd(ids: string[]): Promise<void> {
  const { analytics } = loadAnalytics();
  const selected = await promptMultiSelect('Add labels (space to toggle)', analytics.labels, {
    required: false,
    allowEmpty: true,
  });
  const extra = await promptText('Additional labels (comma separated, optional)', { defaultValue: '' });
  const adds = dedupe([...selected, ...splitCsv(extra)]);
  if (adds.length === 0) return;
  const config = loadConfig();
  const actor = resolveActor();
  for (const id of ids) {
    const rec = loadTicket(config, id) as any;
    const before = Array.isArray(rec.labels) ? rec.labels.slice() : [];
    const set = new Set<string>(before);
    for (const l of adds) set.add(l);
    rec.labels = Array.from(set.values()).sort();
    saveTicket(config, rec, { actor, history: { op: 'labels:add', labels: adds } as any });
  }
}

async function runLabelsRemove(ids: string[]): Promise<void> {
  const { analytics } = loadAnalytics();
  const selected = await promptMultiSelect('Remove labels (space to toggle)', analytics.labels, {
    required: false,
    allowEmpty: true,
  });
  const extra = await promptText('Additional labels to remove (comma separated, optional)', { defaultValue: '' });
  const removes = dedupe([...selected, ...splitCsv(extra)]);
  if (removes.length === 0) return;
  const config = loadConfig();
  const actor = resolveActor();
  for (const id of ids) {
    const rec = loadTicket(config, id) as any;
    const before = Array.isArray(rec.labels) ? rec.labels.slice() : [];
    const after = before.filter((l: string) => !removes.includes(l));
    rec.labels = after;
    saveTicket(config, rec, { actor, history: { op: 'labels:remove', labels: removes } as any });
  }
}

function splitCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
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
  ticket
    .command('show')
    .description('Show ticket details (optionally open in editor)')
    .argument('[ticketId]')
    .option('--edit', 'open editor for the selected file')
    .option('--file <target>', 'target file to edit (ticket|description)', 'description')
    .action(async (ticketId: string, options: DescribeOptions) => {
      // Interactive mode when no id provided and prompts allowed
      if (!ticketId) {
        const { analytics } = loadAnalytics();
        const selected = await selectTicketInteractive(analytics);
        if (!selected) return;
        await presentTicketDetails(selected, analytics, options);
        return;
      }
      await handleDescribe(ticketId, options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000 --edit\n  $ houston ticket show ST-550e8400-e29b-41d4-a716-446655440000 --edit --file ticket\nNotes:\n  - Run without an id to launch an interactive selector.\n`,
    );

  // Hidden preview command for fzf sidebar rendering
  ticket
    .command('preview')
    .description('Render a concise ticket preview (for interactive fzf)')
    .argument('<ticketId>')
    .action(async (ticketId: string) => {
      const { analytics } = loadAnalytics();
      await renderTicketPreview(ticketId, analytics);
    });

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
      const noFilters =
        options.type === undefined &&
        options.status === undefined &&
        options.assignee === undefined &&
        options.repo === undefined &&
        options.sprint === undefined &&
        options.component === undefined &&
        options.label === undefined &&
        options.limit === undefined &&
        options.json !== true; // when json requested, stay non-interactive

      if (noFilters && canPrompt()) {
        await handleTicketListInteractive(options);
        return;
      }
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

async function handleTicketListInteractive(options: TicketListOptions): Promise<void> {
  const { analytics } = loadAnalytics();
  await intro(c.heading('Ticket Explorer'));

  // Quick filter step: types and statuses
  const typeChoices: TicketType[] = ['epic', 'story', 'subtask', 'bug'];
  const selectedTypes = await promptMultiSelect(
    'Filter by type (Enter to accept, Space to toggle):',
    typeChoices,
    { defaultValue: typeChoices, required: false, allowEmpty: true },
  );

  const statusChoices = Object.keys(analytics.summary.ticketStatusCounts);
  const selectedStatuses = statusChoices.length
    ? await promptMultiSelect('Filter by status (optional):', statusChoices, {
        defaultValue: statusChoices,
        required: false,
        allowEmpty: true,
      })
    : [];

  // Optional query to pre-filter or seed fzf
  const query = await promptText('Search (optional: words across id, summary, labels):', {
    defaultValue: '',
    allowEmpty: true,
  });

  const base = analytics.tickets.slice();
  const filtered = base.filter((t) => {
    if (selectedTypes.length > 0 && !selectedTypes.includes(t.type)) return false;
    if (selectedStatuses.length > 0 && t.status && !selectedStatuses.includes(t.status)) return false;
    if (query && query.trim() !== '') {
      const needle = query.toLowerCase();
      const hay = [
        t.id,
        shortenTicketId(t.id),
        t.type,
        t.status ?? '',
        t.assignee ?? '',
        t.summary ?? t.title ?? '',
        ...t.labels,
        ...t.components,
        ...t.repoIds,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    console.log('No tickets match the current filters.');
    await outro('');
    return;
  }

  const selectedIds = await selectTicketIdsFromList(filtered);
  if (!selectedIds || selectedIds.length === 0) {
    await outro('');
    return;
  }
  if (selectedIds.length === 1) {
    await presentTicketDetails(selectedIds[0], analytics, { edit: false, file: 'description' });
  } else {
    await runBulkActions(selectedIds, analytics);
  }
  await outro('');
}

async function selectTicketInteractive(analytics: WorkspaceAnalytics): Promise<string | undefined> {
  const selected = await selectTicketIdsFromList(analytics.tickets);
  return (selected && selected[0]) ?? undefined;
}

async function selectTicketIdsFromList(tickets: TicketOverview[]): Promise<string[] | undefined> {
  // Prefer fzf when available
  if (hasFzf()) {
    const lines = tickets.map((t) => renderTicketLine(t));
    const picked = fzfSelect(lines, {
      header: 'Tab to multi-select • Enter to accept • ESC to cancel',
      multi: true,
      previewCmd: 'houston ticket preview {1}',
      previewWindow: 'right,60%',
      height: 30,
    });
    if (!picked || picked.length === 0) return undefined;
    const ids = picked.map((line) => line.split(/\s+/)[0]);
    return ids;
  }
  // Fallback: Enquirer autocomplete via promptSelect
  const labels = tickets.map((t) => renderTicketLabel(t));
  const selectedLabels = await promptMultiSelect('Select ticket(s)', labels, {
    required: true,
    allowEmpty: false,
  });
  const byLabel = new Map(labels.map((lbl, idx) => [lbl, tickets[idx].id] as [string, string]));
  return selectedLabels.map((lbl) => byLabel.get(lbl)!).filter(Boolean);
}

function renderTicketLine(t: TicketOverview): string {
  const id = t.id; // keep canonical id visible for unambiguous mapping
  const short = shortenTicketId(t.id);
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const type = pad(t.type.toUpperCase(), 7);
  const status = pad((t.status ?? '-'), 12);
  const assignee = pad((t.assignee ?? '-'), 14);
  const summary = (t.summary ?? t.title ?? '').replace(/\s+/g, ' ');
  const labels = t.labels.length ? ` [${t.labels.join(',')}]` : '';
  return [
    id,
    c.dim(`(${short})`),
    type,
    c.status(t.status ?? '-'),
    assignee,
    summary + labels,
  ].join('  ');
}

function renderTicketLabel(t: TicketOverview): string {
  const short = shortenTicketId(t.id);
  const pieces = [
    `${c.id(short)} ${t.type.toUpperCase()}`,
    t.status ? c.status(t.status) : '-',
    t.assignee ?? '-',
    (t.summary ?? t.title ?? ''),
  ];
  return pieces.join(' — ');
}

async function presentTicketDetails(
  ticketId: string,
  analytics: WorkspaceAnalytics,
  opts: { edit?: boolean; file?: 'ticket' | 'description' } = {},
): Promise<void> {
  const ticket = analytics.ticketsById.get(ticketId);
  if (!ticket) {
    console.log(`Ticket ${ticketId} not found.`);
    return;
  }

  const pairs: Array<[string, string]> = [];
  pairs.push(['ID', ticket.id]);
  pairs.push(['Type', ticket.type]);
  if (ticket.status) pairs.push(['Status', c.status(ticket.status)]);
  if (ticket.assignee) pairs.push(['Assignee', ticket.assignee]);
  if (ticket.sprintId) pairs.push(['Sprint', ticket.sprintId]);
  if (ticket.repoIds.length) pairs.push(['Repos', ticket.repoIds.join(', ')]);
  if (ticket.components.length) pairs.push(['Components', ticket.components.join(', ')]);
  if (ticket.labels.length) pairs.push(['Labels', ticket.labels.join(', ')]);
  if (ticket.updatedAt) pairs.push(['Updated', ticket.updatedAt]);
  if (ticket.createdAt) pairs.push(['Created', ticket.createdAt]);

  console.log(`${c.heading(shortenTicketId(ticket.id))} — ${ticket.summary ?? ticket.title ?? ''}`);
  const tableLines = renderBoxTable(pairs);
  for (const line of tableLines) console.log(line);

  // Description preview
  try {
    const config = loadConfig();
    const paths = resolveTicketPaths(config, ticket.id);
    const body = fs.readFileSync(paths.descriptionFile, 'utf-8');
    const trimmed = body.trimEnd().split('\n').slice(0, 25);
    if (trimmed.length) {
      console.log(c.subheading('Description (preview):'));
      for (const line of trimmed) console.log(line);
      if (body.split('\n').length > trimmed.length) {
        console.log(c.dim('… (truncated)'));
      }
    }
  } catch {
    // ignore missing description
  }

  // Offer quick follow-up action in interactive contexts
  if (canPrompt()) {
    const next = await promptSelect(
      'Action',
      [
        { label: 'Open description in editor', value: 'edit:description' },
        { label: 'Open ticket.yaml in editor', value: 'edit:ticket' },
        { label: 'Assign to user…', value: 'action:assign' },
        { label: 'Set status…', value: 'action:status' },
        { label: 'Add labels…', value: 'action:labels:add' },
        { label: 'Remove labels…', value: 'action:labels:remove' },
        { label: 'Back', value: 'back' },
      ],
      { allowCustom: false, allowNone: false },
    );
    if (next?.startsWith('edit:')) {
      const file = next.endsWith('ticket') ? 'ticket' : 'description';
      await handleDescribe(ticket.id, { edit: true, file: file as 'ticket' | 'description' });
    } else if (next === 'action:assign') {
      await runAssign([ticket.id]);
    } else if (next === 'action:status') {
      await runStatus([ticket.id]);
    } else if (next === 'action:labels:add') {
      await runLabelsAdd([ticket.id]);
    } else if (next === 'action:labels:remove') {
      await runLabelsRemove([ticket.id]);
    }
  }
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
