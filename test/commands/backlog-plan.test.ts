import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

vi.mock('../../src/lib/interactive.js', () => {
  const intro = vi.fn();
  const outro = vi.fn();
  const promptSelect = vi.fn();
  const promptText = vi.fn();
  const promptMultiSelect = vi.fn();
  const spinner = vi.fn(() => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(() => {}),
    stopWithError: vi.fn(() => {}),
  }));
  return {
    canPrompt: vi.fn().mockReturnValue(true),
    intro,
    outro,
    promptSelect,
    promptText,
    promptMultiSelect,
    spinner,
  };
});

const interactive = await import('../../src/lib/interactive.js');
const _introMock = interactive.intro as vi.MockedFunction<typeof interactive.intro>;
const outroMock = interactive.outro as vi.MockedFunction<typeof interactive.outro>;
const promptSelectMock = interactive.promptSelect as vi.MockedFunction<typeof interactive.promptSelect>;
const _promptTextMock = interactive.promptText as vi.MockedFunction<typeof interactive.promptText>;
const promptMultiSelectMock = interactive.promptMultiSelect as vi.MockedFunction<typeof interactive.promptMultiSelect>;
const spinnerFactoryMock = interactive.spinner as vi.MockedFunction<typeof interactive.spinner>;

const { registerBacklogCommand } = await import('../../src/commands/backlog.js');

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');
const SPRINT_ONE = 'S-123e4567-e89b-42d3-a456-426614174000';
const SPRINT_TWO = 'S-550e8400-e29b-41d4-a716-446655440000';

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-backlog-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.clearAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerBacklogCommand(program);
  return program;
}

describe('backlog plan command', () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('assigns tickets to multiple sprints via CLI options', async () => {
    const program = buildProgram();
    const backlogFile = path.join(tempDir, 'backlog', 'backlog.yaml');
    const backlogData = {
      ordered: [
        'ST-22222222-2222-2222-2222-222222222222',
        'EPIC-11111111-1111-1111-1111-111111111111',
      ],
      generated_by: 'houston@test',
    };
    fs.writeFileSync(backlogFile, YAML.stringify(backlogData), 'utf8');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    await program.parseAsync([
      'node',
      'houston',
      'backlog',
      'plan',
      '--assign',
      `${SPRINT_ONE}:ST-22222222-2222-2222-2222-222222222222`,
      '--assign',
      `${SPRINT_TWO}:EPIC-11111111-1111-1111-1111-111111111111`,
    ]);

    cwdSpy.mockRestore();
    consoleSpy.mockRestore();

    const updatedBacklog = YAML.parse(fs.readFileSync(backlogFile, 'utf8')) as { ordered: string[] };
    expect(updatedBacklog.ordered).toEqual([]);

    const firstSprintScope = YAML.parse(
      fs.readFileSync(
        path.join(tempDir, 'sprints', SPRINT_ONE, 'scope.yaml'),
        'utf8',
      ),
    ) as { stories: string[] };
    expect(firstSprintScope.stories).toContain('ST-22222222-2222-2222-2222-222222222222');

    const secondSprintScope = YAML.parse(
      fs.readFileSync(
        path.join(tempDir, 'sprints', SPRINT_TWO, 'scope.yaml'),
        'utf8',
      ),
    ) as { epics: string[] };
    expect(secondSprintScope.epics).toContain('EPIC-11111111-1111-1111-1111-111111111111');
  });

  it('provides interactive planning when no assignments are passed', async () => {
    const program = buildProgram();
    const backlogFile = path.join(tempDir, 'backlog', 'backlog.yaml');
    fs.writeFileSync(
      backlogFile,
      YAML.stringify({
        ordered: [
          'ST-22222222-2222-2222-2222-222222222222',
          'EPIC-11111111-1111-1111-1111-111111111111',
        ],
      }),
      'utf8',
    );

    process.cwd = () => tempDir;

    promptSelectMock
      .mockResolvedValueOnce('assign')
      .mockResolvedValueOnce(SPRINT_TWO)
      .mockResolvedValueOnce('apply');

    promptMultiSelectMock.mockImplementationOnce(async (_question, choices: string[]) => choices.slice(0, 2));

    await program.parseAsync(['node', 'houston', 'backlog', 'plan']);

    const spinnerInstance = spinnerFactoryMock.mock.results[0]?.value as {
      start: vi.Mock;
      stop: vi.Mock;
    } | undefined;
    expect(spinnerInstance?.start).toHaveBeenCalledWith('Applying assignments...');
    expect(spinnerInstance?.stop).toHaveBeenCalledWith('Backlog updated');
    expect(outroMock).toHaveBeenCalled();

    const backlog = YAML.parse(fs.readFileSync(backlogFile, 'utf8')) as { ordered: string[] };
    expect(backlog.ordered).toEqual([]);

    const sprintScope = YAML.parse(
      fs.readFileSync(
        path.join(tempDir, 'sprints', SPRINT_TWO, 'scope.yaml'),
        'utf8',
      ),
    ) as { stories: string[]; epics: string[] };
    expect(sprintScope.stories).toContain('ST-22222222-2222-2222-2222-222222222222');
    expect(sprintScope.epics).toContain('EPIC-11111111-1111-1111-1111-111111111111');
  });
});
