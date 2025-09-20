import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';
import { c } from '../lib/colors.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Update ticket status')
    .argument('<ticketId>')
    .argument('<status>')
    .action(async (ticketId: string, status: string) => {
      await handleStatus(ticketId, status);
    })
    .addHelpText('after', `\nExamples:\n  $ houston ticket status ST-123 "In Review"\n`);
}

async function handleStatus(ticketId: string, status: string): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const ticket = loadTicket(config, ticketId);
  const previous = ticket.status;
  ticket.status = status;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'status',
      from: previous,
      to: status,
    },
  });
  console.log(`Updated status for ${c.id(ticketId)} -> ${c.status(status)}`);
}
