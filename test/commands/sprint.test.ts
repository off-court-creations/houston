import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerSprintCommand } from '../../src/commands/sprint.js';

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
});
