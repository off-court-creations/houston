import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { createLogger } from '../logger.js';
import { c } from '../lib/colors.js';
import { readUserConfig } from './user-config.js';

const logger = createLogger();

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | undefined {
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of PATH.split(sep)) {
    const full = path.join(dir, cmd);
    if (fs.existsSync(full) && isExecutable(full)) return full;
    if (process.platform === 'win32') {
      const alt = full + '.cmd';
      if (fs.existsSync(alt) && isExecutable(alt)) return alt;
    }
  }
  return undefined;
}

export function areCompletionsInstalled(): boolean {
  if (process.env.HOUSTON_COMPLETIONS_INSTALLED === '1') return true;
  // Heuristics for common install locations
  const home = os.homedir();
  const wrappers: string[] = [
    // zsh
    path.join(home, '.zsh', 'completions', '_houston'),
    '/usr/local/share/zsh/site-functions/_houston',
    '/opt/homebrew/share/zsh/site-functions/_houston',
    '/usr/share/zsh/site-functions/_houston',
    // bash
    path.join(home, '.local', 'share', 'bash-completion', 'completions', 'houston'),
    '/usr/local/etc/bash_completion.d/houston',
    '/opt/homebrew/etc/bash_completion.d/houston',
    '/etc/bash_completion.d/houston',
  ];
  const wrapperExists = wrappers.some((p) => fs.existsSync(p));
  // Helper binary presence
  const helper = which('houston-complete');
  return Boolean(wrapperExists && helper);
}

export async function maybeWarnAboutCompletions(program: Command, completionsDir: string): Promise<void> {
  // Do not warn in non-TTY contexts, or when quiet mode is requested later.
  if (!process.stdout.isTTY) return;
  // Avoid repeating for completion helper itself
  if (process.argv[1] && /houston-complete(\.\w+)?$/.test(process.argv[1])) return;

  const cfg = readUserConfig();
  if (cfg.completions_warning_disabled === true) return;

  // Prepare brief instructions with packaged paths
  const zshPath = path.join(completionsDir, '_houston');
  const bashPath = path.join(completionsDir, 'houston.bash');

  const lines: string[] = [];
  lines.push(c.warn('Shell completions are not installed for houston.'));
  lines.push('');
  lines.push(c.subheading('Quick setup'));
  lines.push('zsh:');
  lines.push(`  mkdir -p ~/.zsh/completions && cp ${zshPath} ~/.zsh/completions/_houston`);
  lines.push('  echo "fpath+=(~/.zsh/completions)" >> ~/.zshrc');
  lines.push('  autoload -Uz compinit && compinit');
  lines.push('');
  lines.push('bash:');
  lines.push('  mkdir -p ~/.local/share/bash-completion/completions');
  lines.push(`  cp ${bashPath} ~/.local/share/bash-completion/completions/houston`);
  lines.push('  # or: source ~/.local/share/bash-completion/completions/houston');
  lines.push('');
  lines.push(`Disable this reminder: ${c.id('houston disable-shell-completions-warning')}`);
  for (const line of lines) logger.warn(line);
}

