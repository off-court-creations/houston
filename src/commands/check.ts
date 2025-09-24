import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createLogger } from '../logger.js';
import { validateWorkspace } from '../services/workspace-validator.js';

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Run schema validations against the tracking repository')
    .option('-f, --file <path>', 'validate a specific file instead of the entire workspace')
    .option('--format <format>', 'output format: text|json', 'text')
    .option('--fix', 'attempt to auto-fix common issues (user ids, due dates)')
    .action(async (options: { file?: string; format: 'text' | 'json'; fix?: boolean }) => {
      const config = loadConfig();
      const logger = createLogger();

      let result = await validateWorkspace({
        config,
        target: options.file,
      });

      if (options.fix && result.errors.length > 0) {
        const { autoFixWorkspace } = await import('../services/workspace-fixer.js');
        const fixResult = await autoFixWorkspace({ config, target: options.file });
        if (fixResult.ticketsFixed > 0) {
          logger.info(`Auto-fixed ${fixResult.ticketsFixed} ticket(s). Re-running validation...`);
          result = await validateWorkspace({ config, target: options.file });
        } else {
          logger.info('No auto-fixable issues found.');
        }
      }

      if (options.format === 'json') {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.errors.length === 0) {
        logger.info('All validations passed.');
        return;
      }

      logger.error('Validation failed:');
      for (const error of result.errors) {
        logger.error(`- [${error.rule}] ${error.message}`);
      }
      process.exitCode = 1;
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston check\n  $ houston check --fix\n  $ houston check --format json\n  $ houston check --file tickets/STORY/ST-550e8400-e29b-41d4-a716-446655440000/ticket.yaml\n`,
    );
}
