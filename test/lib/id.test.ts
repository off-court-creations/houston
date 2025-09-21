import { describe, expect, it } from 'vitest';
import {
  assertTicketIdMatchesType,
  generateTicketId,
  getTicketTypeFromId,
  isTicketId,
  shortenTicketId,
} from '../../src/lib/id.js';

describe('ticket id helpers', () => {
  it('generates ids with expected prefix', () => {
    const id = generateTicketId('story');
    expect(id).toMatch(/^ST-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('derives type from id', () => {
    const epicId = generateTicketId('epic');
    expect(getTicketTypeFromId(epicId)).toBe('epic');
    expect(getTicketTypeFromId('ST-1234567890')).toBeUndefined();
    expect(getTicketTypeFromId('UNKNOWN')).toBeUndefined();
  });

  it('asserts prefix match', () => {
    const storyId = generateTicketId('story');
    expect(() => assertTicketIdMatchesType(storyId, 'story')).not.toThrow();
    expect(() => assertTicketIdMatchesType('SB-123', 'story')).toThrowError(/canonical ticket id/);
    expect(() => assertTicketIdMatchesType('ST-123', 'story')).toThrowError(/canonical ticket id/);
  });

  it('shortens ticket ids to prefix plus first uuid block', () => {
    const sample = 'ST-22222222-2222-2222-2222-222222222222';
    expect(shortenTicketId(sample)).toBe('ST-22222222');
    expect(() => shortenTicketId('ST-123')).toThrowError(/canonical ticket id/);
  });

  it('detects canonical ticket formats', () => {
    const ticketId = generateTicketId('bug');
    expect(isTicketId(ticketId)).toBe(true);
    expect(isTicketId('BG-1234567890')).toBe(false);
  });
});
