import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerLabelCommand } from '../../src/commands/label.js';

vi.mock('../../src/lib/prompter.js', () => ({
  promptInput: vi.fn(),
}));

const { promptInput } = await import('../../src/lib/prompter.js');
const promptInputMock = promptInput as vi.MockedFunction<typeof promptInput>;

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-label-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  promptInputMock.mockReset();
  vi.restoreAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerLabelCommand(program);
  return program;
}

describe('label command', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    teardownWorkspace();
    delete process.env.HOUSTON_FORCE_INTERACTIVE;
  });

  it('adds multiple labels from comma separated inputs', async () => {
    const program = buildProgram();
    const labelsFile = path.join(tempDir, 'taxonomies', 'labels.yaml');

    await program.parseAsync([
      'node',
      'houston',
      'label',
      'add',
      '--id',
      'growth marketing, design ops',
      '--labels',
      'ml ops,platform',
    ]);

    const parsed = YAML.parse(fs.readFileSync(labelsFile, 'utf8')) as { labels: string[] };
    expect(parsed.labels).toEqual(expect.arrayContaining(['growth marketing', 'design ops', 'ml ops', 'platform']));
  });

  it('prompts for multiple labels per entry and loops when confirmed', async () => {
    process.env.HOUSTON_FORCE_INTERACTIVE = '1';
    const program = buildProgram();
    const labelsFile = path.join(tempDir, 'taxonomies', 'labels.yaml');

    const interactive = await import('../../src/lib/interactive.js');
    const promptConfirmMock = vi
      .spyOn(interactive, 'promptConfirm')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.spyOn(interactive, 'canPrompt').mockReturnValue(true);

    const inputs = ['growth marketing, design ops', 'ml ops'];
    promptInputMock.mockImplementation(async () => inputs.shift() ?? '');

    await program.parseAsync(['node', 'houston', 'label', 'add', '--interactive']);

    const parsed = YAML.parse(fs.readFileSync(labelsFile, 'utf8')) as { labels: string[] };
    expect(parsed.labels).toEqual(expect.arrayContaining(['growth marketing', 'design ops', 'ml ops']));
    expect(promptConfirmMock).toHaveBeenCalledTimes(2);
    expect(promptInputMock).toHaveBeenCalledTimes(2);
  });
});
