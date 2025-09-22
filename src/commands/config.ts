import { Command } from 'commander';
import process from 'node:process';
import { resolveConfig } from '../config/config.js';
import { createLogger } from '../logger.js';
import { renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';

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
      const summaryRows = [
        [c.bold('Field'), c.bold('Value')],
        ['Workspace', config.workspaceRoot],
        ['Tracking root', config.tracking.root],
        ['Schema dir', config.tracking.schemaDir],
        ['Tickets dir', config.tracking.ticketsDir],
        ['Backlog dir', config.tracking.backlogDir],
        ['Sprints dir', config.tracking.sprintsDir],
        ['Generator', config.metadata.generator],
        ['Version', resolution.version],
      ];
      logger.info(c.heading('Houston Configuration'));
      for (const line of renderBoxTable(summaryRows)) {
        logger.info(line);
      }
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston config\n  $ houston config --json\nNotes:\n  - Run inside a Houston workspace to see resolved tracking paths.\n`,
    );
}
