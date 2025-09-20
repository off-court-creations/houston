import fs from 'node:fs';
import path from 'node:path';

export interface HistoryEvent {
  ts?: string;
  actor: string;
  op: string;
  [key: string]: unknown;
}

export function appendHistoryEvent(filePath: string, event: HistoryEvent): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  const ts = event.ts ?? new Date().toISOString();
  const payload = { ...event, ts };
  const line = `${JSON.stringify(payload)}\n`;
  fs.appendFileSync(filePath, line, 'utf8');
}

export function readHistoryEvents(filePath: string): HistoryEvent[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line) as HistoryEvent);
}
