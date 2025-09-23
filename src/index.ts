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
      `\nExamples:\n  $ houston --help\n  $ houston workspace info --json\n  $ houston ticket new story --title "Checkout flow" --assignee user:alice --components web\n  $ houston ticket code start ST-550e8400-e29b-41d4-a716-446655440000 --repo repo.web\n  $ houston sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14\n  $ houston backlog add ST-550e8400-e29b-41d4-a716-446655440000 ST-1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f890\n\nEnvironment:\n  HOUSTON_LOG_LEVEL=debug|info|warn|error   Controls logging level\n  EDITOR / VISUAL                            Used by 'ticket show --edit'\n`,
    )
    .option('-v, --verbose', 'enable verbose logging')
    .option('-q, --quiet', 'suppress non-error output')
    .option('--no-interactive', 'disable interactive prompts')
    .option('--no-color', 'disable colored output')
    .option('-C, --chdir <path>', 'change to directory before executing command')
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
