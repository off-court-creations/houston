import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';

interface LabelsFile {
  labels?: string[];
}

const LABELS_KEY = 'labels';

function resolveLabelsFile(config: CliConfig): string {
  return path.join(config.tracking.root, 'taxonomies', 'labels.yaml');
}

export function loadLabels(config: CliConfig): string[] {
  const file = resolveLabelsFile(config);
  if (!fs.existsSync(file)) return [];
  const data = readYamlFile<LabelsFile>(file);
  const raw = Array.isArray(data.labels) ? data.labels : [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function addLabels(config: CliConfig, values: string[]): void {
  const file = resolveLabelsFile(config);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const existing = new Set(loadLabels(config));
  for (const value of values) {
    const trimmed = String(value).trim();
    if (trimmed) existing.add(trimmed);
  }
  const sorted = Array.from(existing.values()).sort((a, b) => a.localeCompare(b));
  writeYamlFile(file, { [LABELS_KEY]: sorted });
}

export function labelExists(config: CliConfig, value: string): boolean {
  return loadLabels(config).includes(value);
}

