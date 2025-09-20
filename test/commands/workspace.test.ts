import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerWorkspaceCommand } from '../../src/commands/workspace.js';
import { registerRepoCommand } from '../../src/commands/repo.js';
import { registerTicketCommand } from '../../src/commands/ticket.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-workspace-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function buildProgram(): Command {
  const program = new Command();
  registerWorkspaceCommand(program);
  registerRepoCommand(program);
  registerTicketCommand(program);
  return program;
}

function captureConsole(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map((value) => String(value)).join(' '));
  });
  return {
    logs,
    restore: () => spy.mockRestore(),
  };
}

describe('workspace command suite', () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('emits a summary snapshot as JSON', async () => {
    const program = buildProgram();
    const logCapture = captureConsole();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync(['node', 'houston', 'workspace', 'info', '--json']);
    cwdSpy.mockRestore();
    logCapture.restore();
    const output = logCapture.logs.join('\n');
    const payload = JSON.parse(output) as {
      summary: { totalTickets: number };
      backlog: { ticketIds: string[] };
    };
    expect(payload.summary.totalTickets).toBe(2);
    expect(payload.backlog.ticketIds).toContain('ST-1234567890AB');
  });

  it('filters tickets by type', async () => {
    const program = buildProgram();
    const logCapture = captureConsole();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync(['node', 'houston', 'ticket', 'list', '--json', '--type', 'story']);
    cwdSpy.mockRestore();
    logCapture.restore();
    const payload = JSON.parse(logCapture.logs.join('\n')) as { tickets: Array<{ id: string; type: string }> };
    expect(payload.tickets).toHaveLength(1);
    expect(payload.tickets[0]?.type).toBe('story');
  });

  it('lists repository usage', async () => {
    const program = buildProgram();
    const logCapture = captureConsole();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync(['node', 'houston', 'repo', 'list', '--json']);
    cwdSpy.mockRestore();
    logCapture.restore();
    const payload = JSON.parse(logCapture.logs.join('\n')) as { repos: Array<{ id: string; ticketIds: string[] }> };
    expect(payload.repos[0]?.id).toBe('repo.checkout');
    expect(payload.repos[0]?.ticketIds).toContain('ST-1234567890AB');
  });

  it('creates a new workspace skeleton', async () => {
    const program = buildProgram();
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-create-'));
    const targetDir = path.join(baseDir, 'new-workspace');
    const logCapture = captureConsole();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(baseDir);
    await program.parseAsync(['node', 'houston', 'workspace', 'new', 'new-workspace', '--no-git']);
    cwdSpy.mockRestore();
    logCapture.restore();
    const configPath = path.join(targetDir, 'houston.config.yaml');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = YAML.parse(fs.readFileSync(configPath, 'utf8')) as { tracking?: { schemaDir?: string } };
    expect(config?.tracking?.schemaDir).toBe('schema');
    expect(fs.existsSync(path.join(targetDir, 'tickets', 'EPIC'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'transitions.yaml'))).toBe(true);
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
});
