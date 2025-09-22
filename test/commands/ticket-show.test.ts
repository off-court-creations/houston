import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTicketCommand } from '../../src/commands/ticket.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');
const STORY_ID = 'ST-22222222-2222-2222-2222-222222222222';

let tempDir: string;

describe('ticket show command', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-ticket-show-'));
    fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints ticket YAML to stdout', async () => {
    const program = new Command();
    registerTicketCommand(program);

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const chunks: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as unknown as typeof process.stdout.write);

    await program.parseAsync(['node', 'houston', 'ticket', 'show', STORY_ID]);

    cwdSpy.mockRestore();
    writeSpy.mockRestore();

    const output = chunks.join('');
    expect(output).toContain(`id: ${STORY_ID}`);
    expect(output).toContain('type: story');
    expect(output).not.toContain('{');
  });
});

