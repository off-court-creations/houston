import fs from 'node:fs';
import type { CliConfig } from '../config/config.js';
import { ensureSignature } from '../lib/signature.js';
import { writeYamlFile, readYamlFile } from '../lib/yaml.js';
import { appendHistoryEvent, type HistoryEvent } from '../lib/history.js';
import { recordChange } from './mutation-tracker.js';
import { getTicketTypeFromId } from '../lib/id.js';
import { resolveTicketPaths } from './path-resolver.js';

export interface TicketRecord extends Record<string, unknown> {
  id: string;
  type: 'epic' | 'story' | 'subtask' | 'bug';
  version: number;
  created_at: string;
  updated_at: string;
  generated_by?: string;
}

export type HistoryEventInput = Omit<HistoryEvent, 'actor' | 'ts'> & Partial<Pick<HistoryEvent, 'actor' | 'ts'>>;

export interface SaveTicketOptions {
  actor: string;
  history?: HistoryEventInput | HistoryEventInput[];
  incrementVersion?: boolean;
}

export function loadTicket(config: CliConfig, ticketId: string): TicketRecord {
  const paths = resolveTicketPaths(config, ticketId);
  if (!fs.existsSync(paths.ticketFile)) {
    throw new Error(`Ticket ${ticketId} not found`);
  }
  return readYamlFile<TicketRecord>(paths.ticketFile);
}

export function createTicket(
  config: CliConfig,
  ticket: TicketRecord,
  historyEvents: HistoryEventInput[],
): TicketRecord {
  const paths = resolveTicketPaths(config, ticket.id);
  fs.mkdirSync(paths.dir, { recursive: true });
  if (!fs.existsSync(paths.descriptionFile)) {
    fs.writeFileSync(
      paths.descriptionFile,
      `# ${ticket.title}

Provide details for ${ticket.id}.
`,
      'utf8',
    );
  }
  ensureTicketSignature(config, ticket);
  writeYamlFile(paths.ticketFile, ticket);
  for (const event of historyEvents) {
    if (!event.actor) {
      throw new Error('History event for ticket creation must include actor');
    }
    appendHistoryEvent(paths.historyFile, event as HistoryEvent);
  }
  recordChange('tickets');
  return ticket;
}

export function saveTicket(
  config: CliConfig,
  ticket: TicketRecord,
  { actor, history, incrementVersion = true }: SaveTicketOptions,
): TicketRecord {
  const paths = resolveTicketPaths(config, ticket.id);
  if (!fs.existsSync(paths.ticketFile)) {
    throw new Error(`Ticket ${ticket.id} not found`);
  }
  const current = readYamlFile<TicketRecord>(paths.ticketFile);
  const now = new Date().toISOString();
  ticket.created_at = current.created_at;
  ticket.updated_at = now;
  ticket.version = incrementVersion ? (current.version ?? 0) + 1 : current.version ?? 1;
  ensureTicketSignature(config, ticket);
  writeYamlFile(paths.ticketFile, ticket);
  const events = Array.isArray(history) ? history : history ? [history] : [];
  for (const event of events) {
    const actorToUse = event.actor ?? actor;
    appendHistoryEvent(paths.historyFile, { ...event, actor: actorToUse } as HistoryEvent);
  }
  recordChange('tickets');
  return ticket;
}

export function ensureTicketSignature(config: CliConfig, ticket: TicketRecord): void {
  Object.assign(ticket, ensureSignature(ticket, config.metadata.generator));
}

export function resolveTicketTypeFromId(ticketId: string): TicketRecord['type'] {
  const type = getTicketTypeFromId(ticketId);
  if (!type) {
    throw new Error(`Unable to infer ticket type from ${ticketId}`);
  }
  return type;
}

export function ticketDirectoryNameForType(type: TicketRecord['type']): string {
  switch (type) {
    case 'epic':
      return 'EPIC';
    case 'story':
      return 'STORY';
    case 'subtask':
      return 'SUBTASK';
    case 'bug':
      return 'BUG';
    default:
      throw new Error(`Unhandled ticket type ${type}`);
  }
}

export function nextVersion(current?: number): number {
  return (current ?? 0) + 1;
}
