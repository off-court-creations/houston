import { describe, expect, it } from 'vitest';
import { assertTicketIdMatchesType, generateTicketId, getTicketTypeFromId } from '../../src/lib/id.js';

describe('ticket id helpers', () => {
  it('generates ids with expected prefix', () => {
    const id = generateTicketId('story');
    expect(id.startsWith('ST-')).toBe(true);
  });

  it('derives type from id', () => {
    expect(getTicketTypeFromId('SB-123')).toBe('subtask');
    expect(getTicketTypeFromId('BG-123')).toBe('bug');
    expect(getTicketTypeFromId('UNKNOWN')).toBeUndefined();
  });

  it('asserts prefix match', () => {
    expect(() => assertTicketIdMatchesType('ST-123', 'story')).not.toThrow();
    expect(() => assertTicketIdMatchesType('SB-123', 'story')).toThrowError(/does not match/);
  });
});
