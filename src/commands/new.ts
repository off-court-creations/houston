import { Command } from 'commander';
import path from 'node:path';
import process from 'node:process';
import { loadConfig, type CliConfig } from '../config/config.js';
import { generateTicketId, shortenTicketId } from '../lib/id.js';
import { resolveTicketId } from '../services/ticket-id-resolver.js';
import { promptText, promptMultiSelect, promptSelect, canPrompt } from '../lib/interactive.js';
import { loadBacklog, saveBacklog } from '../services/backlog-store.js';
import { resolveTicketPaths } from '../services/path-resolver.js';
import { collectWorkspaceInventory, type TicketInfo, type TicketType } from '../services/workspace-inventory.js';
import { hasPerson, upsertPerson } from '../services/people-store.js';
import { ensureComponentRegistered, normalizeComponentList } from '../services/component-manager.js';
import { loadComponents } from '../services/component-store.js';
import { createTicket, type TicketRecord } from '../services/ticket-store.js';
import { resolveActor, resolveTimestamp } from '../utils/runtime.js';
import type { HistoryEvent } from '../lib/history.js';
import { c } from '../lib/colors.js';

interface NewOptions {
  interactive?: boolean;
  title?: string;
  summary?: string;
  assignee?: string;
  components?: string;
  labels?: string;
  priority?: string;
  parent?: string;
  dueDate?: string;
  approvers?: string;
  storyPoints?: number;
  status?: string;
}

const TYPE_BRANCH_STRATEGY: Record<'epic' | 'story' | 'subtask' | 'bug', 'per-story' | 'per-subtask' | 'per-bug'> = {
  epic: 'per-story',
  story: 'per-story',
  subtask: 'per-subtask',
  bug: 'per-bug',
};

const DEFAULT_STATUS = 'Backlog';
const PRIORITY_CHOICES = ['P0', 'P1', 'P2', 'P3'];

export function registerNewCommand(program: Command): void {
  program
    .command('new')
    .description('Create a new ticket')
    .argument('<type>', 'ticket type (epic|story|subtask|bug)')
    .option('--title <title>', 'ticket title')
    .option('--summary <summary>', 'short summary override')
    .option('--assignee <user:id>', 'assignee identifier (e.g. user:alice)')
    .option('--components <list>', 'comma separated component list')
    .option('--labels <list>', 'comma separated labels')
    .option('--priority <value>', 'priority P0..P3 (not allowed for epics)')
    .option('--parent <ticketId>', 'parent epic or story id (required for subtask)')
    .option('--due-date <date>', 'ISO due date')
    .option('--approvers <list>', 'comma separated approver ids')
    .option('--story-points <points>', 'story points for subtask/bug', parsePositiveInteger)
    .option('--status <status>', 'initial status', DEFAULT_STATUS)
    .option('-i, --interactive', 'prompt for required fields')
    .action(async (type: string, opts: NewOptions) => {
      await handleNewCommand(type as TicketRecord['type'], opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket new story --title "Checkout v2" --assignee user:alice --components web\n  $ houston ticket new subtask --title "Add unit tests" --assignee user:bob --components web --parent ST-550e8400-e29b-41d4-a716-446655440000 --story-points 3\n  $ houston ticket new bug --title "Crash on submit" --assignee user:alice --components api --labels triage --story-points 2\n  $ houston ticket new story --interactive\n\nNotes:\n  - Required fields can be provided via flags or interactively with --interactive.\n  - New assignees/components are added to workspace taxonomies as needed.\n`,
    );
}

async function handleNewCommand(type: TicketRecord['type'], opts: NewOptions): Promise<void> {
  if (!['epic', 'story', 'subtask', 'bug'].includes(type)) {
    throw new Error(`Unsupported ticket type: ${type}`);
  }

  const config = loadConfig();
  let resolvedOpts: NewOptions = { ...opts };
  let inventory = collectWorkspaceInventory(config);
  ensureEpicPrerequisite(type, inventory);
  let missing = collectMissingFields(type, resolvedOpts);
  let interactiveSession = Boolean(resolvedOpts.interactive);

  if (resolvedOpts.interactive || missing.length > 0) {
    const ok = canPrompt();
    if (!ok) {
      throw new Error(
        `Missing required options: ${missing.join(', ')}. Re-run with --interactive in a terminal or provide all flags.`,
      );
    }
    interactiveSession = true;
    resolvedOpts = await runInteractiveNewTicket(type, resolvedOpts, config, inventory);
  }

  inventory = collectWorkspaceInventory(config);
  ensureEpicPrerequisite(type, inventory);
  if (resolvedOpts.parent) {
    const { id: canonicalParent } = resolveTicketId(config, resolvedOpts.parent, {
      inventory,
    });
    resolvedOpts.parent = canonicalParent;
  }
  await finalizeTicketCreation(type, resolvedOpts, config, interactiveSession, inventory);
}

function collectMissingFields(type: TicketRecord['type'], opts: NewOptions): string[] {
  const missing: string[] = [];
  if (!opts.title) {
    missing.push('--title');
  }
  if (!opts.assignee) {
    missing.push('--assignee');
  }
  if (!opts.components) {
    missing.push('--components');
  }
  if (type === 'subtask' && !opts.parent) {
    missing.push('--parent');
  }
  if ((type === 'subtask' || type === 'bug') && (opts.storyPoints === undefined || Number.isNaN(opts.storyPoints))) {
    missing.push('--story-points');
  }
  return missing;
}

function ensureEpicPrerequisite(
  type: TicketRecord['type'],
  inventory: ReturnType<typeof collectWorkspaceInventory>,
): void {
  if (type !== 'story' && type !== 'subtask') {
    return;
  }
  const hasEpic = inventory.tickets.some((ticket) => ticket.type === 'epic');
  if (hasEpic) {
    return;
  }
  const noun = type === 'story' ? 'story' : 'subtask';
  throw new Error(`Cannot create a ${noun} because no epics exist yet. Create an epic first.`);
}

async function runInteractiveNewTicket(
  type: TicketType,
  opts: NewOptions,
  config: CliConfig,
  inventory: ReturnType<typeof collectWorkspaceInventory>,
): Promise<NewOptions> {
  const next: NewOptions = { ...opts };

  const title = await promptText('Title', {
    defaultValue: opts.title,
    required: true,
  });
  next.title = title;

  const summary = await promptText('Summary (optional)', {
    defaultValue: opts.summary ?? title,
    allowEmpty: true,
  });
  next.summary = summary.trim() === '' ? undefined : summary.trim();

  next.assignee = await promptForAssignee(inventory.users, opts.assignee);

  const componentChoices = inventory.components;
  const selectedComponents =
    componentChoices.length > 0
      ? await promptMultiSelect('Components', componentChoices, {
          defaultValue: splitList(opts.components),
          required: true,
        })
      : await promptForCustomList('Components (comma separated)', splitList(opts.components), true);
  const normalizedComponents = normalizeComponentList(selectedComponents);
  if (normalizedComponents.length === 0) {
    throw new Error('At least one component required.');
  }
  next.components = normalizedComponents.join(', ');

  const labels =
    inventory.labels.length > 0
      ? await promptMultiSelect('Labels (optional)', inventory.labels, {
          defaultValue: splitList(opts.labels),
          required: false,
          allowEmpty: true,
        })
      : await promptForCustomList('Labels (comma separated, optional)', splitList(opts.labels), false);
  next.labels = labels.length > 0 ? labels.join(', ') : undefined;

  const dueDateInput = await promptText('Due date (YYYY-MM-DD, optional)', {
    defaultValue: opts.dueDate,
    allowEmpty: true,
    validate: (value) => {
      const trimmed = value.trim();
      if (trimmed === '') {
        return null;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return 'Use YYYY-MM-DD format.';
      }
      return null;
    },
  });
  next.dueDate = dueDateInput.trim() === '' ? undefined : dueDateInput.trim();

  const approvers = await promptMultiSelect('Approvers (optional)', inventory.users, {
    defaultValue: splitList(opts.approvers),
    required: false,
    allowEmpty: true,
  });
  next.approvers = approvers.length > 0 ? approvers.join(', ') : undefined;

  if (type !== 'epic') {
    const priority = await promptSelect('Priority (optional)', PRIORITY_CHOICES.map((value) => ({ label: value, value })), {
      defaultValue: opts.priority ?? 'P2',
      allowCustom: false,
      allowNone: true,
    });
    next.priority = priority ?? undefined;
  }

  if (type === 'story') {
    next.parent = await promptForParent('Select parent epic (Enter for none)', filterTickets(inventory.tickets, 'epic'), {
      defaultValue: opts.parent,
      optional: true,
    });
  }

  if (type === 'subtask') {
    next.parent = await promptForParent('Select parent story', filterTickets(inventory.tickets, 'story'), {
      defaultValue: opts.parent,
      optional: false,
    });
    next.storyPoints = await promptForStoryPoints(opts.storyPoints);
  }

  if (type === 'bug') {
    next.storyPoints = await promptForStoryPoints(opts.storyPoints);
    next.parent = await promptForParent('Link to story (optional)', filterTickets(inventory.tickets, 'story'), {
      defaultValue: opts.parent,
      optional: true,
    });
  }

  next.status = opts.status ?? DEFAULT_STATUS;

  return next;
}

async function promptForAssignee(users: string[], current?: string): Promise<string> {
  if (users.length === 0) {
    const value = await promptText('Assignee (user:id)', {
      defaultValue: current,
      required: true,
    });
    return value.trim();
  }
  const choices = users.map((user) => ({ label: user, value: user }));
  const selection = await promptSelect('Assignee (choose and press Enter, or type a new user:id)', choices, {
    defaultValue: current ?? users[0],
    allowCustom: true,
  });
  return (selection ?? users[0])!.trim();
}

async function ensureAssigneeTracked(
  config: CliConfig,
  userId: string,
  opts: NewOptions,
  inventory: ReturnType<typeof collectWorkspaceInventory>,
  interactiveFlag: boolean,
): Promise<void> {
  if (hasPerson(config, userId)) {
    return;
  }

  const shouldPrompt = interactiveFlag && canPrompt();

  let name: string | undefined;
  let email: string | undefined;
  if (shouldPrompt) {
    name = await promptText('Assignee display name (for people/users.yaml)', {
      defaultValue: deriveDisplayName(userId),
      required: true,
      validate: (value) => (value.trim() === '' ? 'Name is required.' : null),
    });
    email = await promptText('Assignee email (optional)', {
      defaultValue: '',
      allowEmpty: true,
    });
    email = email.trim() === '' ? undefined : email.trim();
  } else {
    name = deriveDisplayName(userId);
  }

  upsertPerson(config, {
    id: userId,
    name,
    email,
  });

  // Update inventory cache so subsequent prompts (e.g. approvers) include the new user.
  inventory.users = Array.from(new Set([...inventory.users, userId])).sort();
}

async function ensureComponentsTracked(
  config: CliConfig,
  components: string[],
  inventory: ReturnType<typeof collectWorkspaceInventory>,
  interactiveFlag: boolean,
): Promise<void> {
  for (const componentId of components) {
    await ensureComponentRegistered(config, componentId, interactiveFlag);
  }
  inventory.components = loadComponents(config);
}

async function promptForParent(
  question: string,
  tickets: TicketInfo[],
  options: { defaultValue?: string; optional: boolean },
): Promise<string | undefined> {
  const choices = tickets.map((ticket) => ({ label: formatTicketChoice(ticket), value: ticket.id }));
  const selection = await promptSelect(question, choices, {
    defaultValue: options.defaultValue,
    allowCustom: true,
    allowNone: options.optional,
  });
  if (!selection && !options.optional) {
    throw new Error('A parent selection is required.');
  }
  return selection;
}

async function promptForStoryPoints(existing?: number): Promise<number> {
  while (true) {
    const value = await promptText('Story points', {
      defaultValue: existing !== undefined ? String(existing) : undefined,
      required: true,
      validate: (input) => {
        const parsed = Number.parseInt(input, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return 'Please enter a positive integer value.';
        }
        return null;
      },
    });
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
}

function filterTickets(tickets: TicketInfo[], type: TicketType): TicketInfo[] {
  return tickets.filter((ticket) => ticket.type === type).sort((a, b) => a.id.localeCompare(b.id));
}

function formatTicketChoice(ticket: TicketInfo): string {
  const title = getString(ticket.data, 'title') ?? getString(ticket.data, 'summary') ?? '';
  const status = getString(ticket.data, 'status');
  const shortId = shortenTicketId(ticket.id);
  return status ? `${shortId} — ${title} [${status}]` : `${shortId} — ${title}`;
}

async function promptForCustomList(question: string, defaults: string[] = [], required: boolean): Promise<string[]> {
  while (true) {
    const answer = await promptText(question, {
      defaultValue: defaults.join(', '),
      required,
      allowEmpty: !required,
    });
    const values = splitList(answer);
    if (values.length === 0 && required) {
      console.log('Please provide at least one value.');
      continue;
    }
    return values;
  }
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function pruneUndefined(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Story points must be a positive integer.');
  }
  return parsed;
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function deriveDisplayName(userId: string): string {
  const parts = userId.includes(':') ? userId.split(':', 2)[1] ?? userId : userId;
  const normalized = parts.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return userId;
  }
  return normalized
    .split(' ')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

async function finalizeTicketCreation(
  type: TicketRecord['type'],
  opts: NewOptions,
  config: CliConfig,
  interactiveSession: boolean,
  inventory: ReturnType<typeof collectWorkspaceInventory>,
): Promise<void> {
  const remainingMissing = collectMissingFields(type, opts);
  if (remainingMissing.length > 0) {
    throw new Error(`Missing required options: ${remainingMissing.join(', ')}`);
  }

  if (type === 'epic' && opts.priority) {
    throw new Error('Epics cannot have a priority');
  }

  const actor = resolveActor();
  const now = resolveTimestamp();

  const id = generateTicketId(type);
  const components = normalizeComponentList(splitList(opts.components));
  if (components.length === 0) {
    throw new Error('At least one component required');
  }
  const labels = splitList(opts.labels);
  const approvers = splitList(opts.approvers);

  const descriptionPath = './description.md';
  const status = opts.status ?? DEFAULT_STATUS;

  await ensureAssigneeTracked(config, opts.assignee!, opts, inventory, interactiveSession);
  await ensureComponentsTracked(config, components, inventory, interactiveSession);

  const ticket: TicketRecord = {
    id,
    type,
    summary: opts.summary ?? opts.title!,
    title: opts.title!,
    assignee: opts.assignee!,
    description: descriptionPath,
    components,
    labels,
    approvers,
    status,
    parent_id: opts.parent ?? null,
    sprint_id: null,
    created_at: now,
    updated_at: now,
    version: 1,
    code: {
      branch_strategy: TYPE_BRANCH_STRATEGY[type],
      auto_create_branch: type !== 'epic',
      auto_open_pr: type !== 'epic',
      repos: [],
    },
  } as TicketRecord;

  if (opts.dueDate) {
    (ticket as Record<string, unknown>).due_date = opts.dueDate;
  }
  if (opts.priority && type !== 'epic') {
    (ticket as Record<string, unknown>).priority = opts.priority;
  }
  if (labels.length === 0) {
    delete (ticket as Record<string, unknown>).labels;
  }
  if (approvers.length === 0) {
    delete (ticket as Record<string, unknown>).approvers;
  }

  if (type === 'subtask' || type === 'bug') {
    (ticket as Record<string, unknown>).story_points = opts.storyPoints;
  }
  if (type === 'bug') {
    (ticket as Record<string, unknown>).time_tracking = [];
  }

  pruneUndefined(ticket as Record<string, unknown>);

  const history: HistoryEvent = {
    actor,
    op: 'create',
    to: { status },
  };

  createTicket(config, ticket, [history]);

  if (type === 'epic' || type === 'story' || type === 'bug' || type === 'subtask') {
    const backlog = loadBacklog(config);
    const ordered = new Set(backlog.ordered ?? []);
    ordered.add(id);
    backlog.ordered = Array.from(ordered);
    backlog.notes = backlog.notes ?? '';
    backlog.generated_by = config.metadata.generator;
    saveBacklog(config, backlog);
  }

  console.log(
    c.ok(
      `Created ${c.id(shortenTicketId(id))} at ${path.relative(process.cwd(), resolveTicketPaths(config, id).ticketFile)}`,
    ),
  );
}
