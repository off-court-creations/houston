import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';
import { c } from '../lib/colors.js';

export function registerAssignCommand(program: Command): void {
  program
    .command('assign')
    .description('Assign a ticket to a user')
    .argument('<ticketId>')
    .argument('<userId>')
    .action(async (ticketId: string, userId: string) => {
      await handleAssign(ticketId, userId);
    })
    .addHelpText('after', `\nExamples:\n  $ houston ticket assign ST-123 user:alice\n`);
}

async function handleAssign(ticketId: string, userId: string): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const ticket = loadTicket(config, ticketId);
  const previous = ticket.assignee;
  ticket.assignee = userId;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'assign',
      from: previous,
      to: userId,
    },
  });
  console.log(`Updated assignee for ${c.id(ticketId)} -> ${c.value(userId)}`);
}
