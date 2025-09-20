#!/usr/bin/env node
import { Command } from 'commander';
import process from 'node:process';
import { createRequire } from 'node:module';
import { registerCheckCommand } from './commands/check.js';
import { registerConfigCommand } from './commands/config.js';
import { registerVersionCommand } from './commands/version.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerWorkspaceCommand } from './commands/workspace.js';
import { registerUserCommand } from './commands/user.js';
import { registerComponentCommand } from './commands/component.js';
import { registerTicketCommand } from './commands/ticket.js';
import { registerRepoCommand } from './commands/repo.js';
import { createLogger } from './logger.js';
import { setEnabled as setColorEnabled } from './lib/colors.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const logger = createLogger();

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('stardate')
    .description('Git-native ticketing CLI')
    .configureHelp({
      sortSubcommands: true,
      sortOptions: true,
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate --help\n  $ stardate workspace info --json\n  $ stardate ticket new story --title "Checkout flow" --assignee user:alice --components web\n  $ stardate ticket code start ST-123 --repo repo.web\n  $ stardate sprint new --name "Sprint 42" --start 2025-10-01 --end 2025-10-14\n  $ stardate backlog add ST-123 ST-124\n\nEnvironment:\n  STARDATE_LOG_LEVEL=debug|info|warn|error   Controls logging level\n  STARDATE_GITHUB_TOKEN                      Token for GitHub provider (or GITHUB_TOKEN/GH_TOKEN)\n  EDITOR / VISUAL                            Used by 'ticket show --edit'\n`,
    )
    .option('-v, --verbose', 'enable verbose logging')
    .option('-q, --quiet', 'suppress non-error output')
    .option('--no-interactive', 'disable interactive prompts')
    .option('--no-color', 'disable colored output')
    .option('-C, --chdir <path>', 'change to directory before executing command')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.interactive === false) {
        process.env.STARDATE_NO_INTERACTIVE = '1';
      }
      const baseColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
      setColorEnabled(!opts.noColor && baseColor);
      if (opts.verbose) {
        process.env.STARDATE_LOG_LEVEL = 'debug';
        logger.setLevel('debug');
        logger.debug('Verbose mode enabled');
      } else if (opts.quiet) {
        process.env.STARDATE_LOG_LEVEL = 'warn';
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
  registerWorkspaceCommand(program);
  registerUserCommand(program);
  registerComponentCommand(program);

  const sanitizedArgv = sanitizeArgv(process.argv);

  try {
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
