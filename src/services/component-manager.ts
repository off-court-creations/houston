import process from 'node:process';
import type { CliConfig } from '../config/config.js';
import { promptText, promptMultiSelect, canPrompt } from '../lib/interactive.js';
import { loadComponents, addComponent } from './component-store.js';
import { loadComponentRouting, setComponentRepos } from './component-routing-store.js';
import { listRepos } from './repo-registry.js';

export interface ComponentDetails {
  id: string;
  repos: string[];
}

export interface ComponentPromptOptions {
  initialId?: string;
  allowEditId?: boolean;
  initialRepos?: string[];
}

export function normalizeComponentId(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeComponentList(values: string[]): string[] {
  const result = new Set<string>();
  for (const raw of values) {
    const normalized = normalizeComponentId(raw);
    if (normalized) {
      result.add(normalized);
    }
  }
  return Array.from(result.values());
}

export async function promptComponentDetails(
  config: CliConfig,
  options: ComponentPromptOptions = {},
): Promise<ComponentDetails> {
  const allowEditId = options.allowEditId !== false;
  const existing = new Set(loadComponents(config));
  let componentId = options.initialId ? normalizeComponentId(options.initialId) : '';

  if (!componentId || allowEditId) {
    while (true) {
      const value = await promptText('Component id (slug)', {
        defaultValue: componentId || options.initialId,
        required: true,
        validate: (input) => {
          const normalized = normalizeComponentId(input);
          if (!normalized) {
            return 'Component id is required.';
          }
          return null;
        },
      });
      componentId = normalizeComponentId(value);
      if (componentId) {
        break;
      }
      console.log('Component id must not be empty.');
    }
  }

  const repos = listRepos(config).map((repo) => repo.id);
  const defaultRepos = options.initialRepos ?? [];
  let repoSelection: string[] = defaultRepos;
  if (repos.length > 0) {
    repoSelection = await promptMultiSelect('Associate repos (optional)', repos, {
      defaultValue: defaultRepos,
      required: false,
      allowEmpty: true,
    });
  }

  return { id: componentId, repos: repoSelection };
}

export function registerComponent(config: CliConfig, details: ComponentDetails): void {
  addComponent(config, details.id);
  if (details.repos.length > 0) {
    setComponentRepos(config, details.id, details.repos);
  }
}

export async function ensureComponentRegistered(
  config: CliConfig,
  componentId: string,
  interactive: boolean,
): Promise<void> {
  const normalized = normalizeComponentId(componentId);
  if (!normalized) {
    return;
  }
  const existing = new Set(loadComponents(config));
  if (existing.has(normalized)) {
    return;
  }

  if (interactive && canPrompt()) {
    const routing = loadComponentRouting(config);
    const initialRepos = routing.routes[normalized] ?? [];
    const details = await promptComponentDetails(config, {
      initialId: normalized,
      allowEditId: true,
      initialRepos,
    });
    registerComponent(config, details);
  } else {
    registerComponent(config, { id: normalized, repos: [] });
  }
}
