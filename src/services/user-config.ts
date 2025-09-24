import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface UserConfig {
  workspace_path?: string;
  completions_warning_disabled?: boolean;
  auth_accounts?: string[];
}

interface Resolution {
  path: string;
  dir: string;
}

function resolveConfigPath(): Resolution {
  const dir = path.join(os.homedir(), '.houston');
  const file = path.join(dir, 'config.toml');
  return { path: file, dir };
}

export function readUserConfig(): UserConfig {
  const { path: file } = resolveConfigPath();
  if (!fs.existsSync(file)) return {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    return parseToml(text);
  } catch {
    return {};
  }
}

export function writeUserConfig(config: UserConfig): void {
  const { path: file, dir } = resolveConfigPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = formatToml(config);
  fs.writeFileSync(file, content, 'utf8');
}

export function setDefaultWorkspaceIfUnset(workspacePath: string): void {
  const cfg = readUserConfig();
  if (!cfg.workspace_path) {
    cfg.workspace_path = workspacePath;
    writeUserConfig(cfg);
  }
}

export function setCompletionsWarningDisabled(disabled: boolean): void {
  const cfg = readUserConfig();
  cfg.completions_warning_disabled = disabled;
  writeUserConfig(cfg);
}

export function ensureUserConfigExists(): void {
  const { path: file, dir } = resolveConfigPath();
  if (fs.existsSync(file)) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const defaults: UserConfig = { completions_warning_disabled: false };
  fs.writeFileSync(file, formatToml(defaults), 'utf8');
}

function parseToml(text: string): UserConfig {
  // Minimal TOML parser for simple key/value pairs.
  const out: UserConfig = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // strip quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key === 'workspace_path') {
      out.workspace_path = value;
    } else if (key === 'completions_warning_disabled') {
      out.completions_warning_disabled = /^true$/i.test(value);
    } else if (key === 'auth_accounts') {
      const list = value.replace(/^"|"$/g, '');
      out.auth_accounts = list
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
  }
  return out;
}

function escapeTomlString(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function formatToml(config: UserConfig): string {
  const lines: string[] = [];
  lines.push('# Houston user configuration');
  if (config.workspace_path) {
    lines.push(`workspace_path = ${escapeTomlString(config.workspace_path)}`);
  }
  if (typeof config.completions_warning_disabled === 'boolean') {
    lines.push(`completions_warning_disabled = ${config.completions_warning_disabled ? 'true' : 'false'}`);
  }
  if (Array.isArray(config.auth_accounts) && config.auth_accounts.length > 0) {
    const joined = config.auth_accounts.join(',');
    lines.push(`auth_accounts = ${escapeTomlString(joined)}`);
  }
  return lines.join('\n') + '\n';
}

export function addAuthAccount(account: string): void {
  const cfg = readUserConfig();
  const set = new Set(cfg.auth_accounts ?? []);
  set.add(account);
  cfg.auth_accounts = Array.from(set.values()).sort();
  writeUserConfig(cfg);
}

export function removeAuthAccount(account: string): void {
  const cfg = readUserConfig();
  const list = new Set(cfg.auth_accounts ?? []);
  if (list.delete(account)) {
    cfg.auth_accounts = Array.from(list.values()).sort();
    writeUserConfig(cfg);
  }
}

export function listAuthAccounts(): string[] {
  const cfg = readUserConfig();
  return cfg.auth_accounts ?? [];
}
