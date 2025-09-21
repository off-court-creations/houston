import { collectWorkspaceInventory, type WorkspaceInventory } from './workspace-inventory.js';
import type { CliConfig } from '../config/config.js';
import { isTicketId, shortenTicketId } from '../lib/id.js';

const SHORT_TICKET_ID_REGEX = /^(EPIC|ST|SB|BG)-([0-9a-f]{8})$/;

export interface TicketIdResolverOptions {
  allowShort?: boolean;
  inventory?: WorkspaceInventory;
}

export interface TicketIdResolutionResult {
  id: string;
  inventory?: WorkspaceInventory;
}

export function resolveTicketId(
  config: CliConfig,
  input: string,
  options: TicketIdResolverOptions = {},
): TicketIdResolutionResult {
  const trimmed = input?.trim();
  if (!trimmed) {
    throw new Error('Ticket id is required');
  }

  if (isTicketId(trimmed)) {
    return { id: trimmed, inventory: options.inventory };
  }

  const allowShort = options.allowShort !== false;
  if (allowShort && SHORT_TICKET_ID_REGEX.test(trimmed)) {
    const inventory = options.inventory ?? collectWorkspaceInventory(config);
    const matches = inventory.tickets.filter((ticket) => shortenTicketId(ticket.id) === trimmed);
    if (matches.length === 1) {
      return { id: matches[0].id, inventory };
    }
    if (matches.length === 0) {
      throw new Error(`No ticket found matching short id ${trimmed}`);
    }
    throw new Error(`Short ticket id ${trimmed} is ambiguous; please use the full canonical id.`);
  }

  throw new Error('Ticket id must be in canonical PREFIX-uuid format.');
}

export function resolveTicketIds(
  config: CliConfig,
  inputs: string[],
  options: TicketIdResolverOptions = {},
): { ids: string[]; inventory?: WorkspaceInventory } {
  let inventory = options.inventory;
  const ids = inputs.map((input) => {
    const result = resolveTicketId(config, input, { ...options, inventory });
    inventory = result.inventory ?? inventory;
    return result.id;
  });
  return { ids, inventory };
}
