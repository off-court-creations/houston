import { Command } from 'commander';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config/config.js';
import { resolveTicketPaths } from '../services/path-resolver.js';
import { readYamlFile } from '../lib/yaml.js';
import YAML from 'yaml';

export interface DescribeOptions {
  edit?: boolean;
  file?: 'ticket' | 'description';
}

export function registerDescribeCommand(program: Command): void {
  program
    .command('describe')
    .description('Show ticket details (optionally open in editor)')
    .argument('<ticketId>')
    .option('--edit', 'open editor for the selected file')
    .option('--file <target>', 'target file to edit (ticket|description)', 'description')
    .action(async (ticketId: string, options: DescribeOptions) => {
      await handleDescribe(ticketId, options);
    });
}

export async function handleDescribe(ticketId: string, options: DescribeOptions): Promise<void> {
  const config = loadConfig();
  const paths = resolveTicketPaths(config, ticketId);
  if (options.edit) {
    const target = options.file === 'ticket' ? paths.ticketFile : paths.descriptionFile;
    const editor = process.env.EDITOR ?? process.env.VISUAL;
    if (!editor) {
      throw new Error('EDITOR environment variable not set');
    }
    const result = spawnSync(editor, [target], { stdio: 'inherit' });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
    }
    return;
  }

  const data = readYamlFile(paths.ticketFile);
  const serialized = YAML.stringify(data);
  process.stdout.write(serialized.endsWith('\n') ? serialized : `${serialized}\n`);
}
