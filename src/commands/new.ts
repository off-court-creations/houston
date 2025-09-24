import { Command } from 'commander';
import path from 'node:path';
import process from 'node:process';
import { loadConfig, type CliConfig } from '../config/config.js';
import { generateTicketId, shortenTicketId } from '../lib/id.js';
import { resolveTicketId } from '../services/ticket-id-resolver.js';
import { promptText, promptMultiSelect, promptSelect, canPrompt, promptConfirm } from '../lib/interactive.js';
import { loadBacklog, saveBacklog } from '../services/backlog-store.js';
import { resolveTicketPaths } from '../services/path-resolver.js';
import { collectWorkspaceInventory, type TicketInfo, type TicketType } from '../services/workspace-inventory.js';
import { hasPerson, upsertPerson } from '../services/people-store.js';
import { ensureComponentRegistered, normalizeComponentList } from '../services/component-manager.js';
import { loadComponents } from '../services/component-store.js';
import { createTicket, type TicketRecord, type HistoryEventInput, loadTicket } from '../services/ticket-store.js';
import { normalizeUserId } from '../utils/user-id.js';
import { resolveActor, resolveTimestamp } from '../utils/runtime.js';
import type { HistoryEvent } from '../lib/history.js';
import { c } from '../lib/colors.js';
import { listRepos, getRepo } from '../services/repo-registry.js';
import { loadComponentRouting } from '../services/component-routing-store.js';
import { createProvider } from '../providers/index.js';

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
  // Code integration (interactive and non-interactive)
  repo?: string[]; // --repo
  branch?: string[]; // --branch (supports repo:branch)
  base?: string[]; // --base (supports repo:base)
  path?: string[]; // --path (supports repo:path)
  createBranch?: boolean; // --create-branch
  provider?: boolean; // --no-provider toggles to false
  verifyExisting?: boolean; // --no-verify-existing toggles to false
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
    // Code integration flags
    .option('--repo <repoId>', 'link repository id (repeatable)', collectValues, [])
    .option(
      '--branch <value>',
      'branch to link or create; for multiple repos use repo:branch (repeatable)',
      collectValues,
      [],
    )
    .option(
      '--base <value>',
      'base branch override for creation; for multiple repos use repo:base (repeatable)',
      collectValues,
      [],
    )
    .option(
      '--path <value>',
      'subdirectory path in the repo; for multiple repos use repo:path (repeatable)',
      collectValues,
      [],
    )
    .option('--create-branch', 'create a new branch for linked repos')
    .option('--no-verify-existing', 'skip verifying existing branch presence on remote')
    .option('--no-provider', 'skip remote provider integration')
    .option('-i, --interactive', 'prompt for required fields')
    .action(async (type: string, opts: NewOptions) => {
      await handleNewCommand(type as TicketRecord['type'], opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket new story --title "Checkout v2" --assignee user:alice --components web\n  $ houston ticket new subtask --title "Add unit tests" --assignee user:bob --components web --parent ST-550e8400-e29b-41d4-a716-446655440000 --story-points 3\n  $ houston ticket new bug --title "Crash on submit" --assignee user:alice --components api --labels triage --story-points 2\n  $ houston ticket new story --interactive\n  $ houston ticket new story --title "Payments polish" --assignee user:alice --components payments \\\n      --repo repo.web --create-branch --path repo.web:apps/web\n  $ houston ticket new subtask --title "Add unit tests" --assignee user:bob --components checkout \\\n      --parent ST-... --story-points 3 --repo repo.checkout --branch repo.checkout:feat/ST-...--tests\n\nNotes:\n  - Required fields can be provided via flags or interactively with --interactive.\n  - New assignees/components are added to workspace taxonomies as needed.\n  - Use --repo/--create-branch/--branch/--base/--path to link code on creation.\n`,
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
  // due_date is required by schema; if not provided, we'll auto-default later in finalize
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
  const approvers = splitList(opts.approvers).map((id) => normalizeUserId(id));

  const descriptionPath = './description.md';
  const status = opts.status ?? DEFAULT_STATUS;

  // Normalize assignee id
  opts.assignee = normalizeUserId(opts.assignee!);
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

  // Always set due_date (schema-required); default to +14 days if not provided
  (ticket as Record<string, unknown>).due_date = opts.dueDate ?? defaultDueDate();
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

  // Code integration: link repos and optionally create/link branches
  const codeHistory: HistoryEventInput[] = [];
  await enrichTicketWithCodeLinks({
    config,
    ticket,
    actor,
    now,
    type,
    parentId: (ticket as Record<string, unknown>).parent_id as string | null,
    opts,
    interactive: interactiveSession,
  }, codeHistory);

  const creationEvent: HistoryEvent = {
    actor,
    op: 'create',
    to: { status },
  };

  // Persist with combined history (createTicket requires actor on each event)
  const codeHistoryWithActor = codeHistory.map((e) => ({ actor, ...e }));
  createTicket(config, ticket, [creationEvent, ...codeHistoryWithActor]);

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

function defaultDueDate(): string {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const due = new Date(now.getTime() + 14 * msPerDay);
  const y = due.getUTCFullYear();
  const m = String(due.getUTCMonth() + 1).padStart(2, '0');
  const d = String(due.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Helpers

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface CodeEnrichmentContext {
  config: CliConfig;
  ticket: TicketRecord;
  actor: string;
  now: string;
  type: TicketRecord['type'];
  parentId: string | null;
  opts: NewOptions;
  interactive: boolean;
}

async function enrichTicketWithCodeLinks(
  ctx: CodeEnrichmentContext,
  historyOut: HistoryEventInput[],
): Promise<void> {
  const { config, ticket, actor, now, type, parentId, opts, interactive } = ctx;

  // Determine selected repos from flags (non-interactive)
  let selectedRepos = new Set<string>(opts.repo ?? []);
  // Also accept repo:branch/base specifiers as implicit repo selectors
  for (const v of opts.branch ?? []) {
    const [rid] = parseKeyed(v);
    if (rid) selectedRepos.add(rid);
  }
  for (const v of opts.base ?? []) {
    const [rid] = parseKeyed(v);
    if (rid) selectedRepos.add(rid);
  }

  // Interactive selection if none provided non-interactively
  if (interactive && selectedRepos.size === 0) {
    const linkNow = await promptConfirm('Link this ticket to a repository now?', type !== 'epic');
    if (linkNow) {
      let repos: string[] = [];
      try {
        repos = listRepos(config).map((r) => r.id);
      } catch {
        repos = [];
      }
      if (repos.length === 0) {
        console.log(c.warn('No repositories configured in repos/repos.yaml. Skipping repo linking.'));
      } else {
        const suggestions = suggestReposFromComponents(config, ticket);
        const chosen = await promptMultiSelect('Select repositories to link', repos, {
          defaultValue: suggestions.repoIds,
          required: true,
        });
        selectedRepos = new Set(chosen);
      }
    }
  }

  if (selectedRepos.size === 0) {
    return; // nothing to do
  }

  // Parse mappings from flags when provided
  const repoList = Array.from(selectedRepos);
  const branchMap = mapByRepo(opts.branch ?? [], repoList, 'branch');
  const baseMap = mapByRepo(opts.base ?? [], repoList, 'base');
  const pathMap = mapByRepo(opts.path ?? [], repoList, 'path');

  // Defaults
  const providerEnabled = opts.provider !== false; // default true unless --no-provider
  const verifyExisting = opts.verifyExisting !== false; // default true unless --no-verify-existing

  const usedNonInteractiveCodeFlags =
    (opts.repo && opts.repo.length > 0) ||
    (opts.branch && opts.branch.length > 0) ||
    (opts.base && opts.base.length > 0) ||
    (opts.path && opts.path.length > 0) ||
    typeof opts.createBranch !== 'undefined' ||
    opts.provider === false ||
    opts.verifyExisting === false;

  // Suggest default branch name once for this ticket (schema-compliant prefix)
  const defaultBranchName = generateBranchName(ticket.id, (ticket as Record<string, unknown>).title as string | undefined, type);

  const suggestions = suggestReposFromComponents(config, ticket);
  for (const repoId of repoList) {
    const repoCfg = getRepo(config, repoId); // validates id

    // Decide whether to create a new branch or link an existing one
    let create = Boolean(opts.createBranch);
    let existingBranch = branchMap[repoId];
    if (!opts.createBranch) {
      // No explicit create flag: default to create for non-epics when branch unspecified
      create = type !== 'epic' && !existingBranch;
    }

    // Interactive refinement when allowed and no explicit flags
    if (interactive && !usedNonInteractiveCodeFlags) {
      const defaultCreate = type !== 'epic';
      create = await promptConfirm(`[${repoId}] Create a new branch for this ticket?`, defaultCreate);
    }

    // Resolve base branch (for creation flow)
    const inheritedBase = await computeBaseBranch(config, repoId, type, parentId);
    const baseOverride = baseMap[repoId];
    let baseBranch = baseOverride ?? inheritedBase;
    if (interactive && create && !usedNonInteractiveCodeFlags) {
      const input = await promptText(`[${repoId}] Base branch`, {
        defaultValue: baseBranch,
        required: true,
      });
      baseBranch = input.trim();
    }

    // Resolve branch name
    let branchName = existingBranch ?? defaultBranchName;
    if (interactive && (create || !existingBranch) && !usedNonInteractiveCodeFlags) {
      const input = await promptText(`[${repoId}] Branch name`, {
        defaultValue: branchName,
        required: true,
      });
      branchName = input.trim();
    }

    // Resolve optional path
    let subPath: string | undefined = pathMap[repoId] ?? suggestions.pathByRepo[repoId];
    if (interactive && !usedNonInteractiveCodeFlags) {
      const input = await promptText(`[${repoId}] Subdirectory path (optional)`, {
        defaultValue: subPath,
        allowEmpty: true,
      });
      subPath = input.trim() === '' ? undefined : input.trim();
    }

    // Record link on ticket
    const linkEntry: Record<string, unknown> = {
      repo_id: repoId,
      branch: branchName,
      created_by: actor,
      created_at: now,
      last_synced_at: now,
    };
    if (subPath) {
      const clean = normalizeRepoPath(subPath);
      if (!isValidRelativePath(clean)) {
        console.log(c.warn(`[${repoId}] Ignoring invalid subdirectory path: ${subPath}`));
      } else {
        (linkEntry as any).path = clean;
      }
    }
    (ticket.code as Record<string, unknown>).repos = [
      ...(((ticket.code as { repos?: unknown }).repos as Record<string, unknown>[] | undefined) ?? []),
      linkEntry,
    ];

    // History entry
    historyOut.push({ op: create ? 'code.branch' : 'code.branch.link', repo_id: repoId, branch: branchName });

    // Remote actions
    const provider = providerEnabled ? createProvider(repoCfg) : null;
    if (create) {
      if (provider) {
        try {
          await provider.ensureBranch({ branch: branchName, base: baseBranch });
        } catch (error) {
          process.stderr.write(
            `[warn] Unable to create remote branch for ${repoId}: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
    } else if (verifyExisting && provider) {
      try {
        const exists = await provider.branchExists(branchName);
        if (!exists) {
          console.log(c.warn(`[${repoId}] Remote branch not found: ${branchName}`));
        }
      } catch (error) {
        process.stderr.write(
          `[warn] Unable to verify remote branch for ${repoId}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  }
}

function parseKeyed(value: string): [string | null, string] {
  const idx = value.indexOf(':');
  if (idx === -1) return [null, value];
  const key = value.slice(0, idx).trim();
  const val = value.slice(idx + 1).trim();
  return [key, val];
}

function mapByRepo(values: string[], repos: string[], label: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!values || values.length === 0) return map;
  const set = new Set(repos);
  for (const raw of values) {
    const [maybeRepo, val] = parseKeyed(raw);
    if (!maybeRepo) {
      if (repos.length !== 1) {
        throw new Error(`--${label} must be provided as repo:${label} when linking multiple repos`);
      }
      map[repos[0]!] = val;
    } else {
      if (!set.has(maybeRepo)) {
        throw new Error(`--${label} provided for unknown repo '${maybeRepo}'. Add with --repo ${maybeRepo}.`);
      }
      map[maybeRepo] = val;
    }
  }
  return map;
}

async function computeBaseBranch(
  config: CliConfig,
  repoId: string,
  type: TicketRecord['type'],
  parentId: string | null,
): Promise<string> {
  try {
    // Try to inherit base branch from parent chain when available in the same repo
    if (parentId) {
      const parent = loadParentTicket(config, parentId);
      const inRepo = findRepoBranch(parent, repoId);
      if (inRepo) return inRepo;
      const maybeGrand = (parent as Record<string, unknown>).parent_id as string | null | undefined;
      if (maybeGrand) {
        const grand = loadParentTicket(config, maybeGrand);
        const inRepo2 = findRepoBranch(grand, repoId);
        if (inRepo2) return inRepo2;
      }
    }
  } catch {
    // ignore and fall back
  }
  // Fallback: repo PR base or default branch
  const cfg = getRepo(config, repoId);
  const base = (cfg.pr && 'base' in cfg.pr ? (cfg.pr as { base?: string }).base : undefined) ?? cfg.default_branch ?? 'main';
  return base;
}

function loadParentTicket(config: CliConfig, id: string): TicketRecord {
  return loadTicket(config, id);
}

function findRepoBranch(ticket: TicketRecord, repoId: string): string | null {
  const code = ticket.code as { repos?: { repo_id: string; branch?: string }[] } | undefined;
  const repo = code?.repos?.find((r) => r.repo_id === repoId);
  return repo?.branch ?? null;
}

function generateBranchName(
  ticketId: string,
  title: string | undefined,
  type: TicketRecord['type'],
): string {
  const prefixMap: Record<TicketRecord['type'], string> = {
    epic: 'epic',
    story: 'feat',
    subtask: 'task',
    bug: 'fix',
  };
  const prefix = prefixMap[type];
  const base = (title ?? ticketId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const slug = base.length > 0 ? base : 'work';
  return `${prefix}/${ticketId}--${slug}`;
}

function normalizeRepoPath(p: string): string {
  const norm = p.replace(/\\+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return norm;
}

function isValidRelativePath(p: string): boolean {
  // Matches schema's relativeFilePath: must start with ../ or ./ or alnum
  return /^(\.\.\/|\.\/|[A-Za-z0-9])/.test(p) && !/(^|\/)\.\.(\/|$)/.test(p);
}

function suggestReposFromComponents(
  config: CliConfig,
  ticket: TicketRecord,
): { repoIds: string[]; pathByRepo: Record<string, string | undefined> } {
  const routing = loadComponentRouting(config);
  const components = (ticket as Record<string, unknown>).components as string[] | undefined;
  const repoIds = new Set<string>();
  const pathByRepo: Record<string, string | undefined> = {};
  if (Array.isArray(components)) {
    for (const comp of components) {
      const routes = routing.routes[comp] ?? [];
      for (const route of routes) {
        repoIds.add(route.repoId);
        if (route.path && !pathByRepo[route.repoId]) {
          pathByRepo[route.repoId] = route.path;
        }
      }
    }
  }
  return { repoIds: Array.from(repoIds.values()), pathByRepo };
}
