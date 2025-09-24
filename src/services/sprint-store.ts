import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { ensureSignature } from '../lib/signature.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';
import { recordChange } from './mutation-tracker.js';

export interface SprintMetadata extends Record<string, unknown> {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  goal?: string;
  team_capacity?: Record<string, string>;
  burndown_source?: string;
  notes?: string;
  generated_by?: string;
}

export interface SprintScope extends Record<string, unknown> {
  epics: string[];
  stories: string[];
  subtasks: string[];
  bugs: string[];
  generated_by?: string;
}

export interface SprintFiles {
  meta: SprintMetadata;
  scope: SprintScope;
}

export function resolveSprintDir(config: CliConfig, sprintId: string): string {
  return path.join(config.tracking.sprintsDir, sprintId);
}

export function ensureSprintStructure(config: CliConfig, sprintId: string): string {
  const dir = resolveSprintDir(config, sprintId);
  fs.mkdirSync(dir, { recursive: true });
  const notesFile = path.join(dir, 'notes.md');
  if (!fs.existsSync(notesFile)) {
    fs.writeFileSync(notesFile, `# ${sprintId} Notes
`, 'utf8');
  }
  return dir;
}

export function loadSprint(config: CliConfig, sprintId: string): SprintFiles | undefined {
  const dir = resolveSprintDir(config, sprintId);
  const sprintFile = path.join(dir, 'sprint.yaml');
  const scopeFile = path.join(dir, 'scope.yaml');
  if (!fs.existsSync(sprintFile) || !fs.existsSync(scopeFile)) {
    return undefined;
  }
  return {
    meta: readYamlFile<SprintMetadata>(sprintFile),
    scope: readYamlFile<SprintScope>(scopeFile),
  };
}

export function saveSprintMetadata(config: CliConfig, sprint: SprintMetadata): void {
  const dir = ensureSprintStructure(config, sprint.id);
  const sprintFile = path.join(dir, 'sprint.yaml');
  const payload = ensureSignature(sprint, config.metadata.generator);
  writeYamlFile(sprintFile, payload);
  recordChange('sprints');
}

export function saveSprintScope(config: CliConfig, sprintId: string, scope: SprintScope): void {
  const dir = ensureSprintStructure(config, sprintId);
  const scopeFile = path.join(dir, 'scope.yaml');
  const payload = ensureSignature(scope, config.metadata.generator);
  writeYamlFile(scopeFile, payload);
  recordChange('sprints');
}

export function emptyScope(generator: string): SprintScope {
  return {
    epics: [],
    stories: [],
    subtasks: [],
    bugs: [],
    generated_by: generator,
  };
}
