import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import type { CliConfig } from '../config/config.js';
import { readYamlFile } from '../lib/yaml.js';
import type { RepoConfig } from './repo-registry.js';
import { listRepos } from './repo-registry.js';

export type TicketType = 'epic' | 'story' | 'subtask' | 'bug';

export interface TicketInfo {
  id: string;
  type: TicketType;
  path: string;
  absolutePath: string;
  historyPath: string;
  historyRelative: string;
  data: Record<string, unknown>;
}

export interface CodeRepoEntryRef {
  repo_id?: string;
  branch?: string;
  created_by?: string;
  created_at?: string;
  last_synced_at?: string;
  pr?: { [key: string]: unknown };
  [key: string]: unknown;
}

export interface SprintInfo {
  id: string;
  path: string;
  absolutePath: string;
  endDate?: string;
  data: Record<string, unknown>;
}

export interface SprintScopeInfo {
  id: string;
  path: string;
  absolutePath: string;
  data: Record<string, unknown>;
}

export interface BacklogInfo {
  ordered: string[];
  path: string;
}

export interface NextSprintInfo {
  candidates: string[];
  path: string;
}

export type TransitionMap = Record<string, Record<string, string[]>>;

export interface WorkspaceDocument {
  relativePath: string;
  absolutePath: string;
  data: unknown;
}

export type InventoryIssueKind = 'missing' | 'io' | 'parse' | 'schema';

export interface InventoryIssue {
  file: string;
  kind: InventoryIssueKind;
  message: string;
}

export interface WorkspaceInventory {
  documents: WorkspaceDocument[];
  tickets: TicketInfo[];
  sprints: SprintInfo[];
  sprintScopes: SprintScopeInfo[];
  backlog?: BacklogInfo;
  nextSprint?: NextSprintInfo;
  components: string[];
  labels: string[];
  users: string[];
  transitions: TransitionMap;
  repos: RepoConfig[];
  checkedFiles: string[];
  issues: InventoryIssue[];
}

export interface CollectWorkspaceInventoryOptions {
  target?: string;
}

export function collectWorkspaceInventory(config: CliConfig, options: CollectWorkspaceInventoryOptions = {}): WorkspaceInventory {
  const baseDir = config.tracking.root;
  const files = resolveWorkspaceFiles(config, options.target);

  const documents: WorkspaceDocument[] = [];
  const tickets: TicketInfo[] = [];
  const sprints: SprintInfo[] = [];
  const sprintScopes: SprintScopeInfo[] = [];
  let backlogInfo: BacklogInfo | undefined;
  let nextSprintInfo: NextSprintInfo | undefined;
  const issues: InventoryIssue[] = [];

  const checkedFiles = files.map((entry) => entry.relativePath);

  for (const entry of files) {
    if (!fs.existsSync(entry.absolutePath)) {
      issues.push({ file: entry.relativePath, kind: 'missing', message: 'File does not exist' });
      continue;
    }

    if (!isYamlFile(entry.absolutePath)) {
      continue;
    }

    let document: unknown;
    try {
      document = readYamlFile(entry.absolutePath);
    } catch (error) {
      issues.push({
        file: entry.relativePath,
        kind: 'parse',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    documents.push({ relativePath: entry.relativePath, absolutePath: entry.absolutePath, data: document });

    if (entry.relativePath.startsWith('tickets/') && entry.relativePath.endsWith('ticket.yaml')) {
      const data = isRecord(document) ? document : {};
      const type = typeof data.type === 'string' ? (data.type as TicketType) : undefined;
      const id = typeof data.id === 'string' ? data.id : undefined;
      if (!id || !type || !isTicketType(type)) {
        continue;
      }
      const historyPath = path.join(path.dirname(entry.absolutePath), 'history.ndjson');
      const historyRelative = normalizeRelative(path.relative(baseDir, historyPath));
      tickets.push({
        id,
        type,
        path: entry.relativePath,
        absolutePath: entry.absolutePath,
        historyPath,
        historyRelative,
        data: data as Record<string, unknown>,
      });
      continue;
    }

    if (entry.relativePath.startsWith('sprints/') && entry.relativePath.endsWith('sprint.yaml')) {
      const data = isRecord(document) ? document : {};
      const id = typeof data.id === 'string' ? data.id : path.basename(path.dirname(entry.relativePath));
      const end = typeof data.end_date === 'string' ? data.end_date : undefined;
      sprints.push({
        id,
        path: entry.relativePath,
        absolutePath: entry.absolutePath,
        endDate: end,
        data: data as Record<string, unknown>,
      });
      continue;
    }

    if (entry.relativePath.startsWith('sprints/') && entry.relativePath.endsWith('scope.yaml')) {
      const data = isRecord(document) ? document : {};
      const id = path.basename(path.dirname(entry.relativePath));
      sprintScopes.push({
        id,
        path: entry.relativePath,
        absolutePath: entry.absolutePath,
        data: data as Record<string, unknown>,
      });
      continue;
    }

    if (entry.relativePath === 'backlog/backlog.yaml') {
      const ordered = Array.isArray((document as { ordered?: unknown }).ordered)
        ? ((document as { ordered: unknown[] }).ordered as string[])
        : [];
      backlogInfo = { ordered, path: entry.relativePath };
      continue;
    }

    if (entry.relativePath === 'backlog/next-sprint-candidates.yaml') {
      const candidates = Array.isArray((document as { candidates?: unknown }).candidates)
        ? ((document as { candidates: unknown[] }).candidates as string[])
        : [];
      nextSprintInfo = { candidates, path: entry.relativePath };
      continue;
    }
  }

  const components = readStringArrayFile(baseDir, 'taxonomies/components.yaml', 'components', issues);
  const labels = readStringArrayFile(baseDir, 'taxonomies/labels.yaml', 'labels', issues);
  const users = readUsersFile(baseDir, issues);
  const transitions = readTransitionsFile(baseDir, issues);

  let repos: RepoConfig[] = [];
  try {
    repos = listRepos(config);
  } catch (error) {
    issues.push({
      file: 'repos/repos.yaml',
      kind: 'io',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    documents,
    tickets,
    sprints,
    sprintScopes,
    backlog: backlogInfo,
    nextSprint: nextSprintInfo,
    components,
    labels,
    users,
    transitions,
    repos,
    checkedFiles,
    issues,
  };
}

interface FileEntry {
  absolutePath: string;
  relativePath: string;
}

function resolveWorkspaceFiles(config: CliConfig, target?: string): FileEntry[] {
  const baseDir = config.tracking.root;

  if (target) {
    const absolute = path.resolve(config.workspaceRoot, target);
    const relative = normalizeRelative(path.relative(baseDir, absolute) || path.basename(absolute));
    return [{ absolutePath: absolute, relativePath: relative }];
  }

  const patterns = [
    'tickets/**/ticket.yaml',
    'sprints/**/sprint.yaml',
    'sprints/**/scope.yaml',
    'backlog/*.yaml',
    'repos/*.yaml',
    'taxonomies/*.yaml',
    'people/users.yaml',
    'transitions.yaml',
  ];

  const matches = new Set<string>();
  for (const pattern of patterns) {
    const found = globSync(pattern, {
      cwd: baseDir,
      absolute: true,
      nodir: true,
    });
    for (const file of found) {
      matches.add(file);
    }
  }

  return Array.from(matches)
    .sort()
    .map((absolutePath) => ({
      absolutePath,
      relativePath: normalizeRelative(path.relative(baseDir, absolutePath)),
    }));
}

function isYamlFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.yaml') || lower.endsWith('.yml');
}

function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTicketType(value: string): value is TicketType {
  return value === 'epic' || value === 'story' || value === 'subtask' || value === 'bug';
}

function readStringArrayFile(baseDir: string, relative: string, key: string, issues: InventoryIssue[]): string[] {
  const filePath = path.join(baseDir, relative);
  if (!fs.existsSync(filePath)) {
    issues.push({ file: relative, kind: 'missing', message: 'File does not exist' });
    return [];
  }
  try {
    const document = readYamlFile<Record<string, unknown>>(filePath);
    const raw = Array.isArray(document[key]) ? (document[key] as unknown[]) : [];
    return raw.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    issues.push({
      file: relative,
      kind: 'parse',
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function readUsersFile(baseDir: string, issues: InventoryIssue[]): string[] {
  const filePath = path.join(baseDir, 'people/users.yaml');
  if (!fs.existsSync(filePath)) {
    issues.push({ file: 'people/users.yaml', kind: 'missing', message: 'File does not exist' });
    return [];
  }
  try {
    const document = readYamlFile<{ users?: unknown[] }>(filePath);
    const raw = Array.isArray(document.users) ? document.users : [];
    const ids: string[] = [];
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'id' in (entry as Record<string, unknown>)) {
        const id = (entry as Record<string, unknown>).id;
        if (typeof id === 'string') {
          ids.push(id);
        }
      }
    }
    return ids;
  } catch (error) {
    issues.push({
      file: 'people/users.yaml',
      kind: 'parse',
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function readTransitionsFile(baseDir: string, issues: InventoryIssue[]): TransitionMap {
  const filePath = path.join(baseDir, 'transitions.yaml');
  if (!fs.existsSync(filePath)) {
    issues.push({ file: 'transitions.yaml', kind: 'missing', message: 'File does not exist' });
    return {};
  }
  try {
    const document = readYamlFile<{ allowed?: TransitionMap }>(filePath);
    if (document.allowed) {
      return document.allowed;
    }
    issues.push({
      file: 'transitions.yaml',
      kind: 'schema',
      message: 'Missing "allowed" transitions map',
    });
    return {};
  } catch (error) {
    issues.push({
      file: 'transitions.yaml',
      kind: 'parse',
      message: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
