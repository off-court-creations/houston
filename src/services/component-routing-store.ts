import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';
import { recordChange } from './mutation-tracker.js';

interface ComponentRoutingFile {
  routes?: Record<string, string[]>;
  defaults?: Record<string, string[]>;
}

export interface ComponentRoute {
  repoId: string;
  path?: string;
}

export interface ComponentRouting {
  routes: Record<string, ComponentRoute[]>;
  defaults?: Record<string, ComponentRoute[]>;
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
  const routes: Record<string, ComponentRoute[]> = {};
  if (data.routes && typeof data.routes === 'object') {
    for (const [key, value] of Object.entries(data.routes)) {
      if (!Array.isArray(value)) continue;
      const items: ComponentRoute[] = [];
      for (const raw of value) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const at = trimmed.indexOf('@');
        if (at === -1) {
          items.push({ repoId: trimmed });
        } else {
          const repoId = trimmed.slice(0, at).trim();
          const path = trimmed.slice(at + 1).trim();
          items.push({ repoId, path: path || undefined });
        }
      }
      routes[key] = items;
    }
  }
  const defaults: Record<string, ComponentRoute[]> | undefined =
    data.defaults && typeof data.defaults === 'object'
      ? Object.fromEntries(
          Object.entries(data.defaults).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value
                  .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
                  .map((raw) => {
                    const at = raw.indexOf('@');
                    if (at === -1) return { repoId: raw } as ComponentRoute;
                    const repoId = raw.slice(0, at).trim();
                    const path = raw.slice(at + 1).trim();
                    return { repoId, path: path || undefined } as ComponentRoute;
                  })
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
  // Persist as plain repo ids (no path) to keep editing simple.
  const routingFile: ComponentRoutingFile = fs.existsSync(file)
    ? readYamlFile<ComponentRoutingFile>(file)
    : { routes: {} };
  routingFile.routes = routingFile.routes ?? {};
  if (repoIds.length > 0) {
    routingFile.routes[componentId] = Array.from(new Set(repoIds)).sort();
  } else {
    delete routingFile.routes[componentId];
  }
  writeYamlFile(file, routingFile);
  recordChange('routing');
}
