import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { ensureSignature } from '../lib/signature.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';
import { recordChange } from './mutation-tracker.js';

export interface BacklogRecord {
  ordered?: string[];
  candidates?: string[];
  notes?: string;
  generated_by?: string;
}

export function loadBacklog(config: CliConfig): BacklogRecord {
  const file = path.join(config.tracking.backlogDir, 'backlog.yaml');
  if (!fs.existsSync(file)) {
    return { ordered: [] };
  }
  return readYamlFile<BacklogRecord>(file);
}

export function loadNextSprintCandidates(config: CliConfig): BacklogRecord {
  const file = path.join(config.tracking.backlogDir, 'next-sprint-candidates.yaml');
  if (!fs.existsSync(file)) {
    return { candidates: [] };
  }
  return readYamlFile<BacklogRecord>(file);
}

export function saveBacklog(config: CliConfig, record: BacklogRecord): void {
  const file = path.join(config.tracking.backlogDir, 'backlog.yaml');
  const payload = ensureSignature({ ordered: record.ordered ?? [], notes: record.notes ?? '' }, config.metadata.generator);
  writeYamlFile(file, payload);
  recordChange('backlog');
}

export function saveNextSprintCandidates(config: CliConfig, record: BacklogRecord): void {
  const file = path.join(config.tracking.backlogDir, 'next-sprint-candidates.yaml');
  const payload = ensureSignature({ candidates: record.candidates ?? [], notes: record.notes ?? '' }, config.metadata.generator);
  writeYamlFile(file, payload);
  recordChange('backlog');
}
