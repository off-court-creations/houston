import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceCommand } from '../../src/commands/workspace.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const child = await import('node:child_process');

let tempDir: string;
const originalCwd = process.cwd;

describe('workspace new (vcs)', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-wsnew-'));
    process.cwd = () => tempDir;
    (child.spawnSync as any).mockReset();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('initializes git, makes initial commit, adds remote, and pushes', async () => {
    const calls: string[][] = [];
    let addCalled = false;
    let commitCalled = false;
    let remoteAddCalled = false;
    let pushCalled = false;
    (child.spawnSync as any).mockImplementation((_cmd: string, args: readonly string[]) => {
      calls.push(['git', ...args]);
      // git init success
      if (args[0] === 'init' || args[0] === 'checkout') return { status: 0 };
      if (args[0] === 'add') { addCalled = true; return { status: 0 }; }
      if (args[0] === 'commit') { commitCalled = true; return { status: 0 }; }
      if (args[0] === 'remote' && args[1] === 'add') { remoteAddCalled = true; return { status: 0 }; }
      if (args[0] === 'push') { pushCalled = true; return { status: 0 }; }
      // initial push path: determine upstream & branch
      if (args[0] === 'rev-parse') return { status: 1 };
      if (args[0] === 'remote') return { status: 0, stdout: '' };
      return { status: 0 };
    });

    const program = new Command();
    registerWorkspaceCommand(program);
    const target = path.join(tempDir, 'tracking');
    await program.parseAsync(['node', 'houston', 'workspace', 'new', target, '--no-interactive', '--force', '--remote', 'git@github.com:owner/repo.git', '--push']);

    // Paths created
    expect(fs.existsSync(path.join(target, 'houston.config.yaml'))).toBe(true);

    // git calls: init, add, commit, remote add origin, push -u
    const hasInit = calls.some((c) => c[1] === 'init');
    expect(hasInit).toBe(true);
    expect(addCalled).toBe(true);
    expect(commitCalled).toBe(true);
    expect(remoteAddCalled).toBe(true);
    expect(pushCalled).toBe(true);
  });
});
