import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerNewCommand } from '../../src/commands/new.js';

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
const EPIC_ID = 'EPIC-11111111-1111-1111-1111-111111111111';
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-new-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.resetAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerNewCommand(program);
  return program;
}

describe('new command interactive mode', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
    process.env.HOUSTON_ACTOR = 'user:test';
    process.env.HOUSTON_FORCE_INTERACTIVE = '1';
  });

  afterEach(() => {
    delete process.env.HOUSTON_FORCE_INTERACTIVE;
    teardownWorkspace();
  });

  it('creates an epic via interactive prompts', async () => {
    const program = buildProgram();
    const epicDir = path.join(tempDir, 'tickets', 'EPIC');
    const backlogFile = path.join(tempDir, 'backlog', 'backlog.yaml');
    const before = new Set(fs.readdirSync(epicDir));

    promptInputMock.mockImplementation(async (question) => {
      if (question.startsWith('Title')) return 'Interactive Epic';
      if (question.startsWith('Summary')) return 'Epic Summary';
      if (question.startsWith('Due date')) return '';
      return '';
    });

    promptSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Assignee')) return 'user:alice';
      if (question.startsWith('Priority')) return undefined;
      return undefined;
    });

    promptMultiSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Components')) return ['checkout'];
      if (question.startsWith('Labels')) return ['initiative'];
      if (question.startsWith('Approvers')) return [];
      if (question.startsWith('Associate repos')) return [];
      return [];
    });

    await program.parseAsync(['node', 'houston', 'new', 'epic']);

    const created = fs.readdirSync(epicDir).find((entry) => !before.has(entry));
    expect(created).toBeDefined();
    const ticket = YAML.parse(fs.readFileSync(path.join(epicDir, created!, 'ticket.yaml'), 'utf8'));
    expect(ticket.title).toBe('Interactive Epic');
    expect(ticket.labels).toEqual(['initiative']);
    expect(ticket.components).toEqual(['checkout']);

    const backlog = YAML.parse(fs.readFileSync(backlogFile, 'utf8'));
    expect(backlog.ordered).toContain(ticket.id);
  });

  it('registers a new component when provided interactively', async () => {
    const program = buildProgram();
    const componentsFile = path.join(tempDir, 'taxonomies', 'components.yaml');
    const beforeComponents = YAML.parse(fs.readFileSync(componentsFile, 'utf8')) as { components: string[] };

    promptInputMock.mockImplementation(async (question) => {
      if (question.startsWith('Title')) return 'Component Epic';
      if (question.startsWith('Summary')) return 'Component Summary';
      if (question.startsWith('Due date')) return '';
      if (question.startsWith('Assignee display name')) return 'New Person';
      if (question.startsWith('Assignee email')) return 'new@people.dev';
      if (question.startsWith('Component id')) return 'New Component';
      return '';
    });

    promptSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Assignee')) return 'user:new-person';
      if (question.startsWith('Priority')) return undefined;
      return undefined;
    });

    promptMultiSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Components')) return ['New Component'];
      if (question.startsWith('Associate repos')) return ['repo.checkout'];
      if (question.startsWith('Labels')) return [];
      if (question.startsWith('Approvers')) return [];
      return [];
    });

    await program.parseAsync(['node', 'houston', 'new', 'epic', '--interactive']);

    const afterComponents = YAML.parse(fs.readFileSync(componentsFile, 'utf8')) as { components: string[] };
    expect(afterComponents.components).toContain('new-component');
    expect(afterComponents.components.length).toBeGreaterThanOrEqual(beforeComponents.components.length);
  });

  it('creates a story linked to an epic interactively', async () => {
    const program = buildProgram();
    const storyDir = path.join(tempDir, 'tickets', 'STORY');
    const backlogFile = path.join(tempDir, 'backlog', 'backlog.yaml');
    const before = new Set(fs.readdirSync(storyDir));

    promptInputMock.mockImplementation(async (question) => {
      if (question.startsWith('Title')) return 'Interactive Story';
      if (question.startsWith('Summary')) return 'Story Summary';
      if (question.startsWith('Due date')) return '';
      return '';
    });

    promptSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Assignee')) return 'user:alice';
      if (question.startsWith('Priority')) return undefined;
      if (question.startsWith('Select parent epic')) return EPIC_ID;
      return undefined;
    });

    promptMultiSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Components')) return ['checkout'];
      if (question.startsWith('Labels')) return ['frontend'];
      if (question.startsWith('Approvers')) return [];
      if (question.startsWith('Associate repos')) return [];
      return [];
    });

    await program.parseAsync(['node', 'houston', 'new', 'story']);

    const created = fs.readdirSync(storyDir).find((entry) => !before.has(entry));
    expect(created).toBeDefined();
    const ticket = YAML.parse(fs.readFileSync(path.join(storyDir, created!, 'ticket.yaml'), 'utf8'));
    expect(ticket.parent_id).toBe(EPIC_ID);
    expect(ticket.labels).toContain('frontend');

    const backlog = YAML.parse(fs.readFileSync(backlogFile, 'utf8'));
    expect(backlog.ordered).toContain(ticket.id);
  });

  it('creates a subtask interactively and links to story', async () => {
    const program = buildProgram();
    const subtaskDir = path.join(tempDir, 'tickets', 'SUBTASK');
    const before = fs.existsSync(subtaskDir) ? new Set(fs.readdirSync(subtaskDir)) : new Set<string>();

    promptInputMock.mockImplementation(async (question) => {
      if (question.startsWith('Title')) return 'Interactive Subtask';
      if (question.startsWith('Summary')) return 'Subtask Summary';
      if (question.startsWith('Due date')) return '';
      if (question.startsWith('Story points')) return '3';
      return '';
    });

    promptSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Assignee')) return 'user:alice';
      if (question.startsWith('Priority')) return 'P2';
      if (question.startsWith('Select parent story')) return STORY_ID;
      return undefined;
    });

    promptMultiSelectMock.mockImplementation(async (question) => {
      if (question.startsWith('Components')) return ['checkout'];
      if (question.startsWith('Labels')) return ['backend'];
      if (question.startsWith('Approvers')) return [];
      if (question.startsWith('Associate repos')) return [];
      return [];
    });

    await program.parseAsync(['node', 'houston', 'new', 'subtask']);

    const entries = fs.existsSync(subtaskDir) ? fs.readdirSync(subtaskDir) : [];
    const created = entries.find((entry) => !before.has(entry));
    expect(created).toBeDefined();
    const ticket = YAML.parse(fs.readFileSync(path.join(subtaskDir, created!, 'ticket.yaml'), 'utf8'));
    expect(ticket.parent_id).toBe(STORY_ID);
    expect(ticket.story_points).toBe(3);
  });
});
