import { ulid } from 'ulid';

export type TicketType = 'epic' | 'story' | 'subtask' | 'bug';
export type TicketIdPrefix = 'EPIC' | 'ST' | 'SB' | 'BG';

const PREFIX_BY_TYPE: Record<TicketType, TicketIdPrefix> = {
  epic: 'EPIC',
  story: 'ST',
  subtask: 'SB',
  bug: 'BG',
};

export function generateTicketId(type: TicketType): string {
  return `${PREFIX_BY_TYPE[type]}-${ulid()}`;
}

export function assertTicketIdMatchesType(id: string, type: TicketType): void {
  const prefix = PREFIX_BY_TYPE[type];
  if (!id.startsWith(`${prefix}-`)) {
    throw new Error(`Ticket id ${id} does not match expected prefix ${prefix} for type ${type}`);
  }
}

export function getTicketTypeFromId(id: string): TicketType | undefined {
  if (id.startsWith('EPIC-')) return 'epic';
  if (id.startsWith('ST-')) return 'story';
  if (id.startsWith('SB-')) return 'subtask';
  if (id.startsWith('BG-')) return 'bug';
  return undefined;
}
