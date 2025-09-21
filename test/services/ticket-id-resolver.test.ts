import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, type CliConfig } from '../../src/config/config.js';
import { resolveTicketId, resolveTicketIds } from '../../src/services/ticket-id-resolver.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/workspace');
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';

function makeConfig(): CliConfig {
  const base = loadConfig({ cwd: FIXTURE_ROOT });
  return base;
}

describe('ticket id resolver', () => {
  it('returns canonical ids unchanged', () => {
    const config = makeConfig();
    const result = resolveTicketId(config, STORY_ID);
    expect(result.id).toBe(STORY_ID);
  });

  it('expands short ids when resolvable', () => {
    const config = makeConfig();
    const result = resolveTicketId(config, 'ST-22222222');
    expect(result.id).toBe(STORY_ID);
  });

  it('resolves multiple ids with shared inventory cache', () => {
    const config = makeConfig();
    const values = resolveTicketIds(config, [STORY_ID, 'ST-22222222']);
    expect(values.ids).toEqual([STORY_ID, STORY_ID]);
  });

  it('rejects invalid ids', () => {
    const config = makeConfig();
    expect(() => resolveTicketId(config, 'ST-INVALID')).toThrowError(/canonical/);
  });
});
