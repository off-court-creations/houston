import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerUserCommand } from '../../src/commands/user.js';

vi.mock('../../src/lib/prompter.js', () => ({
  promptInput: vi.fn(),
  promptMultiSelect: vi.fn(),
}));

const { promptInput, promptMultiSelect } = await import('../../src/lib/prompter.js');
const promptInputMock = promptInput as vi.MockedFunction<typeof promptInput>;
const promptMultiSelectMock = promptMultiSelect as vi.MockedFunction<typeof promptMultiSelect>;

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-user-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.resetAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerUserCommand(program);
  return program;
}

describe('user command', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_FORCE_INTERACTIVE = '1';
  });

  afterEach(() => {
    delete process.env.HOUSTON_FORCE_INTERACTIVE;
    teardownWorkspace();
  });

  it('adds a user with flags', async () => {
    const program = buildProgram();
    const usersFile = path.join(tempDir, 'people', 'users.yaml');

    await program.parseAsync([
      'node',
      'houston',
      'user',
      'add',
      '--id',
      'user:newton',
      '--name',
      'Isaac Newton',
      '--email',
      'isaac@example.com',
      '--roles',
      'scientist,founder',
    ]);

    const users = YAML.parse(fs.readFileSync(usersFile, 'utf8')) as { users: Array<{ id: string }> };
    expect(users.users.find((entry) => entry.id === 'user:newton')).toBeDefined();
  });

  it('prompts for user details when missing flags', async () => {
    const program = buildProgram();
    const usersFile = path.join(tempDir, 'people', 'users.yaml');

    promptInputMock.mockImplementation(async (question) => {
      if (question.startsWith('User id')) return 'user:interactive';
      if (question.startsWith('Display name')) return 'Interactive User';
      if (question.startsWith('Email')) return 'interactive@example.com';
      if (question.startsWith('Provide email')) return '';
      return '';
    });

    promptMultiSelectMock.mockImplementation(async () => ['developer']);

    await program.parseAsync(['node', 'houston', 'user', 'add', '--interactive']);

    const users = YAML.parse(fs.readFileSync(usersFile, 'utf8')) as { users: Array<{ id: string; name?: string }> };
    const entry = users.users.find((person) => person.id === 'user:interactive');
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('Interactive User');
    expect(entry?.roles).toContain('developer');
  });
});
