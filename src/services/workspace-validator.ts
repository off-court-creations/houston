import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, CliConfig } from '../config/config.js';
import { hasValidSignature } from '../lib/signature.js';
import { SchemaRegistry } from './schema-registry.js';
import {
  collectWorkspaceInventory,
  BacklogInfo,
  CodeRepoEntryRef,
  NextSprintInfo,
  SprintInfo,
  SprintScopeInfo,
  TicketInfo,
  TransitionMap,
  WorkspaceInventory,
} from './workspace-inventory.js';

export interface ValidationIssue {
  file: string;
  rule: string;
  message: string;
  details?: unknown;
}

export interface WorkspaceValidationResult {
  checkedFiles: string[];
  errors: ValidationIssue[];
}

const registryCache = new Map<string, SchemaRegistry>();

interface ValidationContext {
  tickets: TicketInfo[];
  ticketById: Map<string, TicketInfo>;
  components: Set<string>;
  labels: Set<string>;
  users: Set<string>;
  sprints: Map<string, SprintInfo>;
  sprintScopes: Map<string, SprintScopeInfo>;
  backlog?: BacklogInfo;
  nextSprint?: NextSprintInfo;
  transitions: TransitionMap;
  repoIds: Set<string>;
}

export interface ValidateWorkspaceOptions {
  config?: CliConfig;
  target?: string;
}

export async function validateWorkspace({ config: providedConfig, target }: ValidateWorkspaceOptions = {}): Promise<WorkspaceValidationResult> {
  const config = providedConfig ?? loadConfig();
  const registry = getRegistry(config.tracking.schemaDir);
  const inventory = collectWorkspaceInventory(config, { target });

  const errors: ValidationIssue[] = [];

  for (const issue of inventory.issues) {
    const rule = issue.kind === 'parse' ? 'parse' : issue.kind === 'schema' ? 'schema' : 'io';
    errors.push({
      file: issue.file,
      rule,
      message: issue.message,
    });
  }

  for (const document of inventory.documents) {
    const schemaKey = inferSchemaKey(document.relativePath, document.data);
    if (schemaKey) {
      const result = registry.validate(schemaKey, document.data);
      if (!result.valid) {
        for (const issue of result.errors ?? []) {
          errors.push({
            file: document.relativePath,
            rule: 'schema',
            message: `${issue.instancePath || '/'} ${issue.message ?? 'is invalid'}`.trim(),
            details: issue.params,
          });
        }
      }
    }

    if (
      document.data &&
      typeof document.data === 'object' &&
      !Array.isArray(document.data) &&
      'generated_by' in (document.data as Record<string, unknown>) &&
      !hasValidSignature(document.data)
    ) {
      errors.push({
        file: document.relativePath,
        rule: 'signature',
        message: 'generated_by must start with houston@',
      });
    }
  }

  const contextResult = buildValidationContext(inventory);
  errors.push(...contextResult.errors);
  if (contextResult.context) {
    errors.push(...performAdditionalValidations(contextResult.context));
  }

  return {
    checkedFiles: inventory.checkedFiles,
    errors,
  };
}

function inferSchemaKey(relativePath: string, data: unknown): string | undefined {
  if (relativePath.startsWith('tickets/') && relativePath.endsWith('ticket.yaml')) {
    const ticketType = (data as { type?: string } | undefined)?.type;
    if (ticketType && typeof ticketType === 'string') {
      return `ticket.${ticketType}`;
    }
    return 'ticket.base';
  }

  if (relativePath.startsWith('sprints/') && relativePath.endsWith('sprint.yaml')) {
    return 'sprint';
  }

  if (relativePath.startsWith('sprints/') && relativePath.endsWith('scope.yaml')) {
    return 'sprint.scope';
  }

  if (relativePath.startsWith('backlog/')) {
    return 'backlog';
  }

  if (relativePath === 'repos/repos.yaml') {
    return 'repos';
  }

  if (relativePath === 'repos/component-routing.yaml') {
    return 'component-routing';
  }

  if (relativePath === 'transitions.yaml') {
    return 'transitions';
  }

  return undefined;
}

function getRegistry(schemaDir: string): SchemaRegistry {
  let registry = registryCache.get(schemaDir);
  if (!registry) {
    registry = new SchemaRegistry(schemaDir);
    registryCache.set(schemaDir, registry);
  }
  return registry;
}

function buildValidationContext(inventory: WorkspaceInventory): {
  context?: ValidationContext;
  errors: ValidationIssue[];
} {
  const errors: ValidationIssue[] = [];
  const componentsSet = new Set<string>(inventory.components);
  const labelsSet = new Set<string>(inventory.labels);
  const usersSet = new Set<string>(inventory.users);
  const transitions: TransitionMap = inventory.transitions;

  const ticketById = new Map<string, TicketInfo>();
  for (const ticket of inventory.tickets) {
    if (ticketById.has(ticket.id)) {
      errors.push({
        file: ticket.path,
        rule: 'ticket',
        message: `Duplicate ticket id ${ticket.id}`,
      });
    } else {
      ticketById.set(ticket.id, ticket);
    }
  }

  const sprintMap = new Map<string, SprintInfo>();
  for (const sprint of inventory.sprints) {
    sprintMap.set(sprint.id, sprint);
  }

  const scopeMap = new Map<string, SprintScopeInfo>();
  for (const scope of inventory.sprintScopes) {
    scopeMap.set(scope.id, scope);
  }

  let backlog = inventory.backlog;
  if (!backlog) {
    backlog = { ordered: [], path: 'backlog/backlog.yaml' };
  }

  let nextSprint = inventory.nextSprint;
  if (!nextSprint) {
    nextSprint = { candidates: [], path: 'backlog/next-sprint-candidates.yaml' };
  }

  const repoIds = new Set(inventory.repos.map((repo) => repo.id));

  const context: ValidationContext = {
    tickets: inventory.tickets,
    ticketById,
    components: componentsSet,
    labels: labelsSet,
    users: usersSet,
    sprints: sprintMap,
    sprintScopes: scopeMap,
    backlog,
    nextSprint,
    transitions,
    repoIds,
  } as ValidationContext;

  return { context, errors };
}

function performAdditionalValidations(context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const childrenMap = new Map<string, TicketInfo[]>();
  const bugsMap = new Map<string, TicketInfo[]>();

  for (const ticket of context.tickets) {
    const parentId = getString(ticket.data, 'parent_id');
    if (parentId) {
      const targetMap = ticket.type === 'bug' ? bugsMap : childrenMap;
      if (!targetMap.has(parentId)) {
        targetMap.set(parentId, []);
      }
      targetMap.get(parentId)!.push(ticket);
    }
  }

  for (const ticket of context.tickets) {
    errors.push(...validateComponents(ticket, context));
    errors.push(...validatePeople(ticket, context));
    errors.push(...validateParent(ticket, context));
    errors.push(...validateSprint(ticket, context));
    errors.push(...validateDueDates(ticket, context));
    errors.push(...validateCodeRepos(ticket, context));
    errors.push(...validateHistory(ticket, context));
  }

  errors.push(...validateStoryCompletion(context, childrenMap, bugsMap));
  errors.push(...validateScopes(context));
  errors.push(...validateBacklog(context));

  return errors;
}

function validateComponents(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const components = getStringArray(ticket.data, 'components');
  if (components.length === 0) {
    errors.push({ file: ticket.path, rule: 'components', message: 'components list must not be empty' });
  }
  for (const component of components) {
    if (!context.components.has(component)) {
      errors.push({ file: ticket.path, rule: 'components', message: `Unknown component ${component}` });
    }
  }
  const labels = getStringArray(ticket.data, 'labels');
  for (const label of labels) {
    if (!context.labels.has(label)) {
      errors.push({ file: ticket.path, rule: 'labels', message: `Unknown label ${label}` });
    }
  }
  return errors;
}

function validatePeople(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const assignee = getString(ticket.data, 'assignee');
  if (!assignee) {
    errors.push({ file: ticket.path, rule: 'people', message: 'Missing assignee' });
  } else if (!context.users.has(assignee)) {
    errors.push({ file: ticket.path, rule: 'people', message: `Unknown assignee ${assignee}` });
  }
  for (const approver of getStringArray(ticket.data, 'approvers')) {
    if (!context.users.has(approver)) {
      errors.push({ file: ticket.path, rule: 'people', message: `Unknown approver ${approver}` });
    }
  }
  return errors;
}

function validateParent(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const parentId = getString(ticket.data, 'parent_id');
  if (ticket.type === 'subtask' && !parentId) {
    errors.push({ file: ticket.path, rule: 'parent', message: 'Subtask requires parent_id referencing a story' });
  }
  if (!parentId) {
    return errors;
  }
  const parent = context.ticketById.get(parentId);
  if (!parent) {
    errors.push({ file: ticket.path, rule: 'parent', message: `Parent ticket ${parentId} not found` });
    return errors;
  }
  if (ticket.type === 'story' && parent.type !== 'epic') {
    errors.push({ file: ticket.path, rule: 'parent', message: `Story parent must be an epic (got ${parent.type})` });
  }
  if (ticket.type === 'subtask' && parent.type !== 'story') {
    errors.push({ file: ticket.path, rule: 'parent', message: `Subtask parent must be a story (got ${parent.type})` });
  }
  if (ticket.type === 'bug' && parent.type !== 'story') {
    errors.push({ file: ticket.path, rule: 'parent', message: `Bug parent must be a story (got ${parent.type})` });
  }
  return errors;
}

function validateSprint(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const sprintId = getString(ticket.data, 'sprint_id');
  if (sprintId && !context.sprints.has(sprintId)) {
    errors.push({ file: ticket.path, rule: 'sprint', message: `Sprint ${sprintId} not found` });
  }
  return errors;
}

function validateDueDates(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const due = getString(ticket.data, 'due_date');
  const dueDate = parseDate(due);
  if (!due || !dueDate) {
    errors.push({ file: ticket.path, rule: 'due-date', message: 'Invalid or missing due_date' });
    return errors;
  }

  const sprintId = getString(ticket.data, 'sprint_id');
  if (sprintId) {
    const sprint = context.sprints.get(sprintId);
    if (sprint) {
      const sprintEnd = parseDate(getString(sprint.data, 'end_date'));
      if (sprintEnd && dueDate > sprintEnd) {
        errors.push({
          file: ticket.path,
          rule: 'due-date',
          message: `due_date ${due} exceeds sprint end ${getString(sprint.data, 'end_date')}`,
        });
      }
    }
  }

  const parentId = getString(ticket.data, 'parent_id');
  if (parentId) {
    const parent = context.ticketById.get(parentId);
    if (parent) {
      const parentDue = parseDate(getString(parent.data, 'due_date'));
      if (parentDue && dueDate > parentDue) {
        errors.push({
          file: ticket.path,
          rule: 'due-date',
          message: `due_date ${due} exceeds parent ${parentId} due date ${getString(parent.data, 'due_date')}`,
        });
      }
    }
  }

  if (ticket.type === 'story') {
    const epicId = getString(ticket.data, 'parent_id');
    if (epicId) {
      const epic = context.ticketById.get(epicId);
      if (epic) {
        const epicDue = parseDate(getString(epic.data, 'due_date'));
        if (epicDue && dueDate > epicDue) {
          errors.push({
            file: ticket.path,
            rule: 'due-date',
            message: `Story due_date ${due} exceeds epic ${epicId} due date ${getString(epic.data, 'due_date')}`,
          });
        }
      }
    }
  }

  return errors;
}

function validateCodeRepos(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const code = (ticket.data.code ?? {}) as Record<string, unknown>;
  const repos = Array.isArray(code.repos) ? (code.repos as CodeRepoEntryRef[]) : [];
  const branchCount = repos.filter((repo) => typeof repo.branch === 'string' && repo.branch.trim().length > 0).length;
  const autoCreate = code.auto_create_branch !== false;
  const status = getStatus(ticket.data);

  if (autoCreate && status && (status === 'Ready' || status === 'In Progress') && branchCount === 0) {
    errors.push({ file: ticket.path, rule: 'code', message: `Status ${status} requires at least one branch entry` });
  }

  if ((ticket.type === 'subtask' || ticket.type === 'bug') && status === 'In Progress' && branchCount === 0) {
    errors.push({ file: ticket.path, rule: 'code', message: `${ticket.type} in In Progress must have at least one branch` });
  }

  for (const entry of repos) {
    const repoId = entry.repo_id;
    if (!repoId) {
      errors.push({ file: ticket.path, rule: 'code', message: 'Linked code entry missing repo_id' });
      continue;
    }
    if (!context.repoIds.has(repoId)) {
      errors.push({ file: ticket.path, rule: 'code', message: `Unknown repo reference ${repoId}` });
    }
    if (!entry.branch) {
      errors.push({ file: ticket.path, rule: 'code', message: `Repo ${repoId} missing branch name` });
    }
    const pr = entry.pr as { state?: unknown } | undefined;
    if (status === 'Done' && pr) {
      const state = typeof pr.state === 'string' ? pr.state : undefined;
      if (state && state !== 'merged') {
        errors.push({ file: ticket.path, rule: 'code', message: `Ticket Done requires merged PR for repo ${repoId}` });
      }
    }
  }

  return errors;
}

function validateHistory(ticket: TicketInfo, context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const transitions = context.transitions[ticket.type] ?? {};

  if (!fs.existsSync(ticket.historyPath)) {
    errors.push({ file: ticket.historyRelative, rule: 'history', message: 'Missing history.ndjson' });
    return errors;
  }

  const lines = fs.readFileSync(ticket.historyPath, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    errors.push({ file: ticket.historyRelative, rule: 'history', message: 'History must contain at least one event' });
    return errors;
  }

  let currentStatus: string | undefined;
  let lastTimestamp: number | undefined;

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      errors.push({
        file: ticket.historyRelative,
        rule: 'history',
        message: `Invalid JSON entry: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const ts = getString(event, 'ts');
    const parsedTs = parseDate(ts);
    if (!ts || !parsedTs) {
      errors.push({ file: ticket.historyRelative, rule: 'history', message: 'History event missing valid timestamp' });
    } else {
      lastTimestamp = Math.max(lastTimestamp ?? parsedTs, parsedTs);
    }

    const op = getString(event, 'op');
    if (!op) {
      errors.push({ file: ticket.historyRelative, rule: 'history', message: 'History event missing op' });
      continue;
    }

    if (op === 'create') {
      const toStatus = getStatusValue(event.to);
      if (toStatus) {
        currentStatus = toStatus;
      }
      continue;
    }

    if (op === 'status') {
      const fromStatusDeclared = getStatusValue(event.from);
      const fromStatus = fromStatusDeclared ?? currentStatus;
      const toStatus = getStatusValue(event.to);
      if (!toStatus) {
        errors.push({ file: ticket.historyRelative, rule: 'history', message: 'Status event missing target status' });
        continue;
      }
      if (fromStatusDeclared && currentStatus && fromStatusDeclared !== currentStatus) {
        errors.push({
          file: ticket.historyRelative,
          rule: 'transition',
          message: `History from status ${fromStatusDeclared} does not match current status ${currentStatus}`,
        });
      }
      if (fromStatus) {
        const allowed = transitions[fromStatus] ?? [];
        if (!allowed.includes(toStatus)) {
          errors.push({
            file: ticket.historyRelative,
            rule: 'transition',
            message: `Transition ${fromStatus} -> ${toStatus} not allowed for ${ticket.type}`,
          });
        }
      }
      currentStatus = toStatus;
    }
  }

  const ticketStatus = getStatus(ticket.data);
  if (currentStatus && ticketStatus && currentStatus !== ticketStatus) {
    errors.push({
      file: ticket.path,
      rule: 'history',
      message: `Ticket status ${ticketStatus} does not match last history status ${currentStatus}`,
    });
  }

  const updatedAt = parseDate(getString(ticket.data, 'updated_at'));
  if (updatedAt && lastTimestamp && lastTimestamp + 1000 < updatedAt) {
    errors.push({
      file: ticket.historyRelative,
      rule: 'history',
      message: 'History not updated after ticket change',
    });
  }

  return errors;
}

function validateStoryCompletion(
  context: ValidationContext,
  childrenMap: Map<string, TicketInfo[]>,
  bugsMap: Map<string, TicketInfo[]>,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const ticket of context.tickets) {
    if (ticket.type !== 'story') {
      continue;
    }
    if (getStatus(ticket.data) !== 'Done') {
      continue;
    }
    const children = childrenMap.get(ticket.id) ?? [];
    for (const child of children) {
      const status = getStatus(child.data);
      if (status && status !== 'Done') {
        errors.push({
          file: ticket.path,
          rule: 'completion',
          message: `Story cannot be Done while subtask ${child.id} is ${status}`,
        });
      }
    }
    const bugs = bugsMap.get(ticket.id) ?? [];
    for (const bug of bugs) {
      const status = getStatus(bug.data);
      if (status && status !== 'Done' && status !== 'Canceled') {
        errors.push({
          file: ticket.path,
          rule: 'completion',
          message: `Story cannot be Done while bug ${bug.id} is ${status}`,
        });
      }
    }
  }
  return errors;
}

function validateScopes(context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const scope of context.sprintScopes.values()) {
    const data = scope.data;
    validateScopeList(scope, data, 'epics', 'epic', context, errors);
    validateScopeList(scope, data, 'stories', 'story', context, errors);
    validateScopeList(scope, data, 'subtasks', 'subtask', context, errors);
    validateScopeList(scope, data, 'bugs', 'bug', context, errors);
  }
  return errors;
}

function validateScopeList(
  scope: SprintScopeInfo,
  data: Record<string, unknown>,
  key: string,
  expectedType: TicketInfo['type'],
  context: ValidationContext,
  errors: ValidationIssue[],
): void {
  const items = getStringArray(data, key);
  for (const id of items) {
    const ticket = context.ticketById.get(id);
    if (!ticket) {
      errors.push({ file: scope.path, rule: 'scope', message: `${key} references unknown ticket ${id}` });
      continue;
    }
    if (ticket.type !== expectedType) {
      errors.push({ file: scope.path, rule: 'scope', message: `${key} expects ${expectedType} but ${id} is ${ticket.type}` });
    }
  }
}

function validateBacklog(context: ValidationContext): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  if (context.backlog) {
    for (const id of context.backlog.ordered) {
      if (!context.ticketById.has(id)) {
        errors.push({ file: context.backlog.path, rule: 'backlog', message: `Backlog references unknown ticket ${id}` });
      }
    }
  }
  if (context.nextSprint) {
    for (const id of context.nextSprint.candidates) {
      if (!context.ticketById.has(id)) {
        errors.push({ file: context.nextSprint.path, rule: 'backlog', message: `Next sprint candidates reference unknown ticket ${id}` });
      }
    }
  }
  return errors;
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : ts;
}

function getStatus(data: Record<string, unknown>): string | undefined {
  return getString(data, 'status');
}

function getStatusValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const status = (value as { status?: unknown }).status;
    if (typeof status === 'string') {
      return status;
    }
  }
  return undefined;
}
