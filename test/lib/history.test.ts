import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendHistoryEvent, readHistoryEvents } from '../../src/lib/history.js';

let tempDir: string | undefined;

function createTempFile(): string {
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardate-history-test-'));
  }
  return path.join(tempDir, 'history.ndjson');
}

describe('history helpers', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('appends events with timestamps', () => {
    const file = createTempFile();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    appendHistoryEvent(file, { actor: 'user:alice', op: 'create' });
    vi.useRealTimers();

    const events = readHistoryEvents(file);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: 'user:alice', op: 'create', ts: '2024-01-01T00:00:00.000Z' });
  });
});
