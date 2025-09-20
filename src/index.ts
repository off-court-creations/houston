#!/usr/bin/env node
import { Command } from 'commander';
import process from 'node:process';
import { createRequire } from 'node:module';
import { registerCheckCommand } from './commands/check.js';
import { registerConfigCommand } from './commands/config.js';
import { registerVersionCommand } from './commands/version.js';
import { registerNewCommand } from './commands/new.js';
import { registerDescribeCommand } from './commands/describe.js';
import { registerAssignCommand } from './commands/assign.js';
import { registerStatusCommand } from './commands/status.js';
import { registerLabelCommand } from './commands/label.js';
import { registerLinkCommand } from './commands/link.js';
import { registerBugCommand } from './commands/bug.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerCodeCommand } from './commands/code.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerWorkspaceCommand } from './commands/workspace.js';
import { registerUserCommand } from './commands/user.js';
import { registerComponentCommand } from './commands/component.js';
import { createLogger } from './logger.js';

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
    .option('-C, --chdir <path>', 'change to directory before executing command')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.chdir) {
        process.chdir(opts.chdir);
        logger.debug(`Changed working directory to ${process.cwd()}`);
      }
    });

  registerVersionCommand(program, pkg.version);
  registerConfigCommand(program);
  registerCheckCommand(program);
  registerNewCommand(program);
  registerDescribeCommand(program);
  registerAssignCommand(program);
  registerStatusCommand(program);
  registerLabelCommand(program);
  registerLinkCommand(program);
  registerBugCommand(program);
  registerBacklogCommand(program);
  registerSprintCommand(program);
  registerCodeCommand(program);
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
