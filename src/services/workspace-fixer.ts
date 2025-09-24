import type { CliConfig } from '../config/config.js';
import { collectWorkspaceInventory } from './workspace-inventory.js';
import { loadTicket, saveTicket, type TicketRecord } from './ticket-store.js';
import { normalizeUserId } from '../utils/user-id.js';

export interface FixOptions {
  config: CliConfig;
  target?: string;
}

export interface FixResult {
  ticketsScanned: number;
  ticketsFixed: number;
  filesChanged: string[];
}

export async function autoFixWorkspace({ config, target }: FixOptions): Promise<FixResult> {
  const inventory = collectWorkspaceInventory(config, { target });
  let ticketsFixed = 0;
  const filesChanged: string[] = [];

  for (const info of inventory.tickets) {
    const original = loadTicket(config, info.id);
    const patched = { ...original } as TicketRecord & Record<string, unknown>;
    let changed = false;

    // Normalize assignee
    if (typeof patched.assignee === 'string') {
      const norm = normalizeUserId(patched.assignee);
      if (norm !== patched.assignee) {
        patched.assignee = norm as any;
        changed = true;
      }
    }

    // Normalize approvers
    if (Array.isArray((patched as any).approvers)) {
      const current = ((patched as any).approvers as unknown[]).filter((v) => typeof v === 'string') as string[];
      const normalized = current.map((v) => normalizeUserId(v));
      // Only set if different
      if (JSON.stringify(current) !== JSON.stringify(normalized)) {
        (patched as any).approvers = normalized;
        changed = true;
      }
    }

    // Ensure due_date
    if (typeof (patched as any).due_date !== 'string' || (patched as any).due_date.trim() === '') {
      (patched as any).due_date = defaultDueDate((patched as any).created_at as string | undefined);
      changed = true;
    }

    if (changed) {
      saveTicket(config, patched as TicketRecord, { actor: 'houston', incrementVersion: true });
      ticketsFixed += 1;
      filesChanged.push(info.path);
    }
  }

  return { ticketsScanned: inventory.tickets.length, ticketsFixed, filesChanged };
}

function defaultDueDate(createdAt?: string): string {
  const base = createdAt ? safeParseDate(createdAt) ?? new Date() : new Date();
  const dueMs = base.getTime() + 14 * 24 * 60 * 60 * 1000;
  const due = new Date(dueMs);
  const y = due.getUTCFullYear();
  const m = String(due.getUTCMonth() + 1).padStart(2, '0');
  const d = String(due.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function safeParseDate(value: string): Date | null {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
}

