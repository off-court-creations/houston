import { Command } from 'commander';
import process from 'node:process';
import { resolveConfig } from '../config/config.js';
import { createLogger } from '../logger.js';

const logger = createLogger();

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Inspect resolved CLI configuration')
    .option('-j, --json', 'output as JSON')
    .action((options: { json?: boolean }) => {
      const resolution = resolveConfig();

      if (options.json) {
        if (!resolution.config) {
          const payload = {
            version: resolution.version,
            workspace: null,
          };
          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
          return;
        }
        process.stdout.write(`${JSON.stringify(resolution.config, null, 2)}\n`);
        return;
      }

      if (!resolution.config) {
        logger.info(`houston version: ${resolution.version}`);
        logger.info('workspace: (not detected)');
        logger.info('Run this command inside a Houston workspace to inspect tracking paths.');
        return;
      }

      const config = resolution.config;
      logger.info(`workspace: ${config.workspaceRoot}`);
      logger.info(`tracking root: ${config.tracking.root}`);
      logger.info(`schema dir: ${config.tracking.schemaDir}`);
      logger.info(`tickets dir: ${config.tracking.ticketsDir}`);
      logger.info(`backlog dir: ${config.tracking.backlogDir}`);
      logger.info(`sprints dir: ${config.tracking.sprintsDir}`);
      logger.info(`generator: ${config.metadata.generator}`);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston config\n  $ houston config --json\nNotes:\n  - Run inside a Houston workspace to see resolved tracking paths.\n`,
    );
}
