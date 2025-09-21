import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadBacklog, saveBacklog } from '../services/backlog-store.js';
import { loadTicket } from '../services/ticket-store.js';
import { loadConfig as loadCliConfig } from '../config/config.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { buildWorkspaceAnalytics, type TicketOverview, type WorkspaceAnalytics } from '../services/workspace-analytics.js';
import { printOutput, renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import { emptyScope, loadSprint, saveSprintScope, ensureSprintStructure } from '../services/sprint-store.js';
import { resolveTicketIds } from '../services/ticket-id-resolver.js';
import { shortenTicketId } from '../lib/id.js';
import {
  canPrompt as canInteractive,
  intro as uiIntro,
  outro as uiOutro,
  promptSelect as uiSelect,
  promptText as uiText,
  promptMultiSelect as uiMultiSelect,
  spinner as uiSpinner,
} from '../lib/interactive.js';

interface PlanOptions {
  assign?: string[];
  interactive?: boolean;
}

type AssignmentMap = Map<string, string[]>;

interface BacklogPlanResult {
  sprintUpdates: Array<{ sprintId: string; tickets: string[] }>;
  removedFromBacklog: string[];
  notInBacklog: string[];
  failed: Array<{ ticketId: string; reason: string }>;
}

function collectAssignments(value: string, previous: string[]): string[] {
  if (!value) return previous;
  return [...previous, value];
}

export function registerBacklogCommand(program: Command): void {
  const backlog = program
    .command('backlog')
    .description('Backlog management commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston backlog add ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n  $ houston backlog plan --assign S-2025-10-01_2025-10-14:ST-123 --assign S-2025-10-15_2025-10-29:SB-456,SB-789\n  $ houston backlog show\n`,
    );

  backlog
    .command('add')
    .description('Append tickets to backlog in order')
    .argument('<ticketIds...>')
    .action(async (ticketIds: string[]) => {
      await handleBacklogAdd(ticketIds);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston backlog add ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n`,
    );

  backlog
    .command('plan')
    .description('Move top backlog items into a sprint scope')
    .option('--assign <mapping>', 'assignment mapping, e.g. sprintId:ticket1,ticket2', collectAssignments, [])
    .option('-i, --interactive', 'run interactive planning wizard')
    .action(async (options: PlanOptions) => {
      await handleBacklogPlan(options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston backlog plan --assign S-2025-10-01_2025-10-14:ST-123 --assign S-2025-10-15_2025-10-29:SB-456,SB-789\n  $ houston backlog plan --interactive\n`,
    );

  backlog
    .command('show')
    .description('Show backlog and next sprint candidates')
    .option('-j, --json', 'output as JSON')
    .option('--include-missing', 'include missing ticket references')
    .action(async (options: { json?: boolean; includeMissing?: boolean }) => {
      await handleBacklogShow(options);
    })
    .addHelpText('after', `\nExamples:\n  $ houston backlog show\n  $ houston backlog show --json\n`);
}

async function handleBacklogAdd(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) {
    console.log('No tickets provided.');
    return;
  }
  const config = loadConfig();
  const backlog = loadBacklog(config);
  const resolution = resolveTicketIds(config, ticketIds);
  const canonicalIds = resolution.ids;
  const ordered = backlog.ordered ?? [];
  for (const id of canonicalIds) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  backlog.ordered = ordered;
  backlog.generated_by = config.metadata.generator;
  saveBacklog(config, backlog);
  console.log(
    c.ok(`Added ${canonicalIds.length} ticket(s) to backlog: ${canonicalIds.map(shortenTicketId).join(', ')}`),
  );
}

async function handleBacklogPlan(options: PlanOptions): Promise<void> {
  const assignments = options.assign ?? [];
  const shouldInteractive = Boolean(options.interactive) || assignments.length === 0;

  if (shouldInteractive) {
    await runBacklogPlanInteractive(assignments);
    return;
  }

  const config = loadConfig();
  const rawAssignments = parseAssignmentInputs(assignments);
  if (rawAssignments.size === 0) {
    console.log('No assignments provided.');
    return;
  }

  const canonicalAssignments = canonicalizeAssignments(config, rawAssignments);
  const result = applyBacklogAssignments(config, canonicalAssignments);
  printBacklogPlanResult(result);
}

function uniquePush(list: string[] | undefined, id: string): string[] {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(id)) {
    next.push(id);
  }
  return next;
}

function parseAssignmentInputs(inputs: string[]): AssignmentMap {
  const assignments: AssignmentMap = new Map();
  for (const raw of inputs) {
    const value = raw?.trim();
    if (!value) continue;
    const idx = value.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid assignment "${value}". Expected format sprintId:ticket1,ticket2.`);
    }
    const sprintId = value.slice(0, idx).trim();
    const ticketPart = value.slice(idx + 1).trim();
    if (!sprintId) {
      throw new Error(`Assignment "${value}" is missing a sprint identifier.`);
    }
    if (!ticketPart) {
      throw new Error(`Assignment "${value}" must include at least one ticket id.`);
    }
    const tickets = ticketPart
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    if (tickets.length === 0) {
      throw new Error(`Assignment "${value}" must include at least one ticket id.`);
    }
    const current = assignments.get(sprintId) ?? [];
    current.push(...tickets);
    assignments.set(sprintId, current);
  }
  return assignments;
}

function canonicalizeAssignments(config: ReturnType<typeof loadConfig>, raw: AssignmentMap): AssignmentMap {
  if (raw.size === 0) return raw;
  const flatTickets: string[] = [];
  const ticketOrder: Array<{ sprintId: string; index: number }> = [];
  for (const [sprintId, tickets] of raw) {
    tickets.forEach((_ticket, idx) => {
      ticketOrder.push({ sprintId, index: idx });
    });
    flatTickets.push(...tickets);
  }

  const { ids: canonicalIds } = resolveTicketIds(config, flatTickets);
  const assignedToSprint = new Map<string, string>();
  const canonicalAssignments: AssignmentMap = new Map();

  let pointer = 0;
  for (const [sprintId, tickets] of raw) {
    const canonicalList: string[] = [];
    for (let idx = 0; idx < tickets.length; idx += 1) {
      const canonicalId = canonicalIds[pointer];
      pointer += 1;
      const existing = assignedToSprint.get(canonicalId);
      if (existing && existing !== sprintId) {
        throw new Error(
          `Ticket ${canonicalId} is assigned to multiple sprints (${existing} and ${sprintId}).`,
        );
      }
      assignedToSprint.set(canonicalId, sprintId);
      if (!canonicalList.includes(canonicalId)) {
        canonicalList.push(canonicalId);
      }
    }
    canonicalAssignments.set(sprintId, canonicalList);
  }

  return canonicalAssignments;
}

function applyBacklogAssignments(config: ReturnType<typeof loadConfig>, assignments: AssignmentMap): BacklogPlanResult {
  const backlog = loadBacklog(config);
  const ordered = backlog.ordered ? [...backlog.ordered] : [];
  const backlogSet = new Set(ordered);

  const sprintUpdates: Array<{ sprintId: string; tickets: string[] }> = [];
  const removedFromBacklogSet = new Set<string>();
  const notInBacklogSet = new Set<string>();
  const failed: Array<{ ticketId: string; reason: string }> = [];

  const ticketCache = new Map<string, ReturnType<typeof loadTicket>>();

  const validAssignments: AssignmentMap = new Map();
  for (const [sprintId, tickets] of assignments) {
    const validTickets: string[] = [];
    for (const ticketId of tickets) {
      try {
        if (!ticketCache.has(ticketId)) {
          ticketCache.set(ticketId, loadTicket(config, ticketId));
        }
        validTickets.push(ticketId);
        if (backlogSet.has(ticketId)) {
          removedFromBacklogSet.add(ticketId);
        } else {
          notInBacklogSet.add(ticketId);
        }
      } catch (error) {
        failed.push({ ticketId, reason: (error as Error).message });
      }
    }
    if (validTickets.length > 0) {
      validAssignments.set(sprintId, validTickets);
    }
  }

  const removedFromBacklog = [...removedFromBacklogSet];
  if (removedFromBacklog.length > 0) {
    const removalSet = new Set(removedFromBacklog);
    backlog.ordered = ordered.filter((id) => !removalSet.has(id));
    backlog.generated_by = config.metadata.generator;
    saveBacklog(config, backlog);
  }

  for (const [sprintId, tickets] of validAssignments) {
    ensureSprintStructure(config, sprintId);
    const sprint = loadSprint(config, sprintId);
    const scope = sprint?.scope ?? emptyScope(config.metadata.generator);
    const added: string[] = [];
    for (const ticketId of tickets) {
      const ticket = ticketCache.get(ticketId);
      if (!ticket) continue;
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
        default:
          failed.push({ ticketId, reason: `Unsupported ticket type ${(ticket as any).type}` });
          continue;
      }
      added.push(ticketId);
    }
    saveSprintScope(config, sprintId, scope);
    sprintUpdates.push({ sprintId, tickets: added });
  }

  return {
    sprintUpdates,
    removedFromBacklog,
    notInBacklog: [...notInBacklogSet],
    failed,
  };
}

function printBacklogPlanResult(result: BacklogPlanResult): void {
  let totalAssigned = 0;
  for (const update of result.sprintUpdates) {
    if (update.tickets.length === 0) continue;
    totalAssigned += update.tickets.length;
    console.log(
      c.ok(
        `Planned ${update.tickets.length} ticket(s) into ${c.id(update.sprintId)}: ${update.tickets
          .map((ticket) => shortenTicketId(ticket))
          .join(', ')}`,
      ),
    );
  }

  if (totalAssigned === 0) {
    console.log('No tickets were planned into sprints.');
  }

  if (result.removedFromBacklog.length > 0) {
    console.log(
      `Removed ${result.removedFromBacklog.length} ticket(s) from backlog: ${result.removedFromBacklog
        .map((ticket) => shortenTicketId(ticket))
        .join(', ')}`,
    );
  }

  if (result.notInBacklog.length > 0) {
    console.log(
      c.warn(
        `Ticket(s) not present in backlog: ${result.notInBacklog
          .map((ticket) => shortenTicketId(ticket))
          .join(', ')}`,
      ),
    );
  }

  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.warn(`Skipped ${failure.ticketId}: ${failure.reason}`);
    }
  }
}

async function runBacklogPlanInteractive(seedAssignments: string[]): Promise<void> {
  await uiIntro('Plan Backlog');
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  const backlogTickets = analytics.backlog.tickets;

  if (backlogTickets.length === 0) {
    await uiOutro('Backlog is empty. Nothing to plan.');
    return;
  }

  const ticketMap = new Map<string, TicketOverview>();
  const backlogOrder: string[] = [];
  for (const ticket of backlogTickets) {
    ticketMap.set(ticket.id, ticket);
    backlogOrder.push(ticket.id);
  }

  const assignments = new Map<string, string[]>();
  const seedMap = parseAssignmentInputs(seedAssignments);
  for (const [sprintId, tickets] of seedMap) {
    assignments.set(sprintId, tickets.filter((ticketId) => ticketMap.has(ticketId)));
  }

  let remaining = backlogOrder.filter((id) => !isTicketAssigned(assignments, id));

  const sprintChoices = buildSprintChoices(analytics.sprints);

  while (true) {
    renderInteractiveSummary(assignments, ticketMap, remaining.length);

    const actions = [
      { label: 'Assign backlog tickets to a sprint', value: 'assign' },
      ...(assignments.size > 0 ? [{ label: 'Remove assigned tickets', value: 'remove' }] : []),
      ...(assignments.size > 0 ? [{ label: 'Apply assignments', value: 'apply' }] : []),
      { label: 'Cancel', value: 'cancel' },
    ];

    const action = await uiSelect('Select an action', actions, {
      defaultValue: assignments.size > 0 ? 'apply' : 'assign',
    });

    if (action === 'cancel') {
      await uiOutro('Aborted');
      return;
    }

    if (action === 'assign') {
      if (remaining.length === 0) {
        console.log('All backlog tickets have been assigned.');
        continue;
      }
      let sprint: string | undefined;
      if (sprintChoices.length === 0) {
        sprint = (await uiText('Enter sprint id', { required: true })).trim();
      } else {
        const sprintId = await uiSelect('Select sprint to plan into', sprintChoices, {
          allowCustom: true,
        });
        sprint = sprintId?.trim();
      }
      if (!sprint) {
        console.log('Sprint selection is required.');
        continue;
      }
      if (!sprintChoices.some((choice) => choice.value === sprint)) {
        sprintChoices.push({ label: sprint, value: sprint });
      }
      const ticketChoices = remaining.map((ticketId) => formatTicketChoiceLabel(ticketMap.get(ticketId)!));
      const choiceMap = new Map(ticketChoices.map((label, idx) => [label, remaining[idx]!]));
      const selected = await uiMultiSelect('Select backlog tickets to assign', ticketChoices, {
        required: true,
        allowEmpty: false,
      });
      if (selected.length === 0) {
        console.log('No tickets selected.');
        continue;
      }
      const chosenIds = selected
        .map((label) => choiceMap.get(label))
        .filter((value): value is string => Boolean(value));
      const existing = assignments.get(sprint) ?? [];
      const merged = [...existing, ...chosenIds.filter((id) => !existing.includes(id))];
      assignments.set(sprint, merged);
      remaining = backlogOrder.filter((id) => !isTicketAssigned(assignments, id));
      continue;
    }

    if (action === 'remove') {
      if (assignments.size === 0) {
        console.log('No assignments to remove.');
        continue;
      }
      const removal = buildRemovalChoices(assignments, ticketMap);
      const toRemove = await uiMultiSelect('Select assignments to remove', removal.choices, {
        required: true,
        allowEmpty: false,
      });
      if (toRemove.length === 0) continue;
      for (const label of toRemove) {
        const payload = removal.mapping.get(label);
        if (!payload) continue;
        const { sprintId, ticketId } = payload;
        const tickets = assignments.get(sprintId);
        if (!tickets) continue;
        const filtered = tickets.filter((id) => id !== ticketId);
        if (filtered.length === 0) {
          assignments.delete(sprintId);
        } else {
          assignments.set(sprintId, filtered);
        }
      }
      remaining = backlogOrder.filter((id) => !isTicketAssigned(assignments, id));
      continue;
    }

    if (action === 'apply') {
      if (assignments.size === 0) {
        console.log('No assignments to apply yet.');
        continue;
      }
      const spinner = uiSpinner();
      await spinner.start('Applying assignments...');
      try {
        const canonical = canonicalizeAssignments(config, assignments);
        const result = applyBacklogAssignments(config, canonical);
        spinner.stop('Backlog updated');
        await uiOutro(renderInteractiveResult(result, ticketMap));
      } catch (error) {
        spinner.stopWithError('Failed to apply assignments');
        throw error;
      }
      return;
    }
  }
}

function isTicketAssigned(assignments: AssignmentMap, ticketId: string): boolean {
  for (const tickets of assignments.values()) {
    if (tickets.includes(ticketId)) return true;
  }
  return false;
}

function buildSprintChoices(sprints: WorkspaceAnalytics['sprints']): Array<{ label: string; value: string }> {
  if (!sprints || sprints.length === 0) {
    return [];
  }
  return sprints.map((sprint) => {
    const labelParts = [sprint.id];
    if (sprint.name) labelParts.push(`— ${sprint.name}`);
    if (sprint.status) labelParts.push(`(${sprint.status})`);
    return { label: labelParts.join(' '), value: sprint.id };
  });
}

function formatTicketChoiceLabel(ticket: TicketOverview): string {
  const summary = ticket.summary ?? ticket.title ?? '';
  const status = ticket.status ? ` [${ticket.status}]` : '';
  return `${shortenTicketId(ticket.id)} — ${summary}${status} (${ticket.id})`;
}

function buildRemovalChoices(
  assignments: AssignmentMap,
  ticketMap: Map<string, TicketOverview>,
): { choices: string[]; mapping: Map<string, { sprintId: string; ticketId: string }> } {
  const choices: string[] = [];
  const mapping = new Map<string, { sprintId: string; ticketId: string }>();
  for (const [sprintId, tickets] of assignments) {
    for (const ticketId of tickets) {
      const ticket = ticketMap.get(ticketId);
      const display = ticket ? `${shortenTicketId(ticketId)} — ${ticket.summary ?? ticket.title ?? ''}` : ticketId;
      const label = `${display} → ${sprintId}`;
      choices.push(label);
      mapping.set(label, { sprintId, ticketId });
    }
  }
  return { choices, mapping };
}

function renderInteractiveSummary(
  assignments: AssignmentMap,
  ticketMap: Map<string, TicketOverview>,
  remainingCount: number,
): void {
  console.log('');
  const summaryRows: string[][] = [[c.bold('Sprint'), c.bold('Tickets')]];
  if (assignments.size === 0) {
    summaryRows.push(['(none)', '']);
  } else {
    for (const [sprintId, tickets] of assignments) {
      const tokens = tickets.map((id) => {
        const ticket = ticketMap.get(id);
        const label = ticket?.summary ?? ticket?.title ?? id;
        return `${shortenTicketId(id)} — ${label}`;
      });
      summaryRows.push([sprintId, tokens.join('\n') || '(none)']);
    }
  }
  for (const line of renderBoxTable(summaryRows)) console.log(line);
  console.log('');
  console.log(`Remaining backlog tickets: ${remainingCount}`);
  console.log('');
}

function renderInteractiveResult(result: BacklogPlanResult, ticketMap: Map<string, TicketOverview>): string {
  const lines: string[] = [];
  const summaryRows: string[][] = [[c.bold('Sprint'), c.bold('Tickets planned')]];
  for (const update of result.sprintUpdates) {
    const entries = update.tickets.map((id) => {
      const ticket = ticketMap.get(id);
      const label = ticket?.summary ?? ticket?.title ?? id;
      return `${shortenTicketId(id)} — ${label}`;
    });
    summaryRows.push([update.sprintId, entries.length > 0 ? entries.join('\n') : '(none)']);
  }
  lines.push(c.heading('Backlog planning summary'));
  lines.push(...renderBoxTable(summaryRows));
  lines.push('');
  if (result.removedFromBacklog.length > 0) {
    lines.push(
      `Removed from backlog: ${result.removedFromBacklog
        .map((ticketId) => shortenTicketId(ticketId))
        .join(', ')}`,
    );
  }
  if (result.notInBacklog.length > 0) {
    lines.push(
      c.warn(
        `Not in backlog: ${result.notInBacklog
          .map((ticketId) => shortenTicketId(ticketId))
          .join(', ')}`,
      ),
    );
  }
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      lines.push(c.warn(`Skipped ${failure.ticketId}: ${failure.reason}`));
    }
  }
  return lines.join('\n');
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
  return `${shortenTicketId(ticket.id)} ${status} ${assignee} ${summary}`.replace(/\s+/g, ' ').trim();
}
