#!/usr/bin/env node
import { Command } from 'commander';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerCheckCommand } from './commands/check.js';
import { registerConfigCommand } from './commands/config.js';
import { registerVersionCommand } from './commands/version.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerWorkspaceCommand } from './commands/workspace.js';
import { registerUserCommand } from './commands/user.js';
import { registerComponentCommand } from './commands/component.js';
import { registerLabelCommand } from './commands/label.js';
import { registerTicketCommand } from './commands/ticket.js';
import { registerRepoCommand } from './commands/repo.js';
import { registerAuthCommand } from './commands/auth.js';
import { createLogger } from './logger.js';
import { setEnabled as setColorEnabled } from './lib/colors.js';
import { areCompletionsInstalled, maybeWarnAboutCompletions } from './services/shell-completions.js';
import { ensureUserConfigExists } from './services/user-config.js';
import { registerDisableCompletionsWarningCommand } from './commands/warnings.js';
import { getChangeTypes, clearChangeTypes } from './services/mutation-tracker.js';
import { prePullIfNeeded, autoCommitAndMaybePush, deriveChangeTypesFromStatus } from './services/git-vcs.js';
import { resolveConfig } from './config/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const logger = createLogger();

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('houston')
    .description('Git-native ticketing CLI')
    .configureHelp({
      sortSubcommands: true,
      sortOptions: true,
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston --help\n  $ houston workspace info --json\n  $ houston ticket new story --title "Checkout flow" --assignee user:alice --components web\n  $ houston ticket code start ST-550e8400-e29b-41d4-a716-446655440000 --repo repo.web\n  $ houston sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14\n  $ houston backlog add ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n  $ houston workspace new ./tracking --create-remote org/repo --host github.com --private --push\n\nVCS Behavior:\n  - Pre-pull before mutating commands when clean and upstream exists\n  - Auto-commit and auto-push after changes (push auto-enables with a remote)\n\nEnvironment:\n  HOUSTON_LOG_LEVEL=debug|info|warn|error   Controls logging level\n  HOUSTON_NO_SYNC=1                         Disables pre-pull\n  HOUSTON_GIT_AUTO=0                        Disables auto-commit\n  EDITOR / VISUAL                            Used by 'ticket show --edit'\n`,
    )
    .option('-v, --verbose', 'enable verbose logging')
    .option('-q, --quiet', 'suppress non-error output')
    .option('--no-interactive', 'disable interactive prompts')
    .option('--no-color', 'disable colored output')
    .option('-C, --chdir <path>', 'change to directory before executing command')
    .option('--no-sync', 'skip git pull before mutating commands')
    .option('--push', 'force push after auto-commit (overrides config)')
    .option('--no-push', 'disable push after auto-commit')
    .option('--no-auto-commit', 'disable automatic commit of workspace changes')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.interactive === false) {
        process.env.HOUSTON_NO_INTERACTIVE = '1';
      }
      const baseColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
      setColorEnabled(!opts.noColor && baseColor);
      if (opts.verbose) {
        process.env.HOUSTON_LOG_LEVEL = 'debug';
        logger.setLevel('debug');
        logger.debug('Verbose mode enabled');
      } else if (opts.quiet) {
        process.env.HOUSTON_LOG_LEVEL = 'warn';
        logger.setLevel('warn');
      }
      if (opts.chdir) {
        process.chdir(opts.chdir);
        logger.debug(`Changed working directory to ${process.cwd()}`);
      }
      // Pre-pull only for mutating commands when a workspace is present.
      try {
        if (opts.noSync || process.env.HOUSTON_NO_SYNC === '1') return;
        const commandPath = getCommandPath(thisCommand);
        if (isReadOnlyCommand(commandPath)) return;
        const resolution = resolveConfig({});
        if (!resolution.config) return;
        const cfg = resolution.config;
        if (cfg.git?.autoPull === false) return;
        const rebase = cfg.git?.pullRebase !== false;
        prePullIfNeeded({ cwd: cfg.workspaceRoot, rebase });
      } catch {
        // best effort; do not block command execution
      }
    });
  program.hook('postAction', (thisCommand) => {
    try {
      const opts = thisCommand.optsWithGlobals();
      if (opts.noAutoCommit || process.env.HOUSTON_GIT_AUTO === '0') {
        clearChangeTypes();
        return;
      }
      const resolution = resolveConfig({});
      if (!resolution.config) return;
      const cfg = resolution.config;
      if (cfg.git?.autoCommit === false) {
        clearChangeTypes();
        return;
      }
      const changeTypes = getChangeTypes();
      const useTypes = changeTypes.length > 0 ? changeTypes : deriveChangeTypesFromStatus(cfg, cfg.workspaceRoot);
      if (useTypes.length === 0) {
        clearChangeTypes();
        return;
      }
      let pushPolicy: 'auto' | boolean = cfg.git?.autoPush ?? 'auto';
      if (opts.push === true) pushPolicy = true;
      if (opts.noPush === true) pushPolicy = false;
      const commandPath = getCommandPath(thisCommand);
      autoCommitAndMaybePush({
        cwd: cfg.workspaceRoot,
        trackingRoot: cfg.tracking.root,
        changeTypes: useTypes as any,
        pushPolicy,
        pullRebase: cfg.git?.pullRebase !== false,
        commandPath,
      });
    } catch {
      // best effort; do not block command exit
    } finally {
      clearChangeTypes();
    }
  });

  registerVersionCommand(program, pkg.version);
  registerConfigCommand(program);
  registerCheckCommand(program);
  registerTicketCommand(program);
  registerBacklogCommand(program);
  registerSprintCommand(program);
  registerRepoCommand(program);
  registerHooksCommand(program);
  registerAuthCommand(program);
  registerWorkspaceCommand(program);
  registerUserCommand(program);
  registerComponentCommand(program);
  registerLabelCommand(program);
  registerDisableCompletionsWarningCommand(program);

  const sanitizedArgv = sanitizeArgv(process.argv);

  try {
    try { ensureUserConfigExists(); } catch {}
    // If completions appear to be installed, do not check config or warn.
    const completionsOk = areCompletionsInstalled();
    if (!completionsOk) {
      const distDir = fileURLToPath(new URL('.', import.meta.url));
      const pkgRoot = path.resolve(distDir, '..');
      const completionsDir = path.join(pkgRoot, 'hooks', 'completions');
      await maybeWarnAboutCompletions(program, completionsDir);
    }
    await program.parseAsync(sanitizedArgv);
  } catch (error) {
    logger.error(String(error instanceof Error ? error.message : error));
    if (error instanceof Error && logger.isVerbose()) {
      logger.error(error.stack ?? '');
    }
    process.exitCode = 1;
  }
}

function sanitizeArgv(argv: string[]): string[] {
  if (argv.length <= 3) {
    return argv[2] === '--'
      ? [argv[0], argv[1], ...argv.slice(3)]
      : argv;
  }

  const copy = [...argv];
  if (copy[2] === '--') {
    copy.splice(2, 1);
  }
  return copy;
}

await main();

function getCommandPath(cmd: Command): string {
  const parts: string[] = [];
  let cur: Command | null = cmd as any;
  while (cur) {
    const name = cur.name?.();
    if (name) parts.unshift(name);
    cur = (cur.parent as any) ?? null;
  }
  // drop root program name 'houston'
  if (parts[0] === 'houston') parts.shift();
  return parts.join(' ');
}

function isReadOnlyCommand(path: string): boolean {
  const ro = new Set([
    'workspace info',
    'ticket list',
    'ticket show',
    'ticket preview',
    'check',
    'config',
    'config set default-workspace',
    'config show default-workspace',
    'version',
    'auth status',
    'auth test',
    'hooks install',
    'warnings disable',
  ]);
  return ro.has(path);
}
