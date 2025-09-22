import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { formatTable, printOutput, renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import { resolveTicketIds } from '../services/ticket-id-resolver.js';
import { shortenTicketId } from '../lib/id.js';
import {
  canPrompt as canInteractive,
  intro as uiIntro,
  outro as uiOutro,
  promptSelect as uiSelect,
  promptText as uiText,
  spinner as uiSpinner,
} from '../lib/interactive.js';

interface SprintNewOptions {
  start?: string;
  end?: string;
  name?: string;
  goal?: string;
  interactive?: boolean;
}

export function registerSprintCommand(program: Command): void {
  const sprint = program
    .command('sprint')
    .description('Sprint management commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14\n  $ houston sprint add S-550e8400-e29b-41d4-a716-446655440000 ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n  $ houston sprint list --status active\n`,
    );

  sprint
    .command('new')
    .description('Create a new sprint shell')
    .option('--start <date>', 'start date YYYY-MM-DD (defaults to today)')
    .option('--end <date>', 'end date YYYY-MM-DD (defaults to 14 days after start)')
    .option('--name <name>', 'sprint name')
    .option('--goal <goal>', 'sprint goal')
    .option('-i, --interactive', 'prompt for fields when omitted')
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
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston sprint add S-550e8400-e29b-41d4-a716-446655440000 ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n`,
    );

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
  let resolved = { ...options };
  const missing = collectMissingSprintFields(resolved);
  const interactiveSession = Boolean(resolved.interactive || missing.length > 0);

  if (interactiveSession) {
    if (!canInteractive()) {
      throw new Error(`Missing required options: ${missing.join(', ')}. Re-run with --interactive in a terminal.`);
    }
    const interactiveResult = await runSprintNewInteractive(resolved);
    if (interactiveResult.aborted) {
      return;
    }
    resolved = {
      ...resolved,
      name: interactiveResult.name,
      start: interactiveResult.start,
      end: interactiveResult.end,
      goal: interactiveResult.goal,
    };

    const config = loadConfig();
    const { startDate, endDate } = resolveSprintWindow(resolved);
    const spinner = uiSpinner();
    await spinner.start('Creating sprint...');
    try {
      const creation = createSprint(config, resolved.name!, startDate, endDate, resolved.goal);
      spinner.stop('Sprint created');
      await renderSprintInteractiveOutro(creation, {
        name: resolved.name!,
        goal: resolved.goal,
        startDate,
        endDate,
        durationDays: interactiveResult.durationDays,
      });
    } catch (error) {
      spinner.stopWithError('Failed to create sprint');
      throw error;
    }
    return;
  }

  if (missing.length > 0) {
    throw new Error(`Missing required options: ${missing.join(', ')}`);
  }

  const config = loadConfig();
  const { startDate, endDate } = resolveSprintWindow(resolved);
  const creation = createSprint(config, resolved.name!, startDate, endDate, resolved.goal);
  console.log(c.ok(`Created sprint ${c.id(creation.id)}`));
}

function resolveSprintWindow(options: SprintNewOptions): { startDate: string; endDate: string } {
  const start = options.start ? parseDate(options.start, '--start') : startOfToday();
  const end = options.end ? parseDate(options.end, '--end') : addDays(start, 14);
  if (end.getTime() < start.getTime()) {
    throw new Error('End date must not be before start date');
  }
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function collectMissingSprintFields(opts: SprintNewOptions): string[] {
  const missing: string[] = [];
  if (!opts.name) missing.push('--name');
  return missing;
}

function generateSprintId(config: ReturnType<typeof loadConfig>): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `S-${randomUUID()}`;
    const dir = resolveSprintDir(config, candidate);
    if (!fs.existsSync(dir)) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique sprint id after multiple attempts. Please retry.');
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

interface SprintCreationResult {
  id: string;
  dir: string;
  sprintFile: string;
  scopeFile: string;
}

interface SprintInteractiveResult {
  aborted: boolean;
  name?: string;
  start?: string;
  end?: string;
  goal?: string;
  durationDays: number;
}

async function runSprintNewInteractive(initial: SprintNewOptions): Promise<SprintInteractiveResult> {
  await uiIntro('Create Sprint');

  let name = (initial.name ?? '').trim();
  name = (await uiText('Sprint name', {
    required: true,
    defaultValue: name || undefined,
    placeholder: 'e.g. Sprint 42',
    validate: (value) => (value.trim() === '' ? 'Sprint name is required.' : null),
  })).trim();

  let startDate = safeParseDate(initial.start, '--start') ?? startOfToday();
  startDate = await promptStartDate(startDate);

  let endDate = safeParseDate(initial.end, '--end') ?? addDays(startDate, 14);
  endDate = await promptEndDate(startDate, endDate);

  let goal = (initial.goal ?? '').trim();
  goal = (await uiText('Sprint goal (optional)', {
    defaultValue: goal,
    allowEmpty: true,
  })).trim();

  while (true) {
    const durationDays = diffDays(startDate, endDate);
    const summaryRows: string[][] = [
      [c.bold('Field'), c.bold('Value')],
      ['Name', name || '(not set)'],
      ['Start', formatDateDisplay(startDate)],
      ['End', formatDateDisplay(endDate)],
      ['Window', `${formatDate(startDate)} → ${formatDate(endDate)} (${formatDuration(durationDays)})`],
      ['Goal', goal ? goal : '(none)'],
    ];

    console.log('');
    console.log(c.subheading('Sprint draft'));
    for (const line of renderBoxTable(summaryRows)) console.log(line);
    console.log('');

    const action = await uiSelect('What would you like to do next?', [
      { label: 'Create sprint', value: 'create' },
      { label: 'Rename sprint', value: 'name' },
      { label: 'Adjust start date', value: 'start' },
      { label: 'Adjust end date', value: 'end' },
      { label: 'Update goal', value: 'goal' },
      { label: 'Cancel', value: 'cancel' },
    ], { defaultValue: 'create' });

    if (action === 'create') {
      if (!name.trim()) {
        console.log('Sprint name is required before creating.');
        continue;
      }
      return {
        aborted: false,
        name: name.trim(),
        start: formatDate(startDate),
        end: formatDate(endDate),
        goal: goal.trim() === '' ? undefined : goal.trim(),
        durationDays,
      };
    }

    if (action === 'cancel') {
      await uiOutro('Aborted');
      return { aborted: true, durationDays: 0 };
    }

    switch (action) {
      case 'name':
        name = (await uiText('Sprint name', {
          required: true,
          defaultValue: name,
          validate: (value) => (value.trim() === '' ? 'Sprint name is required.' : null),
        })).trim();
        break;
      case 'start':
        startDate = await promptStartDate(startDate);
        if (endDate.getTime() < startDate.getTime()) {
          endDate = addDays(startDate, 14);
        }
        break;
      case 'end':
        endDate = await promptEndDate(startDate, endDate);
        break;
      case 'goal':
        goal = (await uiText('Sprint goal (optional)', {
          defaultValue: goal,
          allowEmpty: true,
        })).trim();
        break;
    }
  }
}

function createSprint(
  config: ReturnType<typeof loadConfig>,
  name: string,
  startDate: string,
  endDate: string,
  goal?: string,
): SprintCreationResult {
  const sprintId = generateSprintId(config);
  ensureSprintStructure(config, sprintId);
  const trimmedGoal = goal?.trim() === '' ? undefined : goal?.trim();
  saveSprintMetadata(config, {
    id: sprintId,
    name,
    start_date: startDate,
    end_date: endDate,
    goal: trimmedGoal,
    generated_by: config.metadata.generator,
  });
  saveSprintScope(config, sprintId, emptyScope(config.metadata.generator));
  const dir = resolveSprintDir(config, sprintId);
  return {
    id: sprintId,
    dir,
    sprintFile: path.join(dir, 'sprint.yaml'),
    scopeFile: path.join(dir, 'scope.yaml'),
  };
}

async function renderSprintInteractiveOutro(
  creation: SprintCreationResult,
  details: { name: string; startDate: string; endDate: string; goal?: string; durationDays: number },
): Promise<void> {
  const summaryRows: string[][] = [
    [c.bold('Field'), c.bold('Value')],
    ['Sprint', c.id(creation.id)],
    ['Name', details.name],
    ['Window', `${formatDateDisplay(parseDate(details.startDate, '--start'))} → ${formatDateDisplay(parseDate(details.endDate, '--end'))}`],
    ['Duration', formatDuration(details.durationDays)],
  ];
  if (details.goal && details.goal.trim() !== '') {
    summaryRows.push(['Goal', details.goal.trim()]);
  }
  const relativeDir = path.relative(process.cwd(), creation.dir) || '.';
  summaryRows.push(['Directory', relativeDir]);
  summaryRows.push(['Sprint file', path.relative(process.cwd(), creation.sprintFile)]);
  summaryRows.push(['Scope file', path.relative(process.cwd(), creation.scopeFile)]);

  const nextCommands: string[][] = [
    [formatCommandLine(`cd ${relativeDir}`), 'Enter sprint directory'],
    [formatCommandLine(`houston sprint add ${creation.id} <ticket-id>`), 'Scope tickets into sprint'],
    [formatCommandLine(`houston backlog plan --sprint ${creation.id}`), 'Plan backlog into sprint'],
  ];

  const lines: string[] = [];
  lines.push(c.heading('Sprint created'));
  lines.push(...renderBoxTable(summaryRows));
  lines.push('');
  lines.push(c.subheading('Next steps'));
  lines.push(...renderBoxTable([[c.bold('Command'), c.bold('Purpose')], ...nextCommands]));
  await uiOutro(lines.join('\n'));
}

function safeParseDate(value: string | undefined, flag: string): Date | null {
  if (!value) return null;
  try {
    return parseDate(value, flag);
  } catch {
    return null;
  }
}

async function promptStartDate(initial: Date): Promise<Date> {
  const today = startOfToday();
  const nextMonday = nextWeekday(today, 1);
  const inSevenDays = addDays(today, 7);
  const choices = [
    { label: `${formatDateChoice(today)} (today)`, value: formatDate(today) },
    { label: `${formatDateChoice(nextMonday)} (next Monday)`, value: formatDate(nextMonday) },
    { label: `${formatDateChoice(inSevenDays)} (+1 week)`, value: formatDate(inSevenDays) },
  ];
  const defaultValue = formatDate(initial);
  while (true) {
    let selection = await uiSelect('Select sprint start date', choices, { defaultValue, allowCustom: true });
    if (selection === '__custom__') {
      selection = await uiText('Enter start date (YYYY-MM-DD)', {
        defaultValue,
        required: true,
        validate: validateIsoDate,
      });
    }
    if (!selection) continue;
    try {
      return parseDate(selection, '--start');
    } catch (error: any) {
      console.log(error.message ?? String(error));
    }
  }
}

async function promptEndDate(start: Date, initial: Date): Promise<Date> {
  const durations = [7, 10, 14, 21];
  const choices = durations.map((days) => {
    const candidate = addDays(start, days);
    return {
      label: `${formatDateChoice(candidate)} (${formatDuration(days)})`,
      value: formatDate(candidate),
    };
  });
  const defaultValue = formatDate(initial);
  while (true) {
    let selection = await uiSelect('Select sprint end date', choices, { defaultValue, allowCustom: true });
    if (selection === '__custom__') {
      selection = await uiText('Enter end date (YYYY-MM-DD)', {
        defaultValue,
        required: true,
        validate: (value) => validateEndDate(value, start),
      });
    }
    if (!selection) continue;
    try {
      const candidate = parseDate(selection, '--end');
      if (candidate.getTime() < start.getTime()) {
        console.log('End date must be on or after the start date.');
        continue;
      }
      return candidate;
    } catch (error: any) {
      console.log(error.message ?? String(error));
    }
  }
}

function validateIsoDate(value: string): string | null {
  try {
    parseDate(value, '--start');
    return null;
  } catch (error: any) {
    return error.message ?? 'Invalid date';
  }
}

function validateEndDate(value: string, start: Date): string | null {
  try {
    const date = parseDate(value, '--end');
    if (date.getTime() < start.getTime()) {
      return 'End date must be on or after the start date.';
    }
    return null;
  } catch (error: any) {
    return error.message ?? 'Invalid date';
  }
}

function nextWeekday(date: Date, weekday: number): Date {
  const day = date.getUTCDay();
  let offset = (weekday - day + 7) % 7;
  if (offset === 0) offset = 7;
  return addDays(date, offset);
}

function diffDays(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
}

function formatDateDisplay(date: Date): string {
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${weekday}, ${month} ${day} ${year}`;
}

function formatDateChoice(date: Date): string {
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${weekday} • ${month} ${day}`;
}

function formatDuration(days: number): string {
  const value = Math.max(0, days);
  return `${value} day${value === 1 ? '' : 's'}`;
}

function formatCommandLine(cmd: string): string {
  return `$ ${c.id(cmd)}`;
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
  const resolution = resolveTicketIds(config, ticketIds);
  for (const ticketId of resolution.ids) {
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
  console.log(
    c.ok(
      `Added ${resolution.ids.length} ticket(s) to ${c.id(sprintId)}: ${resolution.ids
        .map(shortenTicketId)
        .join(', ')}`,
    ),
  );
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
