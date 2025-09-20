import fetch from 'node-fetch';
import type { Provider, BranchParams, PullRequestParams } from './types.js';
import type { RepoConfig } from '../services/repo-registry.js';
import { parseRemote } from '../services/repo-registry.js';

interface GitHubRemote {
  owner: string;
  repo: string;
}

export class GitHubProvider implements Provider {
  private readonly remote: GitHubRemote;
  private readonly token: string;
  private readonly apiBase: string;

  constructor(private readonly repoConfig: RepoConfig) {
    const parsed = parseRemote(repoConfig.remote);
    if (!parsed) {
      throw new Error(`Unsupported GitHub remote format: ${repoConfig.remote}`);
    }
    this.remote = { owner: parsed.owner, repo: parsed.repo.replace(/\.git$/, '') };
    this.token = resolveToken();
    this.apiBase = `https://api.${parsed.host}`;
  }

  async ensureBranch(params: BranchParams): Promise<void> {
    const branch = params.branch;
    const base = params.base ?? this.repoConfig.default_branch ?? 'main';
    const exists = await this.branchExists(branch).catch(() => false);
    if (exists) {
      return;
    }
    const baseSha = await this.getBranchSha(base);
    await this.createBranch(branch, baseSha);
  }

  async openPullRequest(params: PullRequestParams): Promise<{ number: number; url: string }> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/pulls`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        title: params.title,
        head: params.head,
        base: params.base,
        body: params.body,
        draft: params.draft ?? false,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub PR creation failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as { number: number; html_url: string };
    return { number: data.number, url: data.html_url };
  }

  private async branchExists(branch: string): Promise<boolean> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: this.headers() });
    return response.ok;
  }

  private async getBranchSha(branch: string): Promise<string> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Unable to load base branch ${branch}: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async createBranch(branch: string, sha: string): Promise<void> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/git/refs`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
    if (!response.ok && response.status !== 422) {
      const text = await response.text();
      throw new Error(`Unable to create branch ${branch}: ${response.status} ${text}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'archway-houston-cli',
    };
  }
}

export function hasGitHubToken(): boolean {
  return Boolean(process.env.HOUSTON_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
}

function resolveToken(): string {
  const token = process.env.HOUSTON_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GitHub provider requires HOUSTON_GITHUB_TOKEN (or GITHUB_TOKEN/GH_TOKEN).');
  }
  return token;
}
