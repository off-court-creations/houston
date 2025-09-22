import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceCommand } from '../../src/commands/workspace.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-workspace-info-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.resetAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerWorkspaceCommand(program);
  return program;
}

describe('workspace info command', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('renders workspace details using bordered tables', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'workspace', 'info']);

    const output = spy.mock.calls.map((call) => String(call[0])).join('\n');
    const normalized = output.replace(/\u001B\[[0-9;]*m/g, '');

    expect(normalized).toMatch(/Workspace\s*\n\+/);
    expect(normalized).toMatch(/\| Resource\s+\|\s+Value\s+\|/);
    expect(normalized).toMatch(/\| Workspace root\s+\|/);
    expect(normalized).toMatch(/Summary\s*\n\+/);
    expect(normalized).toMatch(/\| Group\s+\|\s+Metric\s+\|\s+Value\s+\|/);
    expect(normalized).toMatch(/\| Type\s+\|\s+Epic\s+\|\s+\d+\s+\|/);
    expect(normalized).toMatch(/Sprints\s*\n\+/);
    expect(normalized).toMatch(/\| Sprint\s+\|\s+Label\s+\|\s+Status\s+\|\s+Scoped\s+\|/);
    expect(normalized).toMatch(/\| S-550e8400-e29b-41d4-a716-446655440000\s+\|/);

    spy.mockRestore();
  });

  it('supports json output', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'workspace', 'info', '--json']);

    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(payload.workspace.workspaceRoot).toBeDefined();
    expect(Array.isArray(payload.sprints.active)).toBe(true);
    spy.mockRestore();
  });
});
