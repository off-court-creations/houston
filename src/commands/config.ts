import { Command } from 'commander';
import process from 'node:process';
import { loadConfig } from '../config/config.js';
import { createLogger } from '../logger.js';

const logger = createLogger();

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Inspect resolved CLI configuration')
    .option('-j, --json', 'output as JSON')
    .action((options: { json?: boolean }) => {
      const config = loadConfig();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
        return;
      }
      logger.info(`workspace: ${config.workspaceRoot}`);
      logger.info(`tracking root: ${config.tracking.root}`);
      logger.info(`schema dir: ${config.tracking.schemaDir}`);
      logger.info(`tickets dir: ${config.tracking.ticketsDir}`);
      logger.info(`backlog dir: ${config.tracking.backlogDir}`);
      logger.info(`sprints dir: ${config.tracking.sprintsDir}`);
      logger.info(`generator: ${config.metadata.generator}`);
    });
}
