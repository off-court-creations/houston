import type { RepoConfig } from './repo-registry.js';
import {
  BacklogInfo,
  CodeRepoEntryRef,
  NextSprintInfo,
  SprintInfo,
  SprintScopeInfo,
  TicketInfo,
  TicketType,
  WorkspaceInventory,
} from './workspace-inventory.js';

export type SprintPhase = 'upcoming' | 'active' | 'completed' | 'unknown';

export interface TicketOverview {
  id: string;
  type: TicketType;
  status?: string;
  assignee?: string;
  summary?: string;
  title?: string;
  components: string[];
  labels: string[];
  parentId?: string;
  sprintId?: string;
  dueDate?: string;
  repoIds: string[];
  repos: CodeRepoEntryRef[];
  path: string;
  historyRelative: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface SprintScopeDetails {
  epics: TicketOverview[];
  stories: TicketOverview[];
  subtasks: TicketOverview[];
  bugs: TicketOverview[];
  missing: string[];
}

export interface SprintOverview {
  id: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  status: SprintPhase;
  totalScoped: number;
  scope: SprintScopeDetails;
  path: string;
  scopePath?: string;
}

export interface BacklogOverview {
  path: string;
  tickets: TicketOverview[];
  missing: string[];
}

export interface RepoUsage {
  config: RepoConfig;
  tickets: TicketOverview[];
}

export interface WorkspaceSummary {
  ticketTypeCounts: Record<TicketType, number>;
  ticketStatusCounts: Record<string, number>;
  totalTickets: number;
  backlogCount: number;
  nextSprintCount: number;
  repoCount: number;
  componentCount: number;
  labelCount: number;
  userCount: number;
  activeSprintCount: number;
}

export interface WorkspaceAnalytics {
  tickets: TicketOverview[];
  ticketsById: Map<string, TicketOverview>;
  sprints: SprintOverview[];
  backlog: BacklogOverview;
  nextSprint: BacklogOverview;
  repoUsage: RepoUsage[];
  unknownRepoTickets: TicketOverview[];
  summary: WorkspaceSummary;
  components: string[];
  labels: string[];
  users: string[];
}

export function buildWorkspaceAnalytics(inventory: WorkspaceInventory): WorkspaceAnalytics {
  const tickets: TicketOverview[] = [];
  const ticketsById = new Map<string, TicketOverview>();
  const ticketTypeCounts = initializeTicketTypeCounts();
  const ticketStatusCounts = new Map<string, number>();
  const repoTicketIndex = new Map<string, TicketOverview[]>();
  const knownRepoIds = new Set(inventory.repos.map((repo) => repo.id));
  const unknownRepoTickets: TicketOverview[] = [];

  for (const ticket of inventory.tickets) {
    const overview = toTicketOverview(ticket);
    tickets.push(overview);
    ticketsById.set(overview.id, overview);
    ticketTypeCounts[overview.type] = (ticketTypeCounts[overview.type] ?? 0) + 1;
    if (overview.status) {
      const current = ticketStatusCounts.get(overview.status) ?? 0;
      ticketStatusCounts.set(overview.status, current + 1);
    }
    for (const repoId of overview.repoIds) {
      const bucket = repoTicketIndex.get(repoId) ?? [];
      bucket.push(overview);
      repoTicketIndex.set(repoId, bucket);
      if (!knownRepoIds.has(repoId)) {
        unknownRepoTickets.push(overview);
      }
    }
  }

  tickets.sort((a, b) => a.id.localeCompare(b.id));

  const sprintScopeMap = new Map<string, SprintScopeInfo>();
  for (const scope of inventory.sprintScopes) {
    sprintScopeMap.set(scope.id, scope);
  }

  const sprints = inventory.sprints
    .map((sprint) => toSprintOverview(sprint, sprintScopeMap.get(sprint.id), ticketsById))
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  const backlog = toBacklogOverview(inventory.backlog, ticketsById, 'backlog/backlog.yaml');
  const nextSprint = toBacklogOverview(inventory.nextSprint, ticketsById, 'backlog/next-sprint-candidates.yaml');

  const repoUsage = inventory.repos
    .map((repo) => ({
      config: repo,
      tickets: (repoTicketIndex.get(repo.id) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.config.id.localeCompare(b.config.id));

  const summary: WorkspaceSummary = {
    ticketTypeCounts,
    ticketStatusCounts: Object.fromEntries([...ticketStatusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    totalTickets: tickets.length,
    backlogCount: backlog.tickets.length,
    nextSprintCount: nextSprint.tickets.length,
    repoCount: inventory.repos.length,
    componentCount: inventory.components.length,
    labelCount: inventory.labels.length,
    userCount: inventory.users.length,
    activeSprintCount: sprints.filter((sprint) => sprint.status === 'active').length,
  };

  return {
    tickets,
    ticketsById,
    sprints,
    backlog,
    nextSprint,
    repoUsage,
    unknownRepoTickets,
    summary,
    components: inventory.components.slice().sort(),
    labels: inventory.labels.slice().sort(),
    users: inventory.users.slice().sort(),
  };
}

function initializeTicketTypeCounts(): Record<TicketType, number> {
  return {
    epic: 0,
    story: 0,
    subtask: 0,
    bug: 0,
  };
}

function toTicketOverview(ticket: TicketInfo): TicketOverview {
  const data = ticket.data;
  const status = getString(data, 'status');
  const assignee = getString(data, 'assignee');
  const summary = getString(data, 'summary');
  const title = getString(data, 'title');
  const parentId = getString(data, 'parent_id');
  const sprintId = getString(data, 'sprint_id');
  const dueDate = getString(data, 'due_date');
  const updatedAt = getString(data, 'updated_at');
  const createdAt = getString(data, 'created_at');
  const components = getStringArray(data, 'components');
  const labels = getStringArray(data, 'labels');
  const repos = extractRepoEntries(data);
  const repoIds = repos
    .map((entry) => entry.repo_id)
    .filter((value): value is string => typeof value === 'string');

  return {
    id: ticket.id,
    type: ticket.type,
    status,
    assignee,
    summary,
    title,
    components,
    labels,
    parentId: parentId ?? undefined,
    sprintId: sprintId ?? undefined,
    dueDate: dueDate ?? undefined,
    repoIds,
    repos,
    path: ticket.path,
    historyRelative: ticket.historyRelative,
    updatedAt: updatedAt ?? undefined,
    createdAt: createdAt ?? undefined,
  };
}

function extractRepoEntries(data: Record<string, unknown>): CodeRepoEntryRef[] {
  const code = data.code;
  if (!code || typeof code !== 'object' || Array.isArray(code)) {
    return [];
  }
  const repos = (code as { repos?: unknown }).repos;
  if (!Array.isArray(repos)) {
    return [];
  }
  return repos.filter((entry): entry is CodeRepoEntryRef => entry !== null && typeof entry === 'object');
}

function toSprintOverview(
  sprint: SprintInfo,
  scopeInfo: SprintScopeInfo | undefined,
  ticketsById: Map<string, TicketOverview>,
): SprintOverview {
  const data = sprint.data;
  const name = getString(data, 'name');
  const startDate = getString(data, 'start_date');
  const endDate = getString(data, 'end_date') ?? sprint.endDate;
  const goal = getString(data, 'goal');
  const status = resolveSprintPhase(startDate, endDate);
  const scope = buildScopeDetails(scopeInfo, ticketsById);
  const totalScoped = scope.epics.length + scope.stories.length + scope.subtasks.length + scope.bugs.length;

  return {
    id: sprint.id,
    name,
    startDate,
    endDate,
    goal,
    status,
    totalScoped,
    scope,
    path: sprint.path,
    scopePath: scopeInfo?.path,
  };
}

function buildScopeDetails(
  scopeInfo: SprintScopeInfo | undefined,
  ticketsById: Map<string, TicketOverview>,
): SprintScopeDetails {
  if (!scopeInfo) {
    return { epics: [], stories: [], subtasks: [], bugs: [], missing: [] };
  }
  const data = scopeInfo.data;
  const epicIds = getStringArray(data, 'epics');
  const storyIds = getStringArray(data, 'stories');
  const subtaskIds = getStringArray(data, 'subtasks');
  const bugIds = getStringArray(data, 'bugs');

  const epics = pickTickets(epicIds, ticketsById);
  const stories = pickTickets(storyIds, ticketsById);
  const subtasks = pickTickets(subtaskIds, ticketsById);
  const bugs = pickTickets(bugIds, ticketsById);

  const missing = dedupe([
    ...findMissing(epicIds, ticketsById),
    ...findMissing(storyIds, ticketsById),
    ...findMissing(subtaskIds, ticketsById),
    ...findMissing(bugIds, ticketsById),
  ]);

  return {
    epics,
    stories,
    subtasks,
    bugs,
    missing,
  };
}

function findMissing(ids: string[], ticketsById: Map<string, TicketOverview>): string[] {
  return ids.filter((id) => !ticketsById.has(id));
}

function pickTickets(ids: string[], ticketsById: Map<string, TicketOverview>): TicketOverview[] {
  return ids
    .map((id) => ticketsById.get(id))
    .filter((ticket): ticket is TicketOverview => Boolean(ticket));
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function toBacklogOverview(
  info: BacklogInfo | NextSprintInfo | undefined,
  ticketsById: Map<string, TicketOverview>,
  fallbackPath: string,
): BacklogOverview {
  const ids = info ? ('ordered' in info ? info.ordered : info.candidates) : [];
  const path = info?.path ?? fallbackPath;
  const tickets = pickTickets(ids, ticketsById);
  const missing = ids.filter((id) => !ticketsById.has(id));
  return {
    path,
    tickets,
    missing,
  };
}

function resolveSprintPhase(startDate?: string, endDate?: string): SprintPhase {
  if (!startDate || !endDate) {
    return 'unknown';
  }
  const now = Date.now();
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'unknown';
  }
  if (now < start) {
    return 'upcoming';
  }
  if (now > end) {
    return 'completed';
  }
  return 'active';
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}
