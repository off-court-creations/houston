import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';

export function registerBugCommand(program: Command): void {
  const bug = program
    .command('bug')
    .description('Bug-specific utilities');

  bug
    .command('log-time')
    .description('Append a time tracking entry to a bug ticket')
    .argument('<ticketId>')
    .argument('<minutes>')
    .argument('[note...]')
    .action(async (ticketId: string, minutes: string, noteParts: string[]) => {
      await handleLogTime(ticketId, Number.parseInt(minutes, 10), noteParts.join(' '));
    });
}

async function handleLogTime(ticketId: string, minutes: number, note: string): Promise<void> {
  if (Number.isNaN(minutes) || minutes <= 0) {
    throw new Error('Minutes must be a positive integer');
  }
  const config = loadConfig();
  const actor = resolveActor();
  const ticket = loadTicket(config, ticketId);
  if (ticket.type !== 'bug') {
    throw new Error('Time tracking is only supported on bug tickets');
  }
  const date = new Date().toISOString().slice(0, 10);
  const entries = Array.isArray(ticket.time_tracking) ? (ticket.time_tracking as Record<string, unknown>[]) : [];
  entries.push({ date, by: actor, minutes, note });
  ticket.time_tracking = entries;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'bug.time',
      minutes,
      note,
      date,
    },
  });
  console.log(`Logged ${minutes}m on ${ticketId} for ${actor}`);
}
