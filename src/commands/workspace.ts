import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { formatKeyValues, formatTable, printOutput } from '../lib/printer.js';
import {
  buildWorkspaceAnalytics,
  SprintOverview,
  SprintPhase,
  TicketOverview,
  WorkspaceAnalytics,
} from '../services/workspace-analytics.js';
import { collectWorkspaceInventory, TicketType } from '../services/workspace-inventory.js';

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
}

const WORKSPACE_GENERATOR = 'stardate@workspace-create';
const IGNORED_DIRECTORY_ENTRIES = new Set(['.', '..', '.git', '.gitignore', '.gitattributes', '.DS_Store']);

const FILE_TEMPLATES: Array<[string, string]> = [
  [
    'stardate.config.yaml',
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
    `repos:\n  - id: repo.sample\n    provider: github\n    remote: git@github.com:example/sample.git\n    default_branch: main\n    branch_prefix:\n      epic: epic\n      story: story\n      subtask: subtask\n      bug: bug\n    pr:\n      open_by_default: false\n    protections:\n      require_status_checks: false\n      disallow_force_push: false\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
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
    '# Workspace Schemas\n\nRun `stardate schemas` to generate the JSON schema files from the CLI.\n',
  ],
  [
    'tickets/README.md',
    '# Tickets\n\nOrganize ticket directories by type (EPIC/STORY/SUBTASK/BUG). Each ticket should contain `ticket.yaml` and `history.ndjson`.\n',
  ],
  [
    'sprints/README.md',
    '# Sprints\n\nPlace sprint shells here (e.g. `S-YYYY-MM-DD_YYYY-MM-DD/sprint.yaml`).\n',
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
  const workspace = program.command('workspace').description('Inspect workspace state');

  workspace
    .command('create')
    .description('Scaffold a new Stardate workspace')
    .argument('[directory]', 'target directory (defaults to current directory)', '.')
    .option('--force', 'allow creation in a non-empty directory')
    .option('--no-git', 'skip git initialization')
    .action((directory: string, options: CreateWorkspaceOptions) => {
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      ensureDirectory(targetDir);
      if (!options.force && hasMeaningfulEntries(targetDir)) {
        throw new Error(`Target directory ${targetDir} is not empty. Use --force to continue.`);
      }
      scaffoldWorkspace(targetDir, options.force === true);
      if (options.git !== false) {
        initGitRepository(targetDir);
      }
      console.log(`Initialized Stardate workspace at ${targetDir}`);
    });

  workspace
    .command('summary')
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
      lines.push(`Workspace : ${config.workspaceRoot}`);
      lines.push(`Tracking  : ${config.tracking.root}`);
      lines.push(`Schema    : ${config.tracking.schemaDir}`);
      lines.push('');
      lines.push('Tickets by type:');
      lines.push(
        ...formatKeyValues(
          Object.entries(analytics.summary.ticketTypeCounts).map(([key, value]) => [key, value.toString()]),
        ).map(indentLine),
      );
      if (Object.keys(analytics.summary.ticketStatusCounts).length > 0) {
        lines.push('Tickets by status:');
        lines.push(
          ...formatKeyValues(
            Object.entries(analytics.summary.ticketStatusCounts).map(([key, value]) => [key, value.toString()]),
          ).map(indentLine),
        );
      }
      lines.push('');
      lines.push(
        ...formatKeyValues([
          ['Backlog items', analytics.summary.backlogCount.toString()],
          ['Next sprint', analytics.summary.nextSprintCount.toString()],
          ['Repos', analytics.summary.repoCount.toString()],
          ['Components', analytics.summary.componentCount.toString()],
          ['Labels', analytics.summary.labelCount.toString()],
          ['People', analytics.summary.userCount.toString()],
          ['Active sprints', analytics.summary.activeSprintCount.toString()],
          ['Unknown repo refs', analytics.unknownRepoTickets.length.toString()],
        ]),
      );
      if (activeSprints.length || upcomingSprints.length || completedSprints.length) {
        lines.push('');
        if (activeSprints.length) {
        lines.push('Active sprints:');
        lines.push(...activeSprints.map((sprint) => indentLine(renderSprintLine(sprint))));
      }
      if (upcomingSprints.length) {
        lines.push('Upcoming sprints:');
        lines.push(...upcomingSprints.map((sprint) => indentLine(renderSprintLine(sprint))));
        }
        if (completedSprints.length) {
          lines.push('Recent completed sprints:');
          const recent = completedSprints.slice(-3);
          lines.push(...recent.map((sprint) => indentLine(renderSprintLine(sprint))));
        }
      }

      printOutput(payload, lines, options);
    });

  workspace
    .command('tickets')
    .description('List tickets in the current workspace')
    .option('-j, --json', 'output as JSON')
    .option('-t, --type <type...>', 'filter by ticket type (epic|story|subtask|bug)')
    .option('-s, --status <status...>', 'filter by ticket status')
    .option('-a, --assignee <assignee...>', 'filter by assignee id')
    .option('-r, --repo <repo...>', 'filter by repository id referenced by tickets')
    .option('--sprint <sprint...>', 'filter by sprint id')
    .option('-c, --component <component...>', 'filter by component name')
    .option('-l, --label <label...>', 'filter by label')
    .option('--sort <field>', 'sort field (id|status|assignee|updated)', 'id')
    .option('--limit <count>', 'limit number of tickets returned', parsePositiveInt)
    .action((options: TicketListOptions) => {
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
          { header: 'ID', value: (row) => row.id },
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
    });

  workspace
    .command('sprints')
    .description('Show sprint shells and scope details')
    .option('-j, --json', 'output as JSON')
    .option('-s, --status <status...>', 'filter by sprint status (active|upcoming|completed|unknown)')
    .action((options: SprintListOptions) => {
      const { analytics } = loadAnalytics();
      const statuses = options.status?.map((value) => value.toLowerCase() as SprintPhase);
      let sprints = analytics.sprints.slice();
      if (statuses && statuses.length > 0) {
        sprints = sprints.filter((sprint) => statuses.includes(sprint.status));
      }

      const payload = {
        count: sprints.length,
        sprints: sprints.map((sprint) => ({
          id: sprint.id,
          name: sprint.name,
          status: sprint.status,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          goal: sprint.goal,
          totalScoped: sprint.totalScoped,
          scope: {
            epics: sprint.scope.epics.map((ticket) => ticket.id),
            stories: sprint.scope.stories.map((ticket) => ticket.id),
            subtasks: sprint.scope.subtasks.map((ticket) => ticket.id),
            bugs: sprint.scope.bugs.map((ticket) => ticket.id),
            missing: sprint.scope.missing,
          },
          path: sprint.path,
          scopePath: sprint.scopePath,
        })),
      };

      const lines: string[] = [];
      if (sprints.length === 0) {
        lines.push('No sprints found.');
      } else {
        const table = formatTable(sprints, [
          { header: 'ID', value: (row) => row.id },
          { header: 'Status', value: (row) => row.status },
          { header: 'Start', value: (row) => row.startDate ?? '-' },
          { header: 'End', value: (row) => row.endDate ?? '-' },
          { header: 'Scoped', value: (row) => row.totalScoped.toString() },
          { header: 'Goal', value: (row) => truncate(row.goal ?? '', 40) },
        ]);
        lines.push(...table);
        for (const sprint of sprints) {
          if (sprint.scope.missing.length) {
            lines.push('');
            lines.push(`${sprint.id}: missing tickets -> ${sprint.scope.missing.join(', ')}`);
          }
        }
      }

      printOutput(payload, lines, options);
    });

  workspace
    .command('repos')
    .description('List configured repositories and ticket links')
    .option('-j, --json', 'output as JSON')
    .action((options: JsonOption) => {
      const { analytics } = loadAnalytics();
      const payload = {
        repos: analytics.repoUsage.map((entry) => ({
          id: entry.config.id,
          provider: entry.config.provider,
          remote: entry.config.remote,
          ticketIds: entry.tickets.map((ticket) => ticket.id),
        })),
        unknownRepoTickets: analytics.unknownRepoTickets.map((ticket) => ({
          id: ticket.id,
          repoIds: ticket.repoIds,
        })),
      };

      const lines: string[] = [];
      if (analytics.repoUsage.length === 0) {
        lines.push('No repos configured.');
      } else {
        const table = formatTable(analytics.repoUsage, [
          { header: 'Repo ID', value: (row) => row.config.id },
          { header: 'Provider', value: (row) => row.config.provider },
          { header: 'Remote', value: (row) => row.config.remote },
          { header: 'Tickets', value: (row) => (row.tickets.length ? row.tickets.map((ticket) => ticket.id).join(',') : '-') },
        ]);
        lines.push(...table);
      }
      if (analytics.unknownRepoTickets.length) {
        lines.push('');
        lines.push(
          `Tickets referencing unknown repos: ${analytics.unknownRepoTickets
            .map((ticket) => `${ticket.id}(${ticket.repoIds.join(',')})`)
            .join(', ')}`,
        );
      }

      printOutput(payload, lines, options);
    });

  workspace
    .command('backlog')
    .description('Display backlog and next sprint queues')
    .option('-j, --json', 'output as JSON')
    .option('--include-missing', 'show ticket ids that are referenced but unavailable')
    .action((options: BacklogOptions) => {
      const { analytics } = loadAnalytics();
      const payload = {
        backlog: {
          path: analytics.backlog.path,
          tickets: analytics.backlog.tickets.map(toTicketStub),
          missing: analytics.backlog.missing,
        },
        nextSprint: {
          path: analytics.nextSprint.path,
          tickets: analytics.nextSprint.tickets.map(toTicketStub),
          missing: analytics.nextSprint.missing,
        },
      };

      const lines: string[] = [];
      lines.push(`Backlog (${analytics.backlog.path})`);
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
      lines.push(`Next Sprint Candidates (${analytics.nextSprint.path})`);
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
    });
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
  const entries = fs.readdirSync(targetDir);
  return entries.some((entry) => !IGNORED_DIRECTORY_ENTRIES.has(entry));
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

function loadAnalytics(): {
  config: ReturnType<typeof loadConfig>;
  analytics: WorkspaceAnalytics;
} {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { config, analytics };
}

function indentLine(text: string): string {
  return `  ${text}`;
}

function renderSprintLine(sprint: SprintOverview): string {
  const label = formatSprintPretty(sprint);
  const status = capitalize(sprint.status);
  return `${sprint.id} — ${label} [${status}]`;
}

function renderTicketLine(ticket: TicketOverview): string {
  const status = ticket.status ? `[${ticket.status}]` : '';
  const assignee = ticket.assignee ? `@${ticket.assignee}` : '';
  const summary = ticket.summary ?? ticket.title ?? '';
  return `${ticket.id} ${status} ${assignee} ${summary}`.replace(/\s+/g, ' ').trim();
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
