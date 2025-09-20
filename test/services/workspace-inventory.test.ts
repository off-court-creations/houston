import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliConfig } from '../../src/config/config.js';
import { collectWorkspaceInventory } from '../../src/services/workspace-inventory.js';
import { buildWorkspaceAnalytics } from '../../src/services/workspace-analytics.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/workspace');

function makeConfig(workspaceRoot: string): CliConfig {
  return {
    workspaceRoot,
    tracking: {
      root: workspaceRoot,
      schemaDir: path.join(workspaceRoot, 'schema'),
      ticketsDir: path.join(workspaceRoot, 'tickets'),
      backlogDir: path.join(workspaceRoot, 'backlog'),
      sprintsDir: path.join(workspaceRoot, 'sprints'),
    },
    metadata: {
      version: '0.1.0-test',
      generator: 'houston@0.1.0-test',
    },
  };
}

describe('workspace inventory', () => {
  const config = makeConfig(FIXTURE_ROOT);

  it('collects workspace assets without issues', () => {
    const inventory = collectWorkspaceInventory(config);
    expect(inventory.issues).toHaveLength(0);
    expect(inventory.tickets.map((ticket) => ticket.id)).toContain('EPIC-1234567890AB');
    expect(inventory.tickets.map((ticket) => ticket.id)).toContain('ST-1234567890AB');
    expect(inventory.backlog?.ordered).toContain('ST-1234567890AB');
    expect(inventory.repos[0]?.id).toBe('repo.checkout');
  });

  it('produces analytics with accurate counts', () => {
    const inventory = collectWorkspaceInventory(config);
    const analytics = buildWorkspaceAnalytics(inventory);
    expect(analytics.summary.totalTickets).toBe(2);
    expect(analytics.summary.ticketTypeCounts).toEqual({ epic: 1, story: 1, subtask: 0, bug: 0 });
    expect(analytics.summary.backlogCount).toBe(1);
    expect(analytics.repoUsage[0]?.tickets.map((ticket) => ticket.id)).toContain('ST-1234567890AB');
    expect(analytics.backlog.missing).toHaveLength(0);
    expect(analytics.nextSprint.missing).toHaveLength(0);
  });
});
