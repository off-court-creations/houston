import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTicketCommand } from '../../src/commands/ticket.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';
const EPIC_ID = 'EPIC-11111111-1111-1111-1111-111111111111';

let tempDir: string;
const originalCwd = process.cwd;

describe('ticket list command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-ticket-list-'));
    fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  function buildProgram(): Command {
    const program = new Command();
    registerTicketCommand(program);
    return program;
  }

  it('lists tickets as JSON', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(typeof payload.count).toBe('number');
    expect(payload.count).toBeGreaterThanOrEqual(2);
    const ids = payload.tickets.map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining([STORY_ID, EPIC_ID]));
    spy.mockRestore();
  });

  it('filters by type and label', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--type', 'story', '--label', 'frontend']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.tickets[0].id).toBe(STORY_ID);
    spy.mockRestore();
  });

  it('filters by repo', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--repo', 'repo.checkout']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.tickets[0].id).toBe(STORY_ID);
    spy.mockRestore();
  });

  it('filters by component', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Only story has payments component
    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--component', 'payments']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    expect(payload.tickets[0].id).toBe(STORY_ID);

    // Both tickets have checkout component
    spy.mockClear();
    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--component', 'checkout']);
    const payload2 = JSON.parse(String(spy.mock.calls[0]?.[0]));
    const ids2 = payload2.tickets.map((t: any) => t.id);
    expect(ids2).toEqual(expect.arrayContaining([STORY_ID, EPIC_ID]));
    spy.mockRestore();
  });

  it('supports sort and limit', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--sort', 'id', '--limit', '1']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.count).toBe(1);
    // With sort=id, EPIC should sort before ST*
    expect(payload.tickets[0].id.startsWith('EPIC-')).toBe(true);
    spy.mockRestore();
  });
});

