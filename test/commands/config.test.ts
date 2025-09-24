import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConfigCommand } from '../../src/commands/config.js';

const WORKSPACE_FIXTURE = path.resolve(__dirname, '../fixtures/workspace');

function createProgram(): Command {
  const program = new Command();
  registerConfigCommand(program);
  return program;
}

function seedWorkspace(targetDir: string): void {
  fs.cpSync(WORKSPACE_FIXTURE, targetDir, { recursive: true });
}

describe('config command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-config-command-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints workspace paths when inside a Houston workspace', async () => {
    seedWorkspace(tempDir);
    const program = createProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'houston', 'config']);

    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    const resolvedRoot = fs.realpathSync(tempDir);
    expect(output).toContain('Houston Configuration');
    expect(output).toContain('| Workspace');
    expect(output).toContain('| Tracking root');
    expect(output).toContain(resolvedRoot);
    expect(output).toContain(path.join(resolvedRoot, 'schema'));

    writeSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  it('falls back to global info when outside a workspace', async () => {
    const program = createProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Ensure no default workspace is picked up from user config
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), 'home-')));
    const prevEnv = process.env.HOUSTON_CONFIG_PATH;
    delete process.env.HOUSTON_CONFIG_PATH;

    await program.parseAsync(['node', 'houston', 'config']);

    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('houston version:');
    expect(output).toContain('workspace: (not detected)');
    expect(output).not.toContain('tracking root:');

    writeSpy.mockRestore();
    cwdSpy.mockRestore();
    homeSpy.mockRestore();
    if (prevEnv !== undefined) process.env.HOUSTON_CONFIG_PATH = prevEnv; else delete process.env.HOUSTON_CONFIG_PATH;
  });

  it('emits structured JSON when no workspace is detected', async () => {
    const program = createProgram();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Ensure no default workspace is picked up from user config
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), 'home-')));
    const prevEnv = process.env.HOUSTON_CONFIG_PATH;
    delete process.env.HOUSTON_CONFIG_PATH;

    await program.parseAsync(['node', 'houston', 'config', '--json']);

    const output = writeSpy.mock.calls.map((call) => call[0]).join('');
    const payload = JSON.parse(output);
    expect(payload.workspace).toBeNull();
    expect(typeof payload.version).toBe('string');
    expect(payload.version.length).toBeGreaterThan(0);

    writeSpy.mockRestore();
    cwdSpy.mockRestore();
    homeSpy.mockRestore();
    if (prevEnv !== undefined) process.env.HOUSTON_CONFIG_PATH = prevEnv; else delete process.env.HOUSTON_CONFIG_PATH;
  });
});
