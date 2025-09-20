import { Command } from 'commander';

export function registerVersionCommand(program: Command, version: string): void {
  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      process.stdout.write(`${version}\n`);
    });
}
