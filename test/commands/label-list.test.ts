import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerLabelCommand } from '../../src/commands/label.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

describe('label list command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-label-list-'));
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
    registerLabelCommand(program);
    return program;
  }

  it('outputs configured labels as JSON', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'label', 'list', '--json']);

    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(Array.isArray(payload)).toBe(true);
    // From fixtures: frontend, backend, initiative
    expect(payload).toEqual(['frontend', 'backend', 'initiative']);
    spy.mockRestore();
  });
});

