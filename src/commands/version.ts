import figlet from 'figlet';
import { Command } from 'commander';

export function registerVersionCommand(program: Command, version: string): void {
  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      let banner: string;

      try {
        banner = figlet.textSync(version);
      } catch {
        banner = version;
      }

      process.stdout.write(`${banner}\n`);

      if (banner !== version) {
        process.stdout.write(`${version}\n`);
      }
    });
}
