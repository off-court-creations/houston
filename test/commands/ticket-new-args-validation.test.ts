import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerNewCommand } from '../../src/commands/new.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-new-args-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
  // add a second repo to repos.yaml for multi-repo test
  const reposFile = path.join(tempDir, 'repos', 'repos.yaml');
  const content = fs.readFileSync(reposFile, 'utf8');
  fs.writeFileSync(
    reposFile,
    content +
      `\n  - id: repo.api\n    provider: github\n    remote: git@github.com:acme/api.git\n    default_branch: main\n`,
    'utf8',
  );
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

describe('ticket new argument validation', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_ACTOR = 'user:test';
  });

  afterEach(() => {
    delete process.env.HOUSTON_ACTOR;
    teardownWorkspace();
  });

  it('errors when using non-keyed --branch with multiple repos', async () => {
    const program = buildProgram();
    await expect(
      program.parseAsync([
        'node',
        'houston',
        'new',
        'story',
        '--title',
        'Args Test',
        '--assignee',
        'user:alice',
        '--components',
        'checkout',
        '--repo',
        'repo.checkout',
        '--repo',
        'repo.api',
        '--branch',
        'feat/something',
      ]),
    ).rejects.toThrow(/--branch must be provided as repo:branch/);
  });
});

