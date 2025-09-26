import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CommandHistoryEntry {
  command: string;
  timestamp: string;
  result?: 'success' | 'error';
}

const HISTORY_DIR = path.join(os.homedir(), '.houston');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.log');

export function recordCommandHistory(entry: CommandHistoryEntry): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    const payload = JSON.stringify(entry);
    fs.appendFileSync(HISTORY_FILE, `${payload}\n`, 'utf8');
  } catch {
    // best effort
  }
}

export function readCommandHistory(limit = 20): CommandHistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const text = fs.readFileSync(HISTORY_FILE, 'utf8');
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries: CommandHistoryEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      const raw = lines[i];
      try {
        const parsed = JSON.parse(raw) as CommandHistoryEntry;
        if (parsed && typeof parsed.command === 'string' && typeof parsed.timestamp === 'string') {
          entries.push(parsed);
        }
      } catch {
        // ignore malformed
      }
    }
    return entries;
  } catch {
    return [];
  }
}
