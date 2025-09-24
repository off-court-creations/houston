export function normalizeUserId(input: string): string {
  const trimmed = String(input).trim();
  if (/^(user|bot):/.test(trimmed)) return trimmed;
  // Default to user: prefix
  return `user:${trimmed}`;
}

export function stripUserPrefix(input: string): string {
  const m = String(input).match(/^(?:user|bot):(.*)$/);
  return m ? m[1] : String(input);
}

export function isValidUserId(input: string): boolean {
  return /^(user|bot):[a-z0-9_\-]+$/.test(input);
}

