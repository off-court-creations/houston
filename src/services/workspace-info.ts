import { loadConfig, type CliConfig } from '../config/config.js';
import {
  buildWorkspaceAnalytics,
  type WorkspaceAnalytics,
  type SprintOverview,
} from './workspace-analytics.js';
import { collectWorkspaceInventory } from './workspace-inventory.js';

export interface WorkspaceInfoSnapshot {
  workspace: {
    workspaceRoot: string;
    trackingRoot: string;
    schemaDir: string;
  };
  summary: WorkspaceAnalytics['summary'];
  sprints: {
    active: MinifiedSprint[];
    upcoming: MinifiedSprint[];
    completed: MinifiedSprint[];
  };
  backlog: {
    path: string;
    ticketIds: string[];
    missing: string[];
  };
  nextSprint: {
    path: string;
    ticketIds: string[];
    missing: string[];
  };
  repos: {
    configured: Array<{
      id: string;
      provider?: string;
      remote?: string;
      ticketIds: string[];
    }>;
    unknownReferences: string[];
  };
}

export interface GetWorkspaceInfoOptions {
  cwd?: string; // Starting directory for workspace discovery
}

export interface MinifiedSprint {
  id: string;
  status: SprintOverview['status'];
  startDate?: string;
  endDate?: string;
  name?: string;
  pretty: string;
}

export function getWorkspaceSnapshot(options: GetWorkspaceInfoOptions = {}): WorkspaceInfoSnapshot {
  const config = loadConfig({ cwd: options.cwd });
  const analytics = computeAnalytics(config);

  const activeSprints = analytics.sprints.filter((s) => s.status === 'active');
  const upcomingSprints = analytics.sprints.filter((s) => s.status === 'upcoming');
  const completedSprints = analytics.sprints.filter((s) => s.status === 'completed');

  return {
    workspace: {
      workspaceRoot: config.workspaceRoot,
      trackingRoot: config.tracking.root,
      schemaDir: config.tracking.schemaDir,
    },
    summary: analytics.summary,
    sprints: {
      active: activeSprints.map(minifySprint),
      upcoming: upcomingSprints.map(minifySprint),
      completed: completedSprints.map(minifySprint),
    },
    backlog: {
      path: analytics.backlog.path,
      ticketIds: analytics.backlog.tickets.map((t) => t.id),
      missing: analytics.backlog.missing,
    },
    nextSprint: {
      path: analytics.nextSprint.path,
      ticketIds: analytics.nextSprint.tickets.map((t) => t.id),
      missing: analytics.nextSprint.missing,
    },
    repos: {
      configured: analytics.repoUsage.map((entry) => ({
        id: entry.config.id,
        provider: (entry.config as any).provider,
        remote: (entry.config as any).remote,
        ticketIds: entry.tickets.map((t) => t.id),
      })),
      unknownReferences: analytics.unknownRepoTickets.map((t) => t.id),
    },
  };
}

function computeAnalytics(config: CliConfig): WorkspaceAnalytics {
  const inventory = collectWorkspaceInventory(config);
  return buildWorkspaceAnalytics(inventory);
}

function minifySprint(sprint: SprintOverview): MinifiedSprint {
  return {
    id: sprint.id,
    status: sprint.status,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    name: sprint.name,
    pretty: formatSprintPretty(sprint),
  };
}

function formatSprintPretty(sprint: SprintOverview): string {
  const window = formatSprintWindow(sprint.startDate, sprint.endDate);
  const name = sprint.name?.trim();
  if (name && window) return `${name} (${window})`;
  if (name) return name;
  if (window) return window;
  return sprint.id;
}

function formatSprintWindow(start?: string, end?: string): string | undefined {
  if (start && end) return `${start} → ${end}`;
  if (start) return start;
  if (end) return end;
  return undefined;
}

