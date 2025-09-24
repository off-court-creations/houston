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
  /** Ensure a branch exists on the remote, creating it from base if missing. */
  ensureBranch(params: BranchParams): Promise<void>;
  /** Check whether a branch exists on the remote. */
  branchExists(branch: string): Promise<boolean>;
  openPullRequest(params: PullRequestParams): Promise<{ number: number; url: string }>;
}
