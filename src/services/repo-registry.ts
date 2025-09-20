import path from 'node:path';
import fs from 'node:fs';
import type { CliConfig } from '../config/config.js';
import { readYamlFile } from '../lib/yaml.js';

export interface RepoConfig {
  id: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'local' | string;
  remote?: string;
  default_branch: string;
  branch_prefix?: Record<string, string>;
  pr?: {
    open_by_default?: boolean;
    base?: string;
    labels?: string[];
    reviewers_from_ticket_approvers?: boolean;
  };
  protections?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ReposFile {
  repos: RepoConfig[];
}

let cachedRepos: RepoConfig[] | undefined;

export function listRepos(config: CliConfig): RepoConfig[] {
  if (cachedRepos) {
    return cachedRepos;
  }
  const filePath = path.join(config.tracking.root, 'repos', 'repos.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Repos file not found at ${filePath}`);
  }
  const data = readYamlFile<ReposFile>(filePath);
  cachedRepos = data.repos ?? [];
  return cachedRepos;
}

export function getRepo(config: CliConfig, repoId: string): RepoConfig {
  const repo = listRepos(config).find((entry) => entry.id === repoId);
  if (!repo) {
    throw new Error(`Repo configuration ${repoId} not found`);
  }
  return repo;
}

export interface ParsedRemote {
  owner: string;
  repo: string;
  host: string;
}

export function parseRemote(remote: string): ParsedRemote | undefined {
  const sshMatch = remote.match(/^git@([^:]+):([^/]+)\/(.+)\.git$/);
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  }
  const httpsMatch = remote.match(/^https?:\/\/(?:[^@]+@)?([^\/]+)\/([^\/]+)\/(.+?)\.git$/);
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  }
  return undefined;
}

export function resetRepoCache(): void {
  cachedRepos = undefined;
}
