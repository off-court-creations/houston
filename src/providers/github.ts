import fetch from 'node-fetch';
import type { Provider, BranchParams, PullRequestParams } from './types.js';
import type { RepoConfig } from '../services/repo-registry.js';
import { parseRemote } from '../services/repo-registry.js';
import { getSecret } from '../services/secrets.js';
import { loadConfig } from '../config/config.js';

interface GitHubRemote {
  owner: string;
  repo: string;
}

export class GitHubProvider implements Provider {
  private readonly remote: GitHubRemote;
  private readonly apiBase: string;
  private readonly host: string;

  constructor(private readonly repoConfig: RepoConfig) {
    const parsed = parseRemote(repoConfig.remote ?? '');
    if (!parsed) {
      throw new Error(`Unsupported GitHub remote format: ${repoConfig.remote}`);
    }
    this.remote = { owner: parsed.owner, repo: parsed.repo.replace(/\.git$/, '') };
    this.host = parsed.host;
    this.apiBase = parsed.host === 'github.com' ? 'https://api.github.com' : `https://${parsed.host}/api/v3`;
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
    const token = await resolveTokenAsync(this.host);
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(token),
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
    const token = await resolveTokenAsync(this.host);
    const response = await fetch(url, { headers: headers(token) });
    return response.ok;
  }

  private async getBranchSha(branch: string): Promise<string> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const token = await resolveTokenAsync(this.host);
    const response = await fetch(url, { headers: headers(token) });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Unable to load base branch ${branch}: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async createBranch(branch: string, sha: string): Promise<void> {
    const url = `${this.apiBase}/repos/${this.remote.owner}/${this.remote.repo}/git/refs`;
    const token = await resolveTokenAsync(this.host);
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(token),
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

}
async function resolveTokenAsync(host: string): Promise<string> {
  try {
    const cfg = loadConfig();
    const label = cfg.auth?.github?.label;
    const authHost = cfg.auth?.github?.host ?? host;
    if (label) {
      const acc = `github@${authHost}#${label}`;
      const stored = await getSecret('archway-houston', acc);
      if (stored) return stored;
    }
  } catch {}
  // Fallbacks: labeled default, then unlabeled
  const defaultAcc = `github@${host}#default`;
  const storedDefault = await getSecret('archway-houston', defaultAcc);
  if (storedDefault) return storedDefault;
  const stored = await getSecret('archway-houston', `github@${host}`);
  if (stored) return stored;
  throw new Error(
    `GitHub provider requires a token. Run: houston auth login github --host ${host}.`,
  );
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'archway-houston-cli',
  };
}
