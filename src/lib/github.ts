export function parseOwnerRepo(input: string): { owner: string; repo: string } {
  const idx = input.indexOf('/');
  if (idx <= 0 || idx >= input.length - 1) {
    throw new Error(`Invalid repository: ${input}. Expected owner/repo.`);
  }
  const owner = input.slice(0, idx).trim();
  const repo = input.slice(idx + 1).trim();
  if (!owner || !repo) {
    throw new Error(`Invalid repository: ${input}. Expected owner/repo.`);
  }
  return { owner, repo };
}

export function extractLabelFromAccount(account: string): string | undefined {
  const match = account.match(/^github@[^#]+#(.+)$/);
  return match ? match[1] : undefined;
}

export function formatAccountLabel(account: string): string {
  const m = account.match(/^github@([^#]+)(?:#(.*))?$/);
  if (!m) return account;
  const host = m[1];
  const label = m[2] ?? 'default';
  return `${host} (${label})`;
}
