import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';
import { c } from '../lib/colors.js';
import { resolveTicketId } from '../services/ticket-id-resolver.js';
import { shortenTicketId } from '../lib/id.js';

interface LinkOptions {
  child: string;
  parent: string;
}

export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('Link a child ticket to a parent epic/story')
    .requiredOption('--child <ticketId>', 'child ticket (story or subtask)')
    .requiredOption('--parent <ticketId>', 'parent ticket (epic or story)')
    .action(async (options: LinkOptions) => {
      await handleLink(options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston ticket link --child ST-550e8400-e29b-41d4-a716-446655440000 --parent EPIC-11111111-1111-1111-1111-111111111111\n  $ houston ticket link --child SB-33333333-3333-3333-3333-333333333333 --parent ST-550e8400-e29b-41d4-a716-446655440000\n`,
    );
}

async function handleLink(options: LinkOptions): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const childResolution = resolveTicketId(config, options.child);
  const parentResolution = resolveTicketId(config, options.parent, {
    inventory: childResolution.inventory,
  });
  const ticket = loadTicket(config, childResolution.id);
  const previous = ticket.parent_id ?? null;
  ticket.parent_id = parentResolution.id;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'link',
      from: previous,
      to: parentResolution.id,
    },
  });
  console.log(
    `Linked ${c.id(shortenTicketId(childResolution.id))} -> ${c.id(shortenTicketId(parentResolution.id))}`,
  );
}
