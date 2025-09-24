import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';
import { recordChange } from './mutation-tracker.js';

interface ComponentRoutingFile {
  routes?: Record<string, string[]>;
  defaults?: Record<string, string[]>;
}

export interface ComponentRouting {
  routes: Record<string, string[]>;
  defaults?: Record<string, string[]>;
}

function resolveRoutingFile(config: CliConfig): string {
  return path.join(config.tracking.root, 'repos', 'component-routing.yaml');
}

export function loadComponentRouting(config: CliConfig): ComponentRouting {
  const file = resolveRoutingFile(config);
  if (!fs.existsSync(file)) {
    return { routes: {} };
  }
  const data = readYamlFile<ComponentRoutingFile>(file);
  const routes: Record<string, string[]> = {};
  if (data.routes && typeof data.routes === 'object') {
    for (const [key, value] of Object.entries(data.routes)) {
      if (Array.isArray(value)) {
        routes[key] = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
      }
    }
  }
  const defaults: Record<string, string[]> | undefined = data.defaults && typeof data.defaults === 'object'
    ? Object.fromEntries(
        Object.entries(data.defaults).map(([key, value]) => [
          key,
          Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
            : [],
        ]),
      )
    : undefined;
  return { routes, defaults };
}

export function setComponentRepos(config: CliConfig, componentId: string, repoIds: string[]): void {
  const file = resolveRoutingFile(config);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const routing = loadComponentRouting(config);
  if (repoIds.length > 0) {
    routing.routes[componentId] = Array.from(new Set(repoIds)).sort();
  } else {
    delete routing.routes[componentId];
  }
  writeYamlFile(file, routing);
  recordChange('routing');
}
