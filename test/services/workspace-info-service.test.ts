import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkspaceSnapshot } from '../../src/services/workspace-info.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/workspace');

describe('workspace-info service', () => {
  it('returns a snapshot matching CLI info shape', () => {
    const snapshot = getWorkspaceSnapshot({ cwd: FIXTURE_ROOT });
    expect(snapshot.workspace.workspaceRoot).toBeDefined();
    expect(snapshot.workspace.trackingRoot.endsWith('/workspace')).toBe(true);
    expect(snapshot.summary.totalTickets).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.sprints.active)).toBe(true);
    expect(snapshot.backlog.ticketIds.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snapshot.repos.configured)).toBe(true);
  });
});

