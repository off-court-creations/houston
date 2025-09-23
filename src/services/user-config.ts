import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface UserConfig {
  workspace_path?: string;
  completions_warning_disabled?: boolean;
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
  return lines.join('\n') + '\n';
}
