import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUserCommand } from '../../src/commands/user.js';

vi.mock('../../src/lib/prompter.js', () => ({
  promptInput: vi.fn(),
  promptMultiSelect: vi.fn(),
  promptSelect: vi.fn(),
}));

const { promptSelect } = await import('../../src/lib/prompter.js');
const promptSelectMock = promptSelect as vi.MockedFunction<typeof promptSelect>;

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-user-info-'));
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

describe('user info command', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_FORCE_INTERACTIVE = '1';
  });

  afterEach(() => {
    delete process.env.HOUSTON_FORCE_INTERACTIVE;
    teardownWorkspace();
  });

  it('prints user info in json when id provided', async () => {
    const program = buildProgram();

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['node', 'houston', 'user', 'info', '--id', 'user:alice', '--json']);
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('user:alice');
    spy.mockRestore();
  });

  it('prompts to select a user when id omitted', async () => {
    const program = buildProgram();
    promptSelectMock.mockResolvedValueOnce('user:alice');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'user', 'info']);

    expect(promptSelectMock).toHaveBeenCalled();
    const choices = promptSelectMock.mock.calls[0]?.[1];
    const labels = Array.isArray(choices) ? choices.map((choice: any) => choice.label) : [];
    expect(labels.some((label) => typeof label === 'string' && label.includes('alice@example.com'))).toBe(false);
    const output = spy.mock.calls.map((call) => String(call[0])).join('\n');
    const normalized = output.replace(/\u001B\[[0-9;]*m/g, '');
    expect(normalized).toContain('user:alice — Alice Dev');
    expect(normalized).toContain('| Email | alice@example.com |');
    expect(normalized).toMatch(/\| Roles \| engineer\s*\|/);
    spy.mockRestore();
  });
});
