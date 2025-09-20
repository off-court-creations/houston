import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';

interface ComponentFile {
  components?: string[];
}

const COMPONENTS_KEY = 'components';

function resolveComponentsFile(config: CliConfig): string {
  return path.join(config.tracking.root, 'taxonomies', 'components.yaml');
}

export function loadComponents(config: CliConfig): string[] {
  const file = resolveComponentsFile(config);
  if (!fs.existsSync(file)) {
    return [];
  }
  const data = readYamlFile<ComponentFile>(file);
  if (!Array.isArray(data.components)) {
    return [];
  }
  return data.components.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

export function addComponent(config: CliConfig, componentId: string): void {
  const file = resolveComponentsFile(config);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const existing = new Set(loadComponents(config));
  existing.add(componentId);
  const sorted = Array.from(existing.values()).sort();
  writeYamlFile(file, {
    [COMPONENTS_KEY]: sorted,
  });
}

export function componentExists(config: CliConfig, componentId: string): boolean {
  return loadComponents(config).includes(componentId);
}
