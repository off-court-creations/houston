import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { getTicketTypeFromId } from '../lib/id.js';

export interface TicketPaths {
  dir: string;
  ticketFile: string;
  descriptionFile: string;
  historyFile: string;
}

const TYPE_DIR: Record<string, string> = {
  epic: 'EPIC',
  story: 'STORY',
  subtask: 'SUBTASK',
  bug: 'BUG',
};

export function resolveTicketPaths(config: CliConfig, ticketId: string): TicketPaths {
  const type = getTicketTypeFromId(ticketId);
  if (!type) {
    throw new Error(`Unrecognised ticket id ${ticketId}`);
  }
  const typeDir = TYPE_DIR[type];
  const dir = path.join(config.tracking.ticketsDir, typeDir, ticketId);
  return {
    dir,
    ticketFile: path.join(dir, 'ticket.yaml'),
    descriptionFile: path.join(dir, 'description.md'),
    historyFile: path.join(dir, 'history.ndjson'),
  };
}
