import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliConfig } from '../../src/config/config.js';
import { validateWorkspace } from '../../src/services/workspace-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureWorkspace = path.resolve(__dirname, '../fixtures/workspace');
const schemaDir = fileURLToPath(new URL('../../schema/', import.meta.url));

const EPIC_ID = 'EPIC-11111111-1111-1111-1111-111111111111';
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';

let tempWorkspace: string | undefined;

function makeConfig(workspaceRoot: string): CliConfig {
  return {
    workspaceRoot,
    tracking: {
      root: workspaceRoot,
      schemaDir,
      ticketsDir: path.join(workspaceRoot, 'tickets'),
      backlogDir: path.join(workspaceRoot, 'backlog'),
      sprintsDir: path.join(workspaceRoot, 'sprints'),
    },
    metadata: {
      version: '0.1.0',
      generator: 'houston@0.1.0',
    },
  };
}

function createWorkspaceCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-workspace-'));
  fs.cpSync(fixtureWorkspace, dir, { recursive: true });
  tempWorkspace = dir;
  return dir;
}

describe('workspace validator', () => {
  afterEach(() => {
    if (tempWorkspace) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
      tempWorkspace = undefined;
    }
  });

  it('validates a healthy workspace', async () => {
    const workspace = createWorkspaceCopy();
    const result = await validateWorkspace({ config: makeConfig(workspace) });
    expect(result.errors).toHaveLength(0);
    expect(result.checkedFiles).toContain(`tickets/EPIC/${EPIC_ID}/ticket.yaml`);
  });

  it('reports schema errors for invalid documents', async () => {
    const workspace = createWorkspaceCopy();
    const ticketFile = path.join(workspace, 'tickets/STORY', STORY_ID, 'ticket.yaml');
    fs.writeFileSync(ticketFile, 'type: story\n', 'utf8');
    const result = await validateWorkspace({ config: makeConfig(workspace) });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].file).toBe(`tickets/STORY/${STORY_ID}/ticket.yaml`);
  });
});
