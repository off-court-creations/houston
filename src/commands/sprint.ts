import fs from 'node:fs';
import crypto from 'node:crypto';
import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import {
  ensureSprintStructure,
  saveSprintMetadata,
  loadSprint,
  saveSprintScope,
  emptyScope,
  resolveSprintDir,
} from '../services/sprint-store.js';
import { loadTicket } from '../services/ticket-store.js';
import { loadConfig as loadCliConfig } from '../config/config.js';
import { buildWorkspaceAnalytics, type WorkspaceAnalytics, type SprintOverview, type SprintPhase } from '../services/workspace-analytics.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { formatTable, printOutput } from '../lib/printer.js';
import { c } from '../lib/colors.js';

interface SprintNewOptions {
  start?: string;
  end?: string;
  name: string;
  goal?: string;
}

export function registerSprintCommand(program: Command): void {
  const sprint = program
    .command('sprint')
    .description('Sprint management commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14\n  $ houston sprint add S-2025-10-01_2025-10-14 ST-123 ST-124\n  $ houston sprint list --status active\n`,
    );

  sprint
    .command('new')
    .description('Create a new sprint shell')
    .option('--start <date>', 'start date YYYY-MM-DD (defaults to today)')
    .option('--end <date>', 'end date YYYY-MM-DD (defaults to 14 days after start)')
    .requiredOption('--name <name>', 'sprint name')
    .option('--goal <goal>', 'sprint goal')
    .action(async (options: SprintNewOptions) => {
      await handleSprintNew(options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston sprint new --name "Sprint 42"\n  $ houston sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14 --goal "Ship checkout v2"\nNotes:\n  - If dates are omitted, defaults to today and +14 days.\n`,
    );

  sprint
    .command('add')
    .description('Add tickets to an existing sprint scope')
    .argument('<sprintId>')
    .argument('<ticketIds...>')
    .action(async (sprintId: string, ticketIds: string[]) => {
      await handleSprintAdd(sprintId, ticketIds);
    })
    .addHelpText('after', `\nExamples:\n  $ houston sprint add S-2025-10-01_2025-10-14 ST-123 ST-124\n`);

  sprint
    .command('list')
    .description('List sprints in the current workspace')
    .option('-j, --json', 'output as JSON')
    .option('-s, --status <status...>', 'filter by sprint status (active|upcoming|completed|unknown)')
    .action(async (options: { json?: boolean; status?: ('active' | 'upcoming' | 'completed' | 'unknown')[] }) => {
      await handleSprintList(options);
    })
    .addHelpText('after', `\nExamples:\n  $ houston sprint list\n  $ houston sprint list --status active completed\n`);
}

async function handleSprintNew(options: SprintNewOptions): Promise<void> {
  const config = loadConfig();
  const { startDate, endDate } = resolveSprintWindow(options);
  const sprintId = generateSprintId(config, startDate, endDate, options.name);
  ensureSprintStructure(config, sprintId);
  saveSprintMetadata(config, {
    id: sprintId,
    name: options.name,
    start_date: startDate,
    end_date: endDate,
    goal: options.goal,
    generated_by: config.metadata.generator,
  });
  saveSprintScope(config, sprintId, emptyScope(config.metadata.generator));
  console.log(c.ok(`Created sprint ${c.id(sprintId)}`));
}

function resolveSprintWindow(options: SprintNewOptions): { startDate: string; endDate: string } {
  const start = options.start ? parseDate(options.start, '--start') : startOfToday();
  const end = options.end ? parseDate(options.end, '--end') : addDays(start, 14);
  if (end.getTime() < start.getTime()) {
    throw new Error('End date must not be before start date');
  }
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function generateSprintId(config: ReturnType<typeof loadConfig>, startDate: string, endDate: string, name: string): string {
  const slug = slugify(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const random = crypto.randomBytes(3).toString('hex');
    const candidate = `S-${startDate}_${endDate}--${slug}-${random}`;
    const dir = resolveSprintDir(config, candidate);
    if (!fs.existsSync(dir)) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique sprint id after multiple attempts. Please provide explicit dates.');
}

function slugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'sprint';
}

function parseDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${flag} value. Expected YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${flag} value. Unable to parse date.`);
  }
  return date;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function handleSprintAdd(sprintId: string, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) {
    console.log('No tickets provided.');
    return;
  }
  const config = loadConfig();
  const sprint = loadSprint(config, sprintId);
  if (!sprint) {
    throw new Error(`Sprint ${sprintId} not found`);
  }
  const scope = sprint.scope;
  for (const ticketId of ticketIds) {
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
  }
  saveSprintScope(config, sprintId, scope);
  console.log(c.ok(`Added ${ticketIds.length} ticket(s) to ${c.id(sprintId)}`));
}

function uniquePush(list: string[] | undefined, id: string): string[] {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(id)) {
    next.push(id);
  }
  return next;
}

async function handleSprintList(options: { json?: boolean; status?: ('active' | 'upcoming' | 'completed' | 'unknown')[] }): Promise<void> {
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
  }

  printOutput(payload, lines, options);
}

function loadAnalytics(): {
  analytics: WorkspaceAnalytics;
} {
  const config = loadCliConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { analytics };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
