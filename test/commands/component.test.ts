import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerComponentCommand } from '../../src/commands/component.js';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardate-component-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
  vi.resetAllMocks();
}

function buildProgram(): Command {
  const program = new Command();
  registerComponentCommand(program);
  return program;
}

describe('component command', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('adds a component via flags', async () => {
    const program = buildProgram();
    const componentsFile = path.join(tempDir, 'taxonomies', 'components.yaml');
    const routingFile = path.join(tempDir, 'repos', 'component-routing.yaml');

    await program.parseAsync([
      'node',
      'stardate',
      'component',
      'add',
      '--id',
      'new-comp',
      '--repos',
      'repo.checkout',
    ]);

    const components = YAML.parse(fs.readFileSync(componentsFile, 'utf8')) as { components: string[] };
    expect(components.components).toContain('new-comp');

    const routing = YAML.parse(fs.readFileSync(routingFile, 'utf8')) as { routes?: Record<string, string[]> };
    expect(routing.routes?.['new-comp']).toContain('repo.checkout');
  });

  it('prompts for component details when flags omitted', async () => {
    const program = buildProgram();
    const componentsFile = path.join(tempDir, 'taxonomies', 'components.yaml');

    promptInputMock.mockResolvedValueOnce('fresh-comp');
    promptMultiSelectMock.mockResolvedValueOnce(['repo.checkout']);

    process.env.STARDATE_FORCE_INTERACTIVE = '1';
    await program.parseAsync(['node', 'stardate', 'component', 'add']);
    delete process.env.STARDATE_FORCE_INTERACTIVE;

    const components = YAML.parse(fs.readFileSync(componentsFile, 'utf8')) as { components: string[] };
    expect(components.components).toContain('fresh-comp');
  });
});
