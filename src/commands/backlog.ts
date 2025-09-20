import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadBacklog, saveBacklog } from '../services/backlog-store.js';
import { loadTicket } from '../services/ticket-store.js';
import { emptyScope, loadSprint, saveSprintScope, ensureSprintStructure } from '../services/sprint-store.js';

interface PlanOptions {
  sprint: string;
  take?: number;
}

export function registerBacklogCommand(program: Command): void {
  const backlog = program
    .command('backlog')
    .description('Backlog management commands');

  backlog
    .command('add')
    .description('Append tickets to backlog in order')
    .argument('<ticketIds...>')
    .action(async (ticketIds: string[]) => {
      await handleBacklogAdd(ticketIds);
    });

  backlog
    .command('plan')
    .description('Move top backlog items into a sprint scope')
    .requiredOption('--sprint <id>', 'sprint identifier')
    .option('--take <count>', 'number of tickets to plan', (value) => Number.parseInt(value, 10))
    .action(async (options: PlanOptions) => {
      await handleBacklogPlan(options);
    });
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
  console.log(`Added ${ticketIds.length} ticket(s) to backlog`);
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
  console.log(`Planned ${selection.length} ticket(s) into ${options.sprint}`);
}

function uniquePush(list: string[] | undefined, id: string): string[] {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(id)) {
    next.push(id);
  }
  return next;
}
