import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerRepoCommand } from '../../src/commands/repo.js';

vi.mock('../../src/lib/interactive.js', () => ({
  canPrompt: vi.fn(),
  promptSelect: vi.fn(),
  promptText: vi.fn(),
  promptConfirm: vi.fn(),
  promptMultiSelect: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const { canPrompt, promptSelect, promptText, promptConfirm, promptMultiSelect } = await import('../../src/lib/interactive.js');
const canPromptMock = canPrompt as vi.MockedFunction<typeof canPrompt>;
const promptSelectMock = promptSelect as vi.MockedFunction<typeof promptSelect>;
const promptTextMock = promptText as vi.MockedFunction<typeof promptText>;
const promptConfirmMock = promptConfirm as vi.MockedFunction<typeof promptConfirm>;
const promptMultiSelectMock = promptMultiSelect as vi.MockedFunction<typeof promptMultiSelect>;

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

describe('repo command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-repo-'));
    fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
    process.cwd = () => tempDir;
    canPromptMock.mockReturnValue(true);
    promptSelectMock.mockReset();
    promptTextMock.mockReset();
    promptConfirmMock.mockReset();
    promptMultiSelectMock.mockReset();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('suggests repo.<dirname> when detecting from path', async () => {
    const repoRoot = path.resolve(tempDir, '../valet');
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });

    const child = await import('node:child_process');
    const spawnSpy = (child.spawnSync as vi.Mock).mockImplementation((cmd: string, args: readonly string[]) => {
      if (args.includes('--is-inside-work-tree')) {
        return { status: 0, stdout: 'true\n', stderr: '' } as any;
      }
      if (args.includes('remote') && args.includes('-v')) {
        return {
          status: 0,
          stdout: 'origin\tgit@github.com:archway/valet.git (fetch)\norigin\tgit@github.com:archway/valet.git (push)\n',
          stderr: '',
        } as any;
      }
      if (args.includes('symbolic-ref')) {
        return { status: 0, stdout: 'origin/main\n', stderr: '' } as any;
      }
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'main\n', stderr: '' } as any;
      }
      return { status: 0, stdout: '', stderr: '' } as any;
    });

    const selectQueue = ['path', 'github'];
    promptSelectMock.mockImplementation(async () => selectQueue.shift() ?? 'github');
    promptMultiSelectMock.mockResolvedValue([]);
    promptConfirmMock.mockImplementation(async (_question, defaultValue) => defaultValue);

    promptTextMock.mockImplementation(async (question: string, options?: any) => {
      if (question.startsWith('Local repository path')) {
        return '../valet';
      }
      if (question.startsWith('Repository id')) {
        expect(options?.defaultValue).toBe('repo.valet');
        return options?.defaultValue ?? 'repo.valet';
      }
      if (question.startsWith('Remote')) {
        return options?.defaultValue ?? 'git@github.com:archway/valet.git';
      }
      if (question.startsWith('Default branch')) {
        return options?.defaultValue ?? 'main';
      }
      if (question.startsWith('Branch prefix')) {
        return options?.defaultValue ?? 'prefix';
      }
      if (question.startsWith('PR base branch')) {
        return '';
      }
      return options?.defaultValue ?? '';
    });

    const program = new Command();
    registerRepoCommand(program);

    await program.parseAsync(['node', 'houston', 'repo', 'add', '--interactive']);

    const reposFile = path.join(tempDir, 'repos', 'repos.yaml');
    const data = YAML.parse(fs.readFileSync(reposFile, 'utf8')) as { repos: Array<{ id: string }> };
    expect(data.repos.map((repo) => repo.id)).toContain('repo.valet');

    spawnSpy.mockReset();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });
});
