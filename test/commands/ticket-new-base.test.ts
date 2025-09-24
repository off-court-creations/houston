import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNewCommand } from '../../src/commands/new.js';

vi.mock('../../src/providers/index.js', () => {
  const calls: { branch?: string; base?: string }[] = [];
  const provider = {
    ensureBranch: vi.fn(async ({ branch, base }: { branch: string; base?: string }) => {
      calls.push({ branch, base });
    }),
    branchExists: vi.fn(async () => true),
  };
  return {
    createProvider: () => provider,
    __calls: calls,
  } as any;
});

const { __calls } = await import('../../src/providers/index.js' as any);

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-new-base-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.resetModules();
}

function buildProgram(): Command {
  const program = new Command();
  registerNewCommand(program);
  return program;
}

describe('base branch inheritance', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_ACTOR = 'user:test';
  });

  afterEach(() => {
    delete process.env.HOUSTON_ACTOR;
    teardownWorkspace();
  });

  it('inherits base from parent story branch when creating subtask', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'houston',
      'new',
      'subtask',
      '--title',
      'Child Task',
      '--summary',
      'Child',
      '--assignee',
      'user:alice',
      '--components',
      'checkout',
      '--parent',
      STORY_ID,
      '--story-points',
      '2',
      '--repo',
      'repo.checkout',
      '--create-branch',
    ]);

    const last = __calls[__calls.length - 1];
    expect(last).toBeDefined();
    // From fixtures: story branch is feat/ST-22222222-2222-2222-2222-222222222222--fixture
    expect(last.base).toBe('feat/ST-22222222-2222-2222-2222-222222222222--fixture');
  });
});

