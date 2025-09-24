import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';
import { recordChange } from './mutation-tracker.js';
import type { RepoConfig, ReposFile } from './repo-registry.js';
import { resetRepoCache, parseRemote } from './repo-registry.js';

function resolveReposFile(config: CliConfig): string {
  return path.join(config.tracking.root, 'repos', 'repos.yaml');
}

export function loadRepos(config: CliConfig): RepoConfig[] {
  const file = resolveReposFile(config);
  if (!fs.existsSync(file)) return [];
  const data = readYamlFile<ReposFile>(file);
  return Array.isArray(data.repos) ? (data.repos as RepoConfig[]) : [];
}

export function upsertRepo(config: CliConfig, repo: RepoConfig): void {
  const file = resolveReposFile(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const repos = loadRepos(config);
  const idx = repos.findIndex((r) => r.id === repo.id);
  if (idx >= 0) {
    repos[idx] = { ...repos[idx], ...repo };
  } else {
    repos.push(repo);
  }
  repos.sort((a, b) => a.id.localeCompare(b.id));
  writeYamlFile(file, { repos });
  resetRepoCache();
  recordChange('repos');
}

export function repoIdExists(config: CliConfig, id: string): boolean {
  return loadRepos(config).some((r) => r.id === id);
}

export function validateRepoConfig(repo: RepoConfig): string[] {
  const errors: string[] = [];
  if (!repo.id || !/^[a-z0-9][a-z0-9._-]*$/.test(repo.id)) {
    errors.push('id must match ^[a-z0-9][a-z0-9._-]*$');
  }
  if (!repo.provider || !['github', 'gitlab', 'bitbucket', 'local'].includes(String(repo.provider))) {
    errors.push('provider must be one of: github, gitlab, bitbucket, local');
  }
  if (repo.provider !== 'local') {
    if (!repo.remote || typeof repo.remote !== 'string') {
      errors.push('remote is required');
    } else if (!parseRemote(repo.remote)) {
      errors.push('remote must look like git@host:owner/repo.git or https://host/owner/repo.git');
    }
  }
  if (!repo.default_branch || typeof repo.default_branch !== 'string') {
    errors.push('default_branch is required');
  }
  const bp = repo.branch_prefix as Record<string, string> | undefined;
  const required = ['epic', 'story', 'subtask', 'bug'];
  if (bp) {
    for (const key of required) {
      const val = bp[key];
      if (!val || !/^[a-z0-9][a-z0-9_-]*$/.test(val)) {
        errors.push(`branch_prefix.${key} must match ^[a-z0-9][a-z0-9_-]*$`);
      }
    }
  }
  return errors;
}
