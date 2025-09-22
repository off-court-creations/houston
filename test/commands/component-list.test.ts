import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerComponentCommand } from '../../src/commands/component.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

describe('component list command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-component-list-'));
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
    registerComponentCommand(program);
    return program;
  }

  it('outputs configured components as JSON', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'component', 'list', '--json']);

    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(Array.isArray(payload)).toBe(true);
    // From fixtures: checkout, payments, accounts, notifications
    expect(payload).toEqual(['checkout', 'payments', 'accounts', 'notifications']);
    spy.mockRestore();
  });
});

