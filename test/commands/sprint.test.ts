import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerSprintCommand } from '../../src/commands/sprint.js';

vi.mock('../../src/lib/prompter.js', () => ({
  promptInput: vi.fn(),
  promptSelect: vi.fn(),
  promptMultiSelect: vi.fn(),
}));

const { promptInput, promptSelect, promptMultiSelect } = await import('../../src/lib/prompter.js');
const promptInputMock = promptInput as vi.MockedFunction<typeof promptInput>;
const promptSelectMock = promptSelect as vi.MockedFunction<typeof promptSelect>;
const promptMultiSelectMock = promptMultiSelect as vi.MockedFunction<typeof promptMultiSelect>;

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-sprint-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function buildProgram(): Command {
  const program = new Command();
  registerSprintCommand(program);
  return program;
}

describe('sprint command', () => {
  beforeEach(() => {
    setupWorkspace();
  });

afterEach(() => {
  vi.useRealTimers();
  promptInputMock.mockReset();
  promptSelectMock.mockReset();
  promptMultiSelectMock.mockReset();
  delete process.env.HOUSTON_FORCE_INTERACTIVE;
  teardownWorkspace();
});

  it('defaults start to today and end to two weeks later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));

    const program = buildProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const sprintsRoot = path.join(tempDir, 'sprints');
    const before = new Set(fs.readdirSync(sprintsRoot));
    await program.parseAsync(['node', 'houston', 'sprint', 'new', '--name', 'Auto Sprint']);
    cwdSpy.mockRestore();

    const createdId = fs
      .readdirSync(sprintsRoot)
      .find((entry) => !before.has(entry));
    expect(createdId).toBeDefined();
    expect(createdId).toMatch(/^S-2024-06-01_2024-06-15--auto-sprint-[a-f0-9]{6}$/);
    const sprintDir = path.join(sprintsRoot, createdId!);
    const sprintYaml = YAML.parse(fs.readFileSync(path.join(sprintDir, 'sprint.yaml'), 'utf8'));
    expect(sprintYaml.start_date).toBe('2024-06-01');
    expect(sprintYaml.end_date).toBe('2024-06-15');
  });

  it('derives end date when only start is supplied', async () => {
    const program = buildProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const sprintsRoot = path.join(tempDir, 'sprints');
    const before = new Set(fs.readdirSync(sprintsRoot));
    await program.parseAsync([
      'node',
      'houston',
      'sprint',
      'new',
      '--start',
      '2024-07-08',
      '--name',
      'Custom Start',
    ]);
    cwdSpy.mockRestore();

    const createdId = fs
      .readdirSync(sprintsRoot)
      .find((entry) => !before.has(entry));
    expect(createdId).toBeDefined();
    expect(createdId).toMatch(/^S-2024-07-08_2024-07-22--custom-start-[a-f0-9]{6}$/);
    const sprintDir = path.join(sprintsRoot, createdId!);
    const sprintYaml = YAML.parse(fs.readFileSync(path.join(sprintDir, 'sprint.yaml'), 'utf8'));
    expect(sprintYaml.start_date).toBe('2024-07-08');
    expect(sprintYaml.end_date).toBe('2024-07-22');
  });

  it('guides sprint creation interactively when no args are supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-03T12:00:00Z'));

    const program = buildProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    process.env.HOUSTON_FORCE_INTERACTIVE = '1';

    const sprintsRoot = path.join(tempDir, 'sprints');
    const before = new Set(fs.readdirSync(sprintsRoot));

    promptInputMock
      .mockResolvedValueOnce('Sprint 42') // name
      .mockResolvedValueOnce('2024-06-10') // custom start
      .mockResolvedValueOnce('Ship checkout v2'); // goal

    promptSelectMock
      .mockResolvedValueOnce('__custom__') // choose custom start
      .mockResolvedValueOnce('2024-06-24') // end date option
      .mockResolvedValueOnce('create'); // confirm creation

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'houston', 'sprint', 'new']);

    const output = consoleSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');

    consoleSpy.mockRestore();
    cwdSpy.mockRestore();

    const createdId = fs
      .readdirSync(sprintsRoot)
      .find((entry) => !before.has(entry));
    expect(createdId).toBeDefined();
    expect(createdId).toMatch(/^S-2024-06-10_2024-06-24--sprint-42-[a-f0-9]{6}$/);

    const sprintDir = path.join(sprintsRoot, createdId!);
    const sprintYaml = YAML.parse(fs.readFileSync(path.join(sprintDir, 'sprint.yaml'), 'utf8'));
    expect(sprintYaml.start_date).toBe('2024-06-10');
    expect(sprintYaml.end_date).toBe('2024-06-24');
    expect(sprintYaml.goal).toBe('Ship checkout v2');

    expect(output).toContain('Sprint created');
    expect(output).toContain('houston sprint add');
  });
});
