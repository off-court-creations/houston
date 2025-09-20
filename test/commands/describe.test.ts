import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDescribeCommand } from '../../src/commands/describe.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-describe-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

describe('describe command', () => {
  beforeEach(() => {
    setupWorkspace();
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('prints ticket YAML to stdout', async () => {
    const program = new Command();
    registerDescribeCommand(program);

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const chunks: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as unknown as typeof process.stdout.write);

    await program.parseAsync(['node', 'houston', 'describe', 'ST-1234567890AB']);

    cwdSpy.mockRestore();
    writeSpy.mockRestore();

    const output = chunks.join('');
    expect(output).toContain('id: ST-1234567890AB');
    expect(output).toContain('type: story');
    expect(output).not.toContain('{');
  });
});
