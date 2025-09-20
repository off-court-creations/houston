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
    .action(async (options: { file?: string; format: 'text' | 'json' }) => {
      const config = loadConfig();
      const logger = createLogger();

      const result = await validateWorkspace({
        config,
        target: options.file,
      });

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
    });
}
