import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSprintCommand } from '../../src/commands/sprint.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');
const FIXTURE_SPRINT_ID = 'S-550e8400-e29b-41d4-a716-446655440000';

let tempDir: string;
const originalCwd = process.cwd;

describe('sprint list command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-sprint-list-'));
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
    registerSprintCommand(program);
    return program;
  }

  it('lists sprints in JSON', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'sprint', 'list', '--json']);

    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(typeof payload.count).toBe('number');
    expect(Array.isArray(payload.sprints)).toBe(true);
    const ids = payload.sprints.map((s: any) => s.id);
    expect(ids).toContain(FIXTURE_SPRINT_ID);
    spy.mockRestore();
  });

  it('filters by status', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Fixture sprint window is in the past relative to now; expect completed
    await program.parseAsync(['node', 'houston', 'sprint', 'list', '--json', '--status', 'completed']);

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    const ids = payload.sprints.map((s: any) => s.id);
    expect(ids).toContain(FIXTURE_SPRINT_ID);
    expect(payload.sprints.find((s: any) => s.id === FIXTURE_SPRINT_ID)?.status).toBe('completed');
    spy.mockRestore();
  });
});

