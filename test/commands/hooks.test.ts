import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerHooksCommand } from '../../src/commands/hooks.js';

function buildProgram(): Command {
  const program = new Command();
  registerHooksCommand(program);
  return program;
}

describe('hooks install', () => {
  it('installs prepare-commit-msg hook', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-hooks-'));
    const gitDir = path.join(tmp, '.git');
    fs.mkdirSync(path.join(gitDir, 'hooks'), { recursive: true });

    const program = buildProgram();
    await program.parseAsync(['node', 'houston', 'hooks', 'install', '--target', gitDir]);

    const hookPath = path.join(gitDir, 'hooks', 'prepare-commit-msg');
    expect(fs.existsSync(hookPath)).toBe(true);
    const stat = fs.statSync(hookPath);
    expect(stat.mode & 0o111).toBeTruthy();

    // attempting again without --force should fail
    await expect(
      program.parseAsync(['node', 'houston', 'hooks', 'install', '--target', gitDir]),
    ).rejects.toThrow();

    // with --force overwrites
    await program.parseAsync(['node', 'houston', 'hooks', 'install', '--target', gitDir, '--force']);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
