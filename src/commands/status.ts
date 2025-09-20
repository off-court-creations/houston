import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Update ticket status')
    .argument('<ticketId>')
    .argument('<status>')
    .action(async (ticketId: string, status: string) => {
      await handleStatus(ticketId, status);
    });
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
  console.log(`Updated status for ${ticketId} -> ${status}`);
}
