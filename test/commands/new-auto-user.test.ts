import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { registerNewCommand } from '../../src/commands/new.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardate-new-flags-'));
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

describe('new command auto people sync', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.STARDATE_ACTOR = 'user:test';
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('adds new assignee to people/users.yaml', async () => {
    const program = buildProgram();
    const usersFile = path.join(tempDir, 'people', 'users.yaml');
    const before = YAML.parse(fs.readFileSync(usersFile, 'utf8')) as { users: Array<{ id: string }> };
    expect(before.users.some((user) => user.id === 'user:new-person')).toBe(false);

    await program.parseAsync([
      'node',
      'stardate',
      'new',
      'epic',
      '--title',
      'CLI Generated Epic',
      '--summary',
      'Test epic',
      '--assignee',
      'user:new-person',
      '--components',
      'checkout',
    ]);

    const after = YAML.parse(fs.readFileSync(usersFile, 'utf8')) as { users: Array<{ id: string; name?: string }> };
    const entry = after.users.find((user) => user.id === 'user:new-person');
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('New Person');
  });
});
