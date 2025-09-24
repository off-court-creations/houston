import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import process from 'node:process';
import { resolveConfig } from '../config/config.js';
import { createLogger } from '../logger.js';
import { renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import { setDefaultWorkspace, readUserConfig } from '../services/user-config.js';

const logger = createLogger();

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Inspect and update CLI configuration')
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
      `\nExamples:\n  $ houston config\n  $ houston config --json\n  $ houston config set default-workspace .\n  $ houston config show default-workspace\nNotes:\n  - Run inside a Houston workspace to see resolved tracking paths.\n  - Use 'config set default-workspace' to set the fallback when outside a workspace.\n  - Use 'config show default-workspace' to print the current default.\n`,
    );

  // config set default-workspace [directory]
  const set = config.command('set').description('Update Houston user configuration');
  set
    .command('default-workspace')
    .description('Set default workspace directory used outside workspaces')
    .argument('[directory]', 'path to workspace root (defaults to current directory)')
    .action((directory?: string) => {
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error(`Path not found or not a directory: ${targetDir}`);
      }
      const yaml = path.join(targetDir, 'houston.config.yaml');
      const yml = path.join(targetDir, 'houston.config.yml');
      if (!fs.existsSync(yaml) && !fs.existsSync(yml)) {
        throw new Error(`No Houston workspace config found in ${targetDir} (expected houston.config.yaml|yml).`);
      }
      const resolvedRoot = fs.realpathSync(targetDir);
      setDefaultWorkspace(resolvedRoot);
      process.stdout.write(`${c.ok(`Default workspace set to ${resolvedRoot}`)}\n`);
    });

  // config show default-workspace
  const show = config.command('show').description('Show Houston user configuration');
  show
    .command('default-workspace')
    .description('Show default workspace directory')
    .option('-j, --json', 'output as JSON')
    .action((options: { json?: boolean }) => {
      const u = readUserConfig();
      const value = u.workspace_path ?? null;
      if (options.json) {
        const payload = { workspace_path: value };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      if (value) {
        process.stdout.write(`${value}\n`);
      } else {
        logger.info('Default workspace is not set.');
      }
    });
}
