import { Command } from 'commander';
import process from 'node:process';
import fetch from 'node-fetch';
import { canPrompt, promptSecret, promptText, promptConfirm } from '../lib/interactive.js';
import { getSecret, setSecret, deleteSecret, listAccounts, backendName } from '../services/secrets.js';
import { addAuthAccount, removeAuthAccount, listAuthAccounts } from '../services/user-config.js';
import { c } from '../lib/colors.js';
import { renderBoxTable } from '../lib/printer.js';

const SERVICE = 'archway-houston';

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage provider authentication (secure token storage)')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston auth login github\n  $ houston auth status\n  $ houston auth logout github --host github.com\n`,
    );

  auth
    .command('login')
    .description('Login to a provider and store token securely')
    .argument('<provider>', 'provider (github)')
    .option('--host <host>', 'host (default: github.com)')
    .option('--label <label>', 'account label (e.g., work, hobby). Default: default')
    .option('--token <token>', 'token (omit to prompt)')
    .option('--no-validate', 'skip validation request')
    .action(async (provider: string, opts: { host?: string; label?: string; token?: string; validate?: boolean }) => {
      if (provider !== 'github') throw new Error('Only github is supported currently');
      let host = (opts.host ?? '').trim();
      if (!host) {
        host = canPrompt()
          ? (await promptText('GitHub host', { defaultValue: 'github.com', required: true })).trim()
          : 'github.com';
      }
      let label = (opts.label ?? '').trim();
      if (!label) {
        if (canPrompt()) {
          label = (await promptText('Account label (e.g., work, hobby)', { defaultValue: 'default', required: true })).trim();
        } else {
          label = 'default';
        }
      }
      // Overwrite guard for existing labeled account
      let accountLabel = label;
      while (true) {
        const accounts = await listAccounts(SERVICE);
        const exists = accounts.includes(`github@${host}#${accountLabel}`);
        if (!exists) break;
        if (!canPrompt()) {
          throw new Error(`Account github@${host}#${accountLabel} already exists. Use a different --label or run: houston auth logout github --host ${host} --label ${accountLabel}`);
        }
        const overwrite = await promptConfirm(`Account github@${host}#${accountLabel} exists. Overwrite token?`, false);
        if (overwrite) break;
        accountLabel = (await promptText('New account label', { defaultValue: accountLabel, required: true })).trim();
      }
      label = accountLabel;
      let token = opts.token;
      if (!token) {
        if (!canPrompt()) throw new Error('No token provided and not interactive. Use --token.');
        token = await promptSecret('GitHub Personal Access Token');
      }
      token = token.trim();
      if (!token) throw new Error('Empty token');

      if (opts.validate !== false) {
        await validateGithubToken(host, token);
      }
      const account = `github@${host}#${label}`;
      await setSecret(SERVICE, account, token);
      try { addAuthAccount(account); } catch {}
      console.log(c.ok(`Stored token for ${c.id(account)} using ${await backendName()}`));
    });

  auth
    .command('logout')
    .description('Remove stored token for a provider')
    .argument('<provider>', 'provider (github)')
    .option('--host <host>', 'host (default: github.com)')
    .option('--label <label>', 'account label (default)')
    .action(async (provider: string, opts: { host?: string; label?: string }) => {
      if (provider !== 'github') throw new Error('Only github is supported currently');
      const host = (opts.host ?? 'github.com').trim();
      const account = opts.label ? `github@${host}#${opts.label.trim()}` : `github@${host}#default`;
      const ok = await deleteSecret(SERVICE, account);
      if (ok) {
        try { removeAuthAccount(account); } catch {}
      }
      console.log(ok ? c.ok(`Removed token for ${c.id(account)}`) : `No token found for ${account}`);
    });

  auth
    .command('status')
    .description('Show auth status (stored accounts)')
    .option('-j, --json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const accounts = await listAccounts(SERVICE);
      const tracked = listAuthAccounts();
      const payload = { backend: await backendName(), accounts, tracked };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      const summaryRows = [
        [c.bold('Field'), c.bold('Value')],
        ['Backend', payload.backend],
        ['Stored tokens', accounts.length.toString()],
        ['Tracked in config', (tracked?.length ?? 0).toString()],
      ];
      console.log(c.heading('Auth Status'));
      for (const line of renderBoxTable(summaryRows)) console.log(line);

      if (accounts.length === 0) {
        console.log('');
        console.log(c.warn('No stored tokens. Run `houston auth login github` to add one.'));
        return;
      }

      const accountRows = [[c.bold('Account'), c.bold('Host')]];
      for (const account of accounts) {
        const [provider, host] = account.split('@');
        accountRows.push([c.id(account), host ?? provider ?? '' ]);
      }
      console.log('');
      console.log(c.subheading('Stored Accounts'));
      for (const line of renderBoxTable(accountRows)) console.log(line);

      if (tracked.length > 0) {
        const trackedRows = [[c.bold('Account'), c.bold('Host')]];
        for (const account of tracked) {
          const [provider, host] = account.split('@');
          trackedRows.push([c.id(account), host ?? provider ?? '' ]);
        }
        console.log('');
        console.log(c.subheading('Tracked In Config'));
        for (const line of renderBoxTable(trackedRows)) console.log(line);
      }
    });

  auth
    .command('test')
    .description('Test stored credentials for a provider (no side effects)')
    .argument('<provider>', 'provider (github)')
    .option('--host <host>', 'host (default: github.com)')
    .option('--label <label>', 'account label (default)')
    .option('-j, --json', 'output as JSON')
    .action(async (provider: string, opts: { host?: string; label?: string; json?: boolean }) => {
      if (provider !== 'github') throw new Error('Only github is supported currently');
      const host = (opts.host ?? 'github.com').trim();
      const account = opts.label ? `github@${host}#${opts.label.trim()}` : `github@${host}#default`;
      const token = await getSecret(SERVICE, account);
      if (!token) {
        throw new Error(`No stored token for ${account}. Run: houston auth login github --host ${host}`);
      }
      const api = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
      const res = await fetch(`${api}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'archway-houston-cli',
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Token test failed for ${host} (${res.status}): ${text}`);
      }
      let user: any = {};
      try { user = JSON.parse(text); } catch {}
      const scopes = res.headers.get('x-oauth-scopes') || undefined;
      const payload = {
        provider: 'github',
        host,
        ok: true,
        user: user?.login ? { login: user.login, id: user.id, type: user.type } : undefined,
        scopes,
      };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(c.ok(`GitHub token is valid for ${c.id(user?.login ?? '(unknown)')} on ${host}`));
      if (scopes) console.log(`Scopes: ${scopes}`);
    });

  // migrate command removed: secure store is the single source of truth now.
}

async function validateGithubToken(host: string, token: string): Promise<void> {
  const api = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const res = await fetch(`${api}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'archway-houston-cli',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token validation failed for ${host} (${res.status}): ${text}`);
  }
}
