import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';

export function registerLabelCommand(program: Command): void {
  program
    .command('label')
    .description('Add or remove labels on a ticket (use +label or -label)')
    .argument('<ticketId>')
    .argument('<mutations...>')
    .action(async (ticketId: string, mutations: string[]) => {
      await handleLabel(ticketId, mutations);
    });
}

async function handleLabel(ticketId: string, mutations: string[]): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const ticket = loadTicket(config, ticketId);
  const original = new Set<string>(Array.isArray(ticket.labels) ? (ticket.labels as string[]) : []);
  let changed = false;
  for (const mutation of mutations) {
    if (mutation.startsWith('+')) {
      const label = mutation.slice(1);
      if (label) {
        changed = true;
        original.add(label);
      }
    } else if (mutation.startsWith('-')) {
      const label = mutation.slice(1);
      if (label && original.delete(label)) {
        changed = true;
      }
    }
  }
  if (!changed) {
    console.log('No label changes applied.');
    return;
  }
  const updated = Array.from(original);
  if (updated.length === 0) {
    delete (ticket as Record<string, unknown>).labels;
  } else {
    ticket.labels = updated;
  }
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'label',
      to: Array.from(original),
    },
  });
  console.log(`Updated labels for ${ticketId}`);
}
