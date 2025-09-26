import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../src/services/workspace-create.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const child = await import('node:child_process');

let tempDir: string;
const originalCwd = process.cwd;

describe('workspace-create service', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-wscreate-'));
    process.cwd = () => tempDir;
    (child.spawnSync as any).mockReset();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('scaffolds a workspace without git when git=false', async () => {
    const target = path.join(tempDir, 'tracking');
    const res = await createWorkspace({ directory: 'tracking', git: false, force: true });
    expect(res.workspaceRoot).toBe(target);
    expect(res.gitInitialized).toBe(false);
    expect(fs.existsSync(path.join(target, 'houston.config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'tickets/EPIC/.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'sprints/README.md'))).toBe(true);
  });

  it('initializes git, makes initial commit, adds remote, and pushes when configured', async () => {
    const calls: string[][] = [];
    let addCalled = false;
    let commitCalled = false;
    let remoteAddCalled = false;
    let pushCalled = false;
    (child.spawnSync as any).mockImplementation((_cmd: string, args: readonly string[]) => {
      calls.push(['git', ...args]);
      // git init success
      if (args[0] === 'init' || args[0] === 'checkout') return { status: 0 };
      if (args[0] === 'add') {
        addCalled = true;
        return { status: 0 };
      }
      if (args[0] === 'commit') {
        commitCalled = true;
        return { status: 0 };
      }
      if (args[0] === 'remote' && args[1] === 'add') {
        remoteAddCalled = true;
        return { status: 0 };
      }
      if (args[0] === 'push') {
        pushCalled = true;
        return { status: 0 };
      }
      // initial push path: determine upstream & branch
      if (args[0] === 'rev-parse') return { status: 1 };
      if (args[0] === 'remote') return { status: 0, stdout: '' };
      return { status: 0 };
    });

    const target = path.join(tempDir, 'tracking');
    const res = await createWorkspace({ directory: target, force: true, remote: 'git@github.com:owner/repo.git', push: true });
    expect(res.workspaceRoot).toBe(target);
    expect(fs.existsSync(path.join(target, 'houston.config.yaml'))).toBe(true);
    const hasInit = calls.some((c) => c[1] === 'init');
    expect(hasInit).toBe(true);
    expect(addCalled).toBe(true);
    expect(commitCalled).toBe(true);
    expect(remoteAddCalled).toBe(true);
    expect(pushCalled).toBe(true);
  });

  it('refuses to scaffold into a non-empty directory without force', async () => {
    const target = path.join(tempDir, 'tracking');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'existing.txt'), 'hello');
    await expect(createWorkspace({ directory: target })).rejects.toThrow(/not empty/);
  });
});

