import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerNewCommand } from '../../src/commands/new.js';
import { registerAssignCommand } from '../../src/commands/assign.js';
import { registerStatusCommand } from '../../src/commands/status.js';
import { registerBacklogCommand } from '../../src/commands/backlog.js';
import { registerSprintCommand } from '../../src/commands/sprint.js';
import { registerCodeCommand } from '../../src/commands/code.js';
import { registerBugCommand } from '../../src/commands/bug.js';
import { registerLabelCommand } from '../../src/commands/label.js';
import { registerLinkCommand } from '../../src/commands/link.js';
import { registerDescribeCommand } from '../../src/commands/describe.js';
import { registerCheckCommand } from '../../src/commands/check.js';
import { registerConfigCommand } from '../../src/commands/config.js';
import { registerVersionCommand } from '../../src/commands/version.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-cli-phase4-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
  process.env.HOUSTON_ACTOR = 'user:test';
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function buildProgram(): Command {
  const program = new Command();
  registerVersionCommand(program, '0.1.0-test');
  registerConfigCommand(program);
  registerCheckCommand(program);
  registerNewCommand(program);
  registerAssignCommand(program);
  registerStatusCommand(program);
  registerLabelCommand(program);
  registerLinkCommand(program);
  registerBugCommand(program);
  registerBacklogCommand(program);
  registerSprintCommand(program);
  registerCodeCommand(program);
  registerDescribeCommand(program);
  return program;
}

describe('CLI Phase 4 commands', () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('creates a new story and updates backlog', async () => {
    const program = buildProgram();
    const storyDir = path.join(tempDir, 'tickets', 'STORY');
    const before = new Set(fs.readdirSync(storyDir));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync([
      'node',
      'houston',
      'new',
      'story',
      '--title',
      'Phase 4 Story',
      '--assignee',
      'user:alice',
      '--components',
      'checkout',
      '--labels',
      'frontend',
      '--priority',
      'P1',
      '--due-date',
      '2024-03-01',
    ]);
    cwdSpy.mockRestore();
    const after = new Set(fs.readdirSync(storyDir));
    const created = [...after].find((item) => !before.has(item));
    expect(created).toBeTruthy();
    const ticketYaml = fs.readFileSync(path.join(storyDir, created!, 'ticket.yaml'), 'utf8');
    const ticket = YAML.parse(ticketYaml);
    expect(ticket.title).toBe('Phase 4 Story');
    expect(ticket.assignee).toBe('user:alice');
    expect(ticket.code.branch_strategy).toBe('per-story');
    const backlogYaml = YAML.parse(fs.readFileSync(path.join(tempDir, 'backlog', 'backlog.yaml'), 'utf8'));
    expect(backlogYaml.ordered).toContain(created);
  });

  it('updates assignment and status, records branch metadata', async () => {
    const program = buildProgram();
    // Use existing fixture story
    const ticketId = 'ST-1234567890AB';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync(['node', 'houston', 'assign', ticketId, 'user:cara']);
    await program.parseAsync(['node', 'houston', 'status', ticketId, 'In Review']);
    await program.parseAsync([
      'node',
      'houston',
      'code',
      'start',
      ticketId,
      '--repo',
      'repo.checkout',
    ]);
    cwdSpy.mockRestore();
    const ticket = YAML.parse(fs.readFileSync(path.join(tempDir, 'tickets', 'STORY', ticketId, 'ticket.yaml'), 'utf8'));
    expect(ticket.assignee).toBe('user:cara');
    expect(ticket.status).toBe('In Review');
    expect(ticket.code.repos?.[0]?.repo_id).toBe('repo.checkout');
  });

  it('plans backlog items into sprint scope', async () => {
    const program = buildProgram();
    const backlogBefore = YAML.parse(fs.readFileSync(path.join(tempDir, 'backlog', 'backlog.yaml'), 'utf8'));
    expect(backlogBefore.ordered?.length).toBeGreaterThan(0);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    await program.parseAsync([
      'node',
      'houston',
      'backlog',
      'plan',
      '--sprint',
      'S-2024-01-01_2024-01-14',
      '--take',
      '1',
    ]);
    cwdSpy.mockRestore();
    const backlogAfter = YAML.parse(fs.readFileSync(path.join(tempDir, 'backlog', 'backlog.yaml'), 'utf8'));
    expect(backlogAfter.ordered?.length).toBe((backlogBefore.ordered?.length ?? 0) - 1);
    const scope = YAML.parse(fs.readFileSync(path.join(tempDir, 'sprints', 'S-2024-01-01_2024-01-14', 'scope.yaml'), 'utf8'));
    expect(scope.stories?.length ?? 0).toBeGreaterThan(0);
  });
});
