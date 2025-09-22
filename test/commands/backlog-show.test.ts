import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBacklogCommand } from '../../src/commands/backlog.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

describe('backlog show command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-backlog-show-'));
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
    registerBacklogCommand(program);
    return program;
  }

  it('shows backlog and next sprint candidates in JSON', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'backlog', 'show', '--json']);

    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload).toHaveProperty('backlog');
    expect(payload).toHaveProperty('nextSprint');
    expect(Array.isArray(payload.backlog.ticketIds)).toBe(true);
    expect(Array.isArray(payload.nextSprint.ticketIds)).toBe(true);
    expect(payload.backlog.ticketIds).toContain('ST-22222222-2222-2222-2222-222222222222');
    expect(payload.nextSprint.ticketIds).toContain('ST-22222222-2222-2222-2222-222222222222');
    spy.mockRestore();
  });
});

