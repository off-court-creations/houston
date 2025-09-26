import fetch from 'node-fetch';
import { getSecret, listAccounts as listSecretAccounts } from './secrets.js';
import { parseOwnerRepo } from '../lib/github.js';

export async function createGitHubRepo(
  host: string,
  ownerRepo: string,
  isPrivate: boolean,
  account?: string,
): Promise<string> {
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid value for --create-remote: ${ownerRepo}. Expected owner/repo.`);
  }
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const token = await resolveToken(host, account);
  if (!token) {
    throw new Error(`No stored token for github@${host}. Run: houston auth login github --host ${host}`);
  }

  const payload = { name: repo, private: isPrivate } as Record<string, unknown>;
  const headers = buildHeaders(token);

  let response = await fetch(`${apiBase}/orgs/${owner}/repos`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 404) {
    response = await fetch(`${apiBase}/user/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, name: repo }),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub repo creation failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { ssh_url?: string; clone_url?: string };
  return (data.ssh_url ?? data.clone_url) as string;
}

export async function listGitHubOwners(host: string, account?: string): Promise<Array<{ label: string; value: string }>> {
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const token = await resolveToken(host, account);
  if (!token) return [];

  const headers = buildHeaders(token);
  const out: Array<{ label: string; value: string }> = [];

  try {
    const meRes = await fetch(`${apiBase}/user`, { headers });
    if (meRes.ok) {
      const me = (await meRes.json()) as { login?: string };
      if (me?.login) out.push({ label: `Me (${me.login})`, value: me.login });
    }
  } catch {
    // ignore
  }

  try {
    const orgRes = await fetch(`${apiBase}/user/orgs`, { headers });
    if (orgRes.ok) {
      const orgs = (await orgRes.json()) as Array<{ login?: string }>;
      for (const org of orgs) {
        if (org?.login) out.push({ label: org.login, value: org.login });
      }
    }
  } catch {
    // ignore
  }

  const dedup = new Map<string, string>();
  for (const entry of out) dedup.set(entry.value, entry.label);
  return Array.from(dedup.entries())
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listTrackedGithubAccounts(host: string): Promise<string[]> {
  const accounts = await listSecretAccounts('archway-houston');
  return accounts.filter((acc) => acc === `github@${host}` || acc.startsWith(`github@${host}#`));
}

export function buildGithubOwnerRepo(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

async function resolveToken(host: string, account?: string): Promise<string | undefined> {
  if (account) {
    const value = await getSecret('archway-houston', account);
    return value ?? undefined;
  }
  const defaultLabel = `github@${host}#default`;
  const preferred = await getSecret('archway-houston', defaultLabel);
  if (preferred) return preferred;
  const fallback = await getSecret('archway-houston', `github@${host}`);
  return fallback ?? undefined;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'archway-houston-cli',
  };
}

export function isGithubTokenError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No stored token for github@') || message.includes('(401)');
}

export { parseOwnerRepo };
