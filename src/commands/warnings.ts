import { Command } from 'commander';
import { setCompletionsWarningDisabled } from '../services/user-config.js';
import { c } from '../lib/colors.js';

export function registerDisableCompletionsWarningCommand(program: Command): void {
  program
    .command('disable-shell-completions-warning')
    .description('Do not show the shell completions installation reminder')
    .action(() => {
      setCompletionsWarningDisabled(true);
      console.log(c.ok('Disabled shell completions reminder.')); 
      console.log('You can re-enable it by editing ~/.houston/config.toml and setting completions_warning_disabled = false');
    });
}

