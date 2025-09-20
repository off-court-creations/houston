import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { loadTicket, saveTicket } from '../services/ticket-store.js';
import { resolveActor } from '../utils/runtime.js';
import { c } from '../lib/colors.js';

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
      `\nExamples:\n  $ stardate ticket link --child ST-123 --parent EP-9\n  $ stardate ticket link --child SUB-77 --parent ST-123\n`,
    );
}

async function handleLink(options: LinkOptions): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const ticket = loadTicket(config, options.child);
  const previous = ticket.parent_id ?? null;
  ticket.parent_id = options.parent;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'link',
      from: previous,
      to: options.parent,
    },
  });
  console.log(`Linked ${c.id(options.child)} -> ${c.id(options.parent)}`);
}
