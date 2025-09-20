import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

interface HooksInstallOptions {
  force?: boolean;
  target?: string;
}

export function registerHooksCommand(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Manage git hooks for stardate');

  hooks
    .command('install')
    .description('Install prepare-commit-msg hook for Ticket trailer injection')
    .option('--force', 'overwrite existing hook')
    .option('--target <path>', 'explicit .git directory (defaults to auto-detect)')
    .action(async (options: HooksInstallOptions) => {
      await installHook(options);
    });
}

async function installHook(options: HooksInstallOptions): Promise<void> {
  const gitDir = options.target ? path.resolve(options.target) : findGitDir(process.cwd());
  if (!gitDir) {
    throw new Error('Unable to locate .git directory. Use --target to provide a path.');
  }
  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const source = path.resolve(moduleDir, '../../hooks/prepare-commit-msg');
  const destination = path.join(hooksDir, 'prepare-commit-msg');
  if (fs.existsSync(destination) && !options.force) {
    throw new Error(`Hook already exists at ${destination}. Use --force to overwrite.`);
  }

  const content = fs.readFileSync(source);
  fs.writeFileSync(destination, content, { mode: 0o755 });
  console.log(`Installed prepare-commit-msg hook to ${destination}`);
}

function findGitDir(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, '.git');
    if (fs.existsSync(candidate)) {
      if (fs.statSync(candidate).isFile()) {
        const data = fs.readFileSync(candidate, 'utf8');
        const match = data.match(/^gitdir: (.*)$/m);
        if (match) {
          const resolved = path.resolve(current, match[1].trim());
          return resolved;
        }
      }
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
