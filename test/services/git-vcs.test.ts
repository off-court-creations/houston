import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliConfig } from '../../src/config/config.js';
import { prePullIfNeeded, buildCommitMessage, deriveChangeTypesFromStatus, autoCommitAndMaybePush } from '../../src/services/git-vcs.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const child = await import('node:child_process');

describe('git-vcs service', () => {
  beforeEach(() => {
    (child.spawnSync as any).mockReset();
  });

  afterEach(() => {
    (child.spawnSync as any).mockReset();
  });

  it('prePullIfNeeded pulls only when in repo, clean, upstream exists', () => {
    const calls: string[][] = [];
    (child.spawnSync as any).mockImplementation((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0, stdout: '.git\n' };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') return { status: 0, stdout: 'origin/main\n' };
      if (args[0] === 'status') return { status: 0, stdout: '' };
      if (args[0] === 'pull') return { status: 0, stdout: '' };
      return { status: 0, stdout: '' };
    });
    prePullIfNeeded({ cwd: '/tmp/repo', rebase: true });
    const pulled = calls.find((c) => c[1] === 'pull');
    expect(pulled).toBeTruthy();
    expect(pulled?.slice(1)).toEqual(['pull', '--rebase']);
  });

  it('prePullIfNeeded skips when dirty', () => {
    const calls: string[][] = [];
    (child.spawnSync as any).mockImplementation((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0 };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') return { status: 0 };
      if (args[0] === 'status') return { status: 0, stdout: ' M tickets/foo\n' };
      return { status: 0 };
    });
    prePullIfNeeded({ cwd: '/tmp/repo', rebase: true });
    const pulled = calls.find((c) => c[1] === 'pull');
    expect(pulled).toBeUndefined();
  });

  it('buildCommitMessage formats subject, cmd, and trailer', () => {
    const msg = buildCommitMessage(['tickets', 'backlog'], 'ticket status');
    expect(msg).toContain('houston: update [tickets, backlog]');
    expect(msg).toContain('cmd: ticket status');
    expect(msg).toContain('Change-Types: tickets, backlog');
  });

  it('deriveChangeTypesFromStatus maps file paths to change types', () => {
    (child.spawnSync as any).mockImplementation((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0, stdout: '.git\n' };
      if (args[0] === 'status') {
        const stdout = [
          'AM tickets/STORY/ID/ticket.yaml',
          'AM backlog/backlog.yaml',
          'AM sprints/S-1/scope.yaml',
          'AM repos/repos.yaml',
          'AM repos/component-routing.yaml',
          'AM people/users.yaml',
          'AM taxonomies/components.yaml',
          'AM taxonomies/labels.yaml',
          'AM schema/ticket.schema.json',
          'AM transitions.yaml',
        ].join('\n');
        return { status: 0, stdout } as any;
      }
      if (args[0] === 'rev-parse') return { status: 0 };
      return { status: 0 };
    });
    const cfg: CliConfig = {
      workspaceRoot: '/tmp/repo',
      tracking: {
        root: path.join('/tmp/repo'),
        schemaDir: '/tmp/repo/schema',
        ticketsDir: '/tmp/repo/tickets',
        backlogDir: '/tmp/repo/backlog',
        sprintsDir: '/tmp/repo/sprints',
      },
      metadata: { version: '0.0.0-test', generator: 'houston@test' },
    };
    const types = deriveChangeTypesFromStatus(cfg, '/tmp/repo');
    expect(types).toEqual([
      'backlog', 'components', 'labels', 'people', 'repos', 'routing', 'schema', 'sprints', 'tickets', 'transitions',
    ]);
  });

  it('autoCommitAndMaybePush commits and pushes (auto policy) when remote exists and no upstream', () => {
    const calls: string[][] = [];
    (child.spawnSync as any).mockImplementation((_cmd: string, args: readonly string[]) => {
      calls.push(['git', ...args]);
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return { status: 0 };
      if (args[0] === 'diff' && args[1] === '--cached') return { status: 0, stdout: 'tickets/foo\n' };
      if (args[0] === 'remote') return { status: 0, stdout: 'origin\n' };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') return { status: 1 };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === 'HEAD') return { status: 0, stdout: 'main\n' };
      return { status: 0 };
    });
    autoCommitAndMaybePush({
      cwd: '/tmp/repo',
      trackingRoot: '/tmp/repo',
      changeTypes: ['tickets'],
      pushPolicy: 'auto',
      commandPath: 'ticket status',
    });
    // expect add, diff --cached, commit, push -u origin main
    const hasCommit = calls.some((c) => c[1] === 'commit');
    const hasPushU = calls.some((c) => c[1] === 'push' && c.includes('-u') && c.includes('origin') && c.includes('main'));
    expect(hasCommit).toBe(true);
    expect(hasPushU).toBe(true);
  });
});
