import type { RepoConfig } from '../services/repo-registry.js';

export interface BranchParams {
  branch: string;
  base?: string;
}

export interface PullRequestParams {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  reviewers?: string[];
}

export interface ProviderContext {
  repo: RepoConfig;
}

export interface Provider {
  ensureBranch(params: BranchParams): Promise<void>;
  openPullRequest(params: PullRequestParams): Promise<{ number: number; url: string }>;
}
