import { randomUUID } from 'node:crypto';

export type TicketType = 'epic' | 'story' | 'subtask' | 'bug';
export type TicketIdPrefix = 'EPIC' | 'ST' | 'SB' | 'BG';

const PREFIX_BY_TYPE: Record<TicketType, TicketIdPrefix> = {
  epic: 'EPIC',
  story: 'ST',
  subtask: 'SB',
  bug: 'BG',
};

const TYPE_BY_PREFIX: Record<TicketIdPrefix, TicketType> = {
  EPIC: 'epic',
  ST: 'story',
  SB: 'subtask',
  BG: 'bug',
};

const CANONICAL_TICKET_ID_REGEX =
  /^(EPIC|ST|SB|BG)-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;

type ParsedTicketId = {
  prefix: TicketIdPrefix;
  uuidSegments: [string, string, string, string, string];
};

function parseTicketId(id: string): ParsedTicketId | undefined {
  const match = CANONICAL_TICKET_ID_REGEX.exec(id);
  if (!match) return undefined;
  const [, prefix, a, b, c, d, e] = match;
  if (!prefix) return undefined;
  return {
    prefix: prefix as TicketIdPrefix,
    uuidSegments: [a, b, c, d, e],
  };
}

export function generateTicketId(type: TicketType): string {
  return `${PREFIX_BY_TYPE[type]}-${randomUUID()}`;
}

export function assertTicketIdMatchesType(id: string, type: TicketType): void {
  const parsed = parseTicketId(id);
  if (!parsed) {
    throw new Error(`Ticket id ${id} is not a canonical ticket id`);
  }

  const expectedPrefix = PREFIX_BY_TYPE[type];
  if (parsed.prefix !== expectedPrefix) {
    throw new Error(
      `Ticket id ${id} does not match expected prefix ${expectedPrefix} for type ${type}`,
    );
  }
}

export function getTicketTypeFromId(id: string): TicketType | undefined {
  const parsed = parseTicketId(id);
  if (!parsed) return undefined;
  return TYPE_BY_PREFIX[parsed.prefix];
}

export function isTicketId(id: string): boolean {
  return parseTicketId(id) !== undefined;
}

export function shortenTicketId(id: string): string {
  const parsed = parseTicketId(id);
  if (!parsed) {
    throw new Error(`Ticket id ${id} is not a canonical ticket id`);
  }

  return `${parsed.prefix}-${parsed.uuidSegments[0]}`;
}
