import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerNewCommand } from '../../src/commands/new.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-new-code-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
}

function buildProgram(): Command {
  const program = new Command();
  registerNewCommand(program);
  return program;
}

describe('ticket new with repo linking flags', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_ACTOR = 'user:test';
  });

  afterEach(() => {
    delete process.env.HOUSTON_ACTOR;
    teardownWorkspace();
  });

  it('creates a story and links repo with path and branch', async () => {
    const program = buildProgram();
    const storyDir = path.join(tempDir, 'tickets', 'STORY');
    const before = fs.existsSync(storyDir) ? new Set(fs.readdirSync(storyDir)) : new Set<string>();

    await program.parseAsync([
      'node',
      'houston',
      'new',
      'story',
      '--title',
      'CLI Linked Story',
      '--summary',
      'Summary',
      '--assignee',
      'user:alice',
      '--components',
      'checkout',
      '--labels',
      'frontend',
      '--repo',
      'repo.checkout',
      '--create-branch',
      '--path',
      'repo.checkout:packages/checkout',
    ]);

    const entries = fs.existsSync(storyDir) ? fs.readdirSync(storyDir) : [];
    const created = entries.find((e) => !before.has(e));
    expect(created).toBeDefined();
    const ticketFile = path.join(storyDir, created!, 'ticket.yaml');
    const ticket = YAML.parse(fs.readFileSync(ticketFile, 'utf8')) as any;
    expect(ticket.code?.repos?.length).toBe(1);
    const link = ticket.code.repos[0];
    expect(link.repo_id).toBe('repo.checkout');
    expect(typeof link.branch).toBe('string');
    // schema-compliant branch prefix for story
    expect(link.branch.startsWith('feat/')).toBe(true);
    expect(link.path).toBe('packages/checkout');
  });
});

