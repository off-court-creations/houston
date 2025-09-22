import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { printOutput, renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import {
  buildWorkspaceAnalytics,
  SprintOverview,
  SprintPhase,
  TicketOverview,
  WorkspaceAnalytics,
} from '../services/workspace-analytics.js';
import { collectWorkspaceInventory, TicketType } from '../services/workspace-inventory.js';
import { canPrompt as canInteractive, intro as uiIntro, outro as uiOutro, promptConfirm as uiConfirm, promptText as uiText, spinner as uiSpinner } from '../lib/interactive.js';
import { shortenTicketId } from '../lib/id.js';

interface JsonOption {
  json?: boolean;
}

interface TicketListOptions extends JsonOption {
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

interface SprintListOptions extends JsonOption {
  status?: ('active' | 'upcoming' | 'completed' | 'unknown')[];
}

interface BacklogOptions extends JsonOption {
  includeMissing?: boolean;
}

interface CreateWorkspaceOptions {
  force?: boolean;
  git?: boolean;
  interactive?: boolean;
}

const WORKSPACE_GENERATOR = 'houston@workspace-create';
const IGNORED_DIRECTORY_ENTRIES = new Set(['.', '..', '.git', '.gitignore', '.gitattributes', '.DS_Store']);

const FILE_TEMPLATES: Array<[string, string]> = [
  [
    'houston.config.yaml',
    `tracking:\n  root: .\n  schemaDir: schema\n  ticketsDir: tickets\n  backlogDir: backlog\n  sprintsDir: sprints\n`,
  ],
  [
    'backlog/backlog.yaml',
    `ordered: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'backlog/next-sprint-candidates.yaml',
    `candidates: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'repos/repos.yaml',
    `repos: []\n`,
  ],
  [
    'repos/component-routing.yaml',
    `routes: {}\ndefaults:\n  epic: []\n  story: []\n  subtask: []\n  bug: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'people/users.yaml',
    `users: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'taxonomies/components.yaml',
    `components: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'taxonomies/labels.yaml',
    `labels: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'transitions.yaml',
    `allowed:\n  epic:\n    Backlog: ["Ready", "Canceled", "Archived"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["In Progress", "Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  story:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["In Progress", "Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  subtask:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  bug:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'schema/README.md',
    '# Workspace Schemas\n\nRun `houston schemas` to generate the JSON schema files from the CLI.\n',
  ],
  [
    'tickets/README.md',
    '# Tickets\n\nOrganize ticket directories by type (EPIC/STORY/SUBTASK/BUG). Each ticket should contain `ticket.yaml` and `history.ndjson`.\n',
  ],
  [
    'sprints/README.md',
    '# Sprints\n\nPlace sprint shells here (e.g. `S-123e4567-e89b-42d3-a456-426614174000/sprint.yaml`).\n',
  ],
];

const GITKEEP_PATHS = [
  'tickets/EPIC/.gitkeep',
  'tickets/STORY/.gitkeep',
  'tickets/SUBTASK/.gitkeep',
  'tickets/BUG/.gitkeep',
  'sprints/.gitkeep',
  'schema/.gitkeep',
];

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Inspect workspace state')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace info\n  $ houston workspace info --json\n  $ houston workspace new my-workspace --no-git\n  $ houston workspace new --interactive\n`,
    );

  workspace
    .command('new')
    .description('Scaffold a new Houston workspace')
    .argument('[directory]', 'target directory (defaults to current directory)', '.')
    .option('--force', 'allow creation in a non-empty directory')
    .option('--no-git', 'skip git initialization')
    .option('-i, --interactive', 'run guided setup even when arguments are provided')
    .option('--no-interactive', 'run non-interactively (bypass prompts)')
    .action((directory: string, options: CreateWorkspaceOptions) => {
      // Run wizard by default when in a TTY, unless explicitly disabled.
      const shouldInteractive = options.interactive !== false && canInteractive();
      if (shouldInteractive) {
        return runWorkspaceNewInteractive(directory, options);
      }
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      ensureDirectory(targetDir);
      if (!options.force && hasMeaningfulEntries(targetDir)) {
        throw new Error(`Target directory ${targetDir} is not empty. Use --force to continue.`);
      }
      scaffoldWorkspace(targetDir, options.force === true);
      if (options.git !== false) {
        initGitRepository(targetDir);
      }
      console.log(c.ok(`Initialized Houston workspace at ${targetDir}`));
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace new\n  $ houston workspace new ./tracking --no-git\n  $ houston workspace new ./tracking --force\n  $ houston workspace new ./tracking --no-interactive --force\nNotes:\n  - Creates a directory structure with schema, tickets, backlog, sprints, repos, people, taxonomies.\n  - Use --force to overwrite existing files.\n  - Use --no-interactive to bypass the wizard in TTY contexts.\n`,
    );

  workspace
    .command('info')
    .description('Show high-level workspace snapshot')
    .option('-j, --json', 'output as JSON')
    .action((options: JsonOption) => {
      const { config, analytics } = loadAnalytics();
      const activeSprints = analytics.sprints.filter((sprint) => sprint.status === 'active');
      const upcomingSprints = analytics.sprints.filter((sprint) => sprint.status === 'upcoming');
      const completedSprints = analytics.sprints.filter((sprint) => sprint.status === 'completed');
      const payload = {
        workspace: {
          workspaceRoot: config.workspaceRoot,
          trackingRoot: config.tracking.root,
          schemaDir: config.tracking.schemaDir,
        },
        summary: analytics.summary,
        sprints: {
          active: activeSprints.map(minifySprint),
          upcoming: upcomingSprints.map(minifySprint),
          completed: completedSprints.map(minifySprint),
        },
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
        repos: {
          configured: analytics.repoUsage.map((entry) => ({
            id: entry.config.id,
            provider: entry.config.provider,
            remote: entry.config.remote,
            ticketIds: entry.tickets.map((ticket) => ticket.id),
          })),
          unknownReferences: analytics.unknownRepoTickets.map((ticket) => ticket.id),
        },
      };

      const lines: string[] = [];

      const workspaceTable = renderBoxTable([
        [c.bold('Resource'), c.bold('Value')],
        ['Workspace root', config.workspaceRoot],
        ['Tracking root', config.tracking.root],
        ['Schema dir', config.tracking.schemaDir],
        ['Backlog path', analytics.backlog.path],
        ['Next sprint path', analytics.nextSprint.path],
      ]);
      lines.push(c.heading('Workspace'));
      lines.push(...workspaceTable);

      const summaryRows: string[][] = [
        [c.bold('Group'), c.bold('Metric'), c.bold('Value')],
        ['Totals', 'Total tickets', analytics.summary.totalTickets.toString()],
      ];

      const typeEntries = Object.entries(analytics.summary.ticketTypeCounts).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      for (const [type, count] of typeEntries) {
        summaryRows.push(['Type', capitalize(type), count.toString()]);
      }

      const statusEntries = Object.entries(analytics.summary.ticketStatusCounts).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      if (statusEntries.length > 0) {
        for (const [status, count] of statusEntries) {
          summaryRows.push(['Status', capitalize(status), count.toString()]);
        }
      }

      summaryRows.push(
        ['Totals', 'Backlog items', analytics.summary.backlogCount.toString()],
        ['Totals', 'Next sprint items', analytics.summary.nextSprintCount.toString()],
        ['Totals', 'Repos configured', analytics.summary.repoCount.toString()],
        ['Totals', 'Components', analytics.summary.componentCount.toString()],
        ['Totals', 'Labels', analytics.summary.labelCount.toString()],
        ['Totals', 'People', analytics.summary.userCount.toString()],
        ['Totals', 'Active sprints', analytics.summary.activeSprintCount.toString()],
        ['Totals', 'Unknown repo refs', analytics.unknownRepoTickets.length.toString()],
        ['Queues', 'Backlog missing tickets', analytics.backlog.missing.length.toString()],
        ['Queues', 'Next sprint missing tickets', analytics.nextSprint.missing.length.toString()],
      );

      const summaryTable = renderBoxTable(summaryRows);
      lines.push('');
      lines.push(c.heading('Summary'));
      lines.push(...summaryTable);

      const displayedSprints = [
        ...activeSprints,
        ...upcomingSprints,
        ...completedSprints.slice(-3),
      ];
      lines.push('');
      lines.push(c.heading('Sprints'));
      if (displayedSprints.length > 0) {
        const sprintRows: string[][] = [
          [c.bold('Sprint'), c.bold('Label'), c.bold('Status'), c.bold('Scoped')],
        ];
        for (const sprint of displayedSprints) {
          sprintRows.push([
            c.id(sprint.id),
            formatSprintPretty(sprint),
            c.status(capitalize(sprint.status)),
            sprint.totalScoped.toString(),
          ]);
        }
        const sprintTable = renderBoxTable(sprintRows);
        lines.push(...sprintTable);
      } else {
        lines.push('No sprints found.');
      }

      printOutput(payload, lines, options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace info\n  $ houston workspace info --json\n`,
    );

  // No additional workspace aliases; use top-level `houston check` instead.
}

function ensureDirectory(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    return;
  }
  const stats = fs.statSync(targetDir);
  if (!stats.isDirectory()) {
    throw new Error(`Target ${targetDir} exists and is not a directory.`);
  }
}

function hasMeaningfulEntries(targetDir: string): boolean {
  if (!fs.existsSync(targetDir)) {
    return false;
  }
  try {
    const entries = fs.readdirSync(targetDir);
    return entries.some((entry) => !IGNORED_DIRECTORY_ENTRIES.has(entry));
  } catch {
    return false;
  }
}

function scaffoldWorkspace(targetDir: string, force: boolean): void {
  const directories = [
    'schema',
    'tickets',
    'tickets/EPIC',
    'tickets/STORY',
    'tickets/SUBTASK',
    'tickets/BUG',
    'backlog',
    'sprints',
    'repos',
    'people',
    'taxonomies',
  ];
  for (const dir of directories) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }

  for (const [relativePath, content] of FILE_TEMPLATES) {
    writeTemplateFile(targetDir, relativePath, content, force);
  }

  for (const gitkeep of GITKEEP_PATHS) {
    writeTemplateFile(targetDir, gitkeep, '', force);
  }
}

function writeTemplateFile(targetDir: string, relativePath: string, content: string, force: boolean): void {
  const destination = path.join(targetDir, relativePath);
  if (fs.existsSync(destination) && !force) {
    throw new Error(`File ${destination} already exists. Use --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const normalized = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
  fs.writeFileSync(destination, normalized, 'utf8');
}

function copyBundledSchemas(destSchemaDir: string): void {
  const here = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
  // Try both source and dist layouts
  const candidates = [
    path.resolve(here, '../../schema'),
    path.resolve(here, '../schema'),
  ];
  let sourceDir: string | undefined;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      sourceDir = c;
      break;
    }
  }
  if (!sourceDir) return;
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.schema.json'));
  fs.mkdirSync(destSchemaDir, { recursive: true });
  for (const file of files) {
    const src = path.join(sourceDir, file);
    const dst = path.join(destSchemaDir, file);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
  }
}

function initGitRepository(targetDir: string): void {
  const initArgs = ['init', '--initial-branch=main'];
  let result = spawnSync('git', initArgs, { cwd: targetDir, stdio: 'inherit' });
  if (result.error) {
    throw new Error(`Failed to run git: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    // Fallback for older Git versions that do not understand --initial-branch
    result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'inherit' });
    if (result.error) {
      throw new Error(`Failed to run git: ${result.error.message}`);
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error('git init failed');
    }

    const branchResult = spawnSync('git', ['checkout', '-b', 'main'], { cwd: targetDir, stdio: 'inherit' });
    if (branchResult.error) {
      throw new Error(`Failed to create main branch: ${branchResult.error.message}`);
    }
    if (typeof branchResult.status === 'number' && branchResult.status !== 0) {
      throw new Error('Unable to set default branch to main');
    }
  }
}

async function runWorkspaceNewInteractive(initialDir?: string, options: CreateWorkspaceOptions = {}): Promise<void> {
  await uiIntro('Create Houston Workspace');
  const directory = await uiText('Directory', { defaultValue: initialDir ?? '.', required: true });
  const targetDir = path.resolve(process.cwd(), directory ?? '.');
  const existsAndHasFiles = hasMeaningfulEntries(targetDir);
  let allowOverwrite = Boolean(options.force);
  if (existsAndHasFiles && !allowOverwrite) {
    allowOverwrite = await uiConfirm(`Directory ${targetDir} is not empty. Overwrite files?`, false);
    if (!allowOverwrite) {
      await uiOutro('Aborted');
      return;
    }
  }
  let initGit = options.git !== false;
  if (options.git === undefined) {
    initGit = await uiConfirm('Initialize git?', true);
  }
  const sp = uiSpinner();
  await sp.start('Scaffolding workspace...');
  try {
    ensureDirectory(targetDir);
    scaffoldWorkspace(targetDir, allowOverwrite || existsAndHasFiles);
    // Populate schema directory with bundled JSON schemas when available
    try {
      copyBundledSchemas(path.join(targetDir, 'schema'));
    } catch {
      // best-effort; fallback loader can still supply bundled schemas at runtime
    }
    if (initGit) {
      initGitRepository(targetDir);
    }
    sp.stop('Workspace created');

    // Post-setup guidance and optional next steps
    const addUsers = await uiConfirm('Add users now?', true);
    const addComponents = await uiConfirm('Add components now?', true);
    const addLabels = await uiConfirm('Add labels now?', true);
    const authLogin = await uiConfirm('Login to GitHub for PR/branch automation now?', false);
    const addRepos = await uiConfirm('Add repositories now?', true);

    const queue: string[] = [];
    queue.push(`cd ${targetDir}`);
    if (addUsers) queue.push('houston user add');
    if (addComponents) queue.push('houston component add');
    if (addLabels) queue.push('houston label add');
    if (authLogin) queue.push('houston auth login github');
    if (addRepos) queue.push('houston repo add');
    queue.push('houston check');
    queue.push('houston workspace info');

    const checklistRows: string[][] = [
      [c.bold('Area'), c.bold('Focus')],
      ['People', 'Add core users (owner/IC/PM)'],
      ['Components', 'Record stable product areas'],
      ['Labels', 'Define taxonomy for filtering/reporting'],
      ['Repos', 'Register code repositories (remote optional)'],
      ['Auth', 'Store a GitHub token for automation'],
    ];

    const commandRows: string[][] = [[c.bold('Command'), c.bold('Purpose')]];
    for (const cmd of queue) {
      const purpose = describeSetupCommand(cmd);
      const formatted = formatSetupCommand(cmd);
      commandRows.push([formatted, purpose]);
    }

    const lines: string[] = [];
    lines.push(c.heading('Houston workspace ready'));
    lines.push(`Workspace scaffolded at ${c.id(targetDir)}`);
    lines.push('');
    lines.push(c.subheading('Setup focus'));
    lines.push(...renderBoxTable(checklistRows));
    lines.push('');
    lines.push(c.subheading('Run these next'));
    lines.push(...renderBoxTable(commandRows));
    await uiOutro(lines.join('\n'));
  } catch (error) {
    sp.stopWithError('Failed to create workspace');
    throw error;
  }
}

function formatSetupCommand(cmd: string): string {
  if (cmd.startsWith('cd ')) {
    return `$ cd ${c.id(cmd.slice(3))}`;
  }
  return `$ ${c.id(cmd)}`;
}

function describeSetupCommand(cmd: string): string {
  if (cmd.startsWith('cd ')) return 'Enter the workspace directory';
  switch (cmd) {
    case 'houston user add':
      return 'Capture people in people/users.yaml';
    case 'houston component add':
      return 'Register product components';
    case 'houston label add':
      return 'Record shared labels';
    case 'houston auth login github':
      return 'Store a GitHub token for automation';
    case 'houston repo add':
      return 'Add repositories to repos/repos.yaml';
    case 'houston check':
      return 'Validate workspace health';
    case 'houston workspace info':
      return 'Review workspace snapshot';
    default:
      return '';
  }
}

function loadAnalytics(): {
  config: ReturnType<typeof loadConfig>;
  analytics: WorkspaceAnalytics;
} {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { config, analytics };
}

function renderTicketLine(ticket: TicketOverview): string {
  const status = ticket.status ? `[${ticket.status}]` : '';
  const assignee = ticket.assignee ? `@${ticket.assignee}` : '';
  const summary = ticket.summary ?? ticket.title ?? '';
  const coloredStatus = ticket.status ? `[${c.status(ticket.status)}]` : '';
  const coloredAssignee = ticket.assignee ? c.dim(`@${ticket.assignee}`) : '';
  const shortId = shortenTicketId(ticket.id);
  return `${c.id(shortId)} ${coloredStatus} ${coloredAssignee} ${summary}`.replace(/\s+/g, ' ').trim();
}

function toTicketStub(ticket: TicketOverview): {
  id: string;
  type: TicketType;
  status?: string;
  assignee?: string;
  summary?: string;
} {
  return {
    id: ticket.id,
    type: ticket.type,
    status: ticket.status,
    assignee: ticket.assignee,
    summary: ticket.summary ?? ticket.title,
  };
}

function minifySprint(sprint: SprintOverview): {
  id: string;
  status: SprintOverview['status'];
  startDate?: string;
  endDate?: string;
  name?: string;
  pretty: string;
} {
  return {
    id: sprint.id,
    status: sprint.status,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    name: sprint.name,
    pretty: formatSprintPretty(sprint),
  };
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
      sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
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
    return 'id';
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

function formatSprintPretty(sprint: SprintOverview): string {
  const window = formatSprintWindow(sprint.startDate, sprint.endDate);
  const name = sprint.name?.trim();
  if (name && window) {
    return `${name} (${window})`;
  }
  if (name) {
    return name;
  }
  if (window) {
    return window;
  }
  return sprint.id;
}

function formatSprintWindow(start?: string, end?: string): string | undefined {
  if (start && end) {
    return `${start} → ${end}`;
  }
  if (start) {
    return start;
  }
  if (end) {
    return end;
  }
  return undefined;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
