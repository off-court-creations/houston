#!/usr/bin/env node
import { Command, Option } from 'commander';
import process from 'node:process';
import path from 'node:path';
import { registerCheckCommand } from './commands/check.js';
import { registerConfigCommand } from './commands/config.js';
import { registerVersionCommand } from './commands/version.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerSprintCommand } from './commands/sprint.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerWorkspaceCommand } from './commands/workspace.js';
import { registerUserCommand } from './commands/user.js';
import { registerComponentCommand } from './commands/component.js';
import { registerLabelCommand } from './commands/label.js';
import { registerTicketCommand } from './commands/ticket.js';
import { registerRepoCommand } from './commands/repo.js';
import { registerAuthCommand } from './commands/auth.js';
import { resolveConfig, type CliConfig } from './config/config.js';
import { collectWorkspaceInventory, type WorkspaceInventory } from './services/workspace-inventory.js';

interface Args {
  shell: 'bash' | 'zsh' | 'fish' | 'pwsh';
  cword: number;
  cwd?: string;
  words: string[];
}

function parseCli(argv: string[]): Args {
  // Format: houston-complete --shell bash --cword N [--cwd PATH] -- <words...>
  const args: Partial<Args> = {};
  const sep = argv.indexOf('--');
  const flags = sep === -1 ? argv.slice(2) : argv.slice(2, sep);
  const words = sep === -1 ? [] : argv.slice(sep + 1);
  for (let i = 0; i < flags.length; i += 1) {
    const token = flags[i];
    if (token === '--shell') {
      args.shell = (flags[++i] as Args['shell']) ?? 'bash';
      continue;
    }
    if (token === '--cword') {
      const raw = flags[++i];
      args.cword = raw ? Number.parseInt(raw, 10) : 0;
      continue;
    }
    if (token === '--cwd') {
      args.cwd = flags[++i];
      continue;
    }
  }
  if (!args.shell) args.shell = 'bash';
  if (typeof args.cword !== 'number' || Number.isNaN(args.cword)) args.cword = 0;
  args.words = words;
  return args as Args;
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('houston')
    .description('Git-native ticketing CLI')
    .configureHelp({ sortSubcommands: true, sortOptions: true })
    .option('-v, --verbose', 'enable verbose logging')
    .option('-q, --quiet', 'suppress non-error output')
    .option('--no-interactive', 'disable interactive prompts')
    .option('--no-color', 'disable colored output')
    .option('-C, --chdir <path>', 'change to directory before executing command');

  // Register subcommands (do not parse)
  registerVersionCommand(program, '0.0.0');
  registerConfigCommand(program);
  registerCheckCommand(program);
  registerTicketCommand(program);
  registerBacklogCommand(program);
  registerSprintCommand(program);
  registerRepoCommand(program);
  registerHooksCommand(program);
  registerAuthCommand(program);
  registerWorkspaceCommand(program);
  registerUserCommand(program);
  registerComponentCommand(program);
  registerLabelCommand(program);
  return program;
}

interface ParseState {
  path: string[]; // matched subcommand names
  cmd: Command; // current command context
  pendingOption?: Option; // last option awaiting a value
  consumedArgs: string[]; // non-option tokens not matching a subcommand (arguments)
}

function isOptionToken(token: string): boolean {
  return token.startsWith('-');
}

function optionTakesValue(opt: Option): boolean {
  // commander marks options with value via <arg> or [arg]
  return opt.flags.includes('<') || opt.flags.includes('[');
}

function findSubcommand(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

function findOption(cmd: Command, token: string): Option | undefined {
  const all: Option[] = [...cmd.options, ...cmd.parent?.options ?? []];
  for (const opt of all) {
    if (opt.long && token === opt.long) return opt;
    if (opt.short && token === opt.short) return opt;
    // Support --name=value
    if (opt.long && token.startsWith(opt.long + '=')) return opt;
  }
  return undefined;
}

function parseState(program: Command, words: string[], cword: number): ParseState {
  // words include the command name (houston) as first word.
  const tokens = words.slice(1, Math.max(1, cword));
  let cmd = program;
  const pathSegs: string[] = [];
  const consumedArgs: string[] = [];
  let pendingOption: Option | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!isOptionToken(token)) {
      const sub = findSubcommand(cmd, token);
      if (sub) {
        cmd = sub;
        pathSegs.push(token);
        pendingOption = undefined;
        continue;
      }
      // treat as argument value for current cmd
      consumedArgs.push(token);
      pendingOption = undefined;
      continue;
    }
    // Option token
    const opt = findOption(cmd, token);
    if (!opt) {
      pendingOption = undefined;
      continue;
    }
    if (token.includes('=')) {
      pendingOption = undefined; // value provided inline
      continue;
    }
    if (optionTakesValue(opt)) {
      // If next token is also an option or there is no next token before cword,
      // then this option is pending a value.
      const next = tokens[i + 1];
      if (next === undefined || isOptionToken(next)) {
        pendingOption = opt;
      } else {
        pendingOption = undefined;
        i += 1; // consume value
      }
    } else {
      pendingOption = undefined; // boolean flag
    }
  }

  return { path: pathSegs, cmd, pendingOption, consumedArgs };
}

function currentWord(words: string[], cword: number): string {
  if (cword < 0 || cword >= words.length) return '';
  return words[cword] ?? '';
}

function getConfig(cwd?: string): CliConfig | undefined {
  try {
    const res = resolveConfig({ cwd });
    return res.config;
  } catch {
    return undefined;
  }
}

function getInventory(config?: CliConfig): WorkspaceInventory | undefined {
  try {
    if (!config) return undefined;
    return collectWorkspaceInventory(config);
  } catch {
    return undefined;
  }
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function filterByPrefix(values: string[], prefix: string): string[] {
  if (!prefix) return values;
  return values.filter((v) => v.startsWith(prefix));
}

function applyCommaList(prefixWord: string, candidates: string[]): string[] {
  const idx = prefixWord.lastIndexOf(',');
  if (idx === -1) return candidates; // no comma yet
  const base = prefixWord.slice(0, idx + 1); // include comma
  const frag = prefixWord.slice(idx + 1);
  return candidates
    .filter((c) => c.startsWith(frag))
    .map((c) => base + c);
}

const TESTED_SUBCOMMANDS: Record<string, string[]> = {
  '': ['version', 'config', 'check', 'auth', 'backlog', 'sprint', 'repo', 'workspace', 'user', 'component', 'label', 'ticket'],
  auth: ['login', 'logout', 'status', 'test'],
  backlog: ['plan'],
  sprint: ['new'],
  repo: ['list', 'add'],
  workspace: ['new', 'info'],
  user: ['add', 'info', 'list'],
  component: ['add'],
  label: ['add'],
  ticket: ['new'],
};

function listSubcommandNames(cmd: Command, pathSegs: string[] = []): string[] {
  const names = cmd.commands.map((c) => c.name());
  const key = pathSegs.length === 0 ? '' : pathSegs[pathSegs.length - 1];
  const allowed = TESTED_SUBCOMMANDS[key];
  if (!allowed) return names;
  return names.filter((n) => allowed.includes(n));
}

function listOptionNames(cmd: Command): string[] {
  const opts = new Set<string>();
  for (const opt of cmd.options) {
    if (opt.long) opts.add(opt.long);
    if (opt.short) opts.add(opt.short);
  }
  // include global options from root
  let p: Command | null = cmd;
  while ((p = (p.parent as Command | null))) {
    for (const opt of p.options) {
      if (opt.long) opts.add(opt.long);
      if (opt.short) opts.add(opt.short);
    }
  }
  return Array.from(opts.values()).sort();
}

function suggestForArgument(pathSegs: string[], consumedArgs: string[], cur: string, inventory?: WorkspaceInventory): string[] {
  // Path-specific positional arguments
  // auth login/logout/test <provider>
  if (pathEq(pathSegs, ['auth', 'login']) || pathEq(pathSegs, ['auth', 'logout']) || pathEq(pathSegs, ['auth', 'test'])) {
    return filterByPrefix(['github'], cur);
  }

  // ticket new <type> (limit to tested: epic|story|subtask)
  if (pathEq(pathSegs, ['ticket', 'new']) && consumedArgs.length === 0) {
    const values = ['epic', 'story', 'subtask'];
    return filterByPrefix(values, cur);
  }

  return [];
}

function pathEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function suggestForOptionValue(
  pathSegs: string[],
  opt: Option,
  cur: string,
  consumedArgs: string[],
  inventory?: WorkspaceInventory,
): string[] {
  const name = opt.long || opt.short || '';

  // Normalize inline assignment --opt=value
  let prefixWord = cur;
  if (name && cur.startsWith(name + '=')) {
    prefixWord = cur.slice(name.length + 1);
  }

  const typeArg = pathEq(pathSegs, ['ticket', 'new']) ? (consumedArgs[0] ?? '') : '';

  if (pathEq(pathSegs, ['check']) && (name === '--format' || name === '-f')) {
    return filterByPrefix(['text', 'json'], prefixWord);
  }

  if (pathEq(pathSegs, ['repo', 'add']) && (name === '--provider')) {
    return filterByPrefix(['github', 'gitlab', 'bitbucket'], prefixWord);
  }

  if (pathEq(pathSegs, ['user', 'add']) && name === '--roles') {
    const roles = collectRoles(inventory);
    return applyCommaList(prefixWord, roles);
  }

  if (pathEq(pathSegs, ['user', 'info']) && name === '--id') {
    const ids = inventory?.users ?? [];
    if (process.env.HOUSTON_COMPLETE_DEBUG) {
      process.stderr.write(`[debug] user.info --id inventory.users=${ids.length}\n`);
    }
    return filterByPrefix(ids, prefixWord);
  }

  if (pathEq(pathSegs, ['component', 'add']) && name === '--repos') {
    const repos = (inventory?.repos ?? []).map((r) => r.id);
    return applyCommaList(prefixWord, repos);
  }

  if (pathEq(pathSegs, ['label', 'add']) && (name === '--labels' || name === '--id')) {
    const labels = inventory?.labels ?? [];
    if (name === '--labels') return applyCommaList(prefixWord, labels);
    return filterByPrefix(labels, prefixWord);
  }

  if (pathEq(pathSegs, ['ticket', 'new'])) {
    if (name === '--assignee' || name === '--approvers') {
      const users = inventory?.users ?? [];
      if (name === '--approvers') return applyCommaList(prefixWord, users);
      return filterByPrefix(users, prefixWord);
    }
    if (name === '--components') {
      const comps = inventory?.components ?? [];
      return applyCommaList(prefixWord, comps);
    }
    if (name === '--labels') {
      const labels = inventory?.labels ?? [];
      return applyCommaList(prefixWord, labels);
    }
    if (name === '--priority') {
      if (typeArg === 'epic') return [];
      return filterByPrefix(['P0', 'P1', 'P2', 'P3'], prefixWord);
    }
    if (name === '--parent') {
      const tickets = inventory?.tickets ?? [];
      if (typeArg === 'story') {
        const epics = tickets.filter((t) => t.type === 'epic').map((t) => t.id);
        return filterByPrefix(epics, prefixWord);
      }
      if (typeArg === 'subtask') {
        const stories = tickets.filter((t) => t.type === 'story').map((t) => t.id);
        return filterByPrefix(stories, prefixWord);
      }
      return [];
    }
    if (name === '--status') {
      const map = inventory?.transitions ?? {};
      const allowed = typeArg && map[typeArg] ? map[typeArg] : undefined;
      const suggestions = allowed
        ? uniq([
            ...Object.keys(allowed),
            ...Object.values(allowed).flatMap((list) => list),
          ])
        : [];
      return filterByPrefix(suggestions, prefixWord);
    }
  }

  if (pathEq(pathSegs, ['backlog', 'plan']) && (name === '--assign')) {
    // Suggest sprintId:ticketId[,ticketId]
    const sprints = (inventory?.sprints ?? []).map((s) => s.id);
    const ticketIds = (inventory?.tickets ?? []).map((t) => t.id);
    const colon = prefixWord.indexOf(':');
    if (colon === -1) {
      return filterByPrefix(sprints, prefixWord);
    }
    const base = prefixWord.slice(0, colon + 1);
    const frag = prefixWord.slice(colon + 1);
    const withBase = (id: string) => base + id;
    // After colon, allow comma list of ticket ids
    const merged = applyCommaList(frag, ticketIds).map(withBase);
    return merged;
  }

  return [];
}

function suggest(program: Command, args: Args, config?: CliConfig, inventory?: WorkspaceInventory): string[] {
  const cur = currentWord(args.words, args.cword) || '';
  const state = parseState(program, args.words, args.cword);

  // If we are at the root and current token is mid-typing the first subcommand
  if (state.path.length === 0 && !isOptionToken(cur)) {
    const subs = listSubcommandNames(program, state.path);
    return filterByPrefix(subs, cur);
  }

  // If expecting a positional argument
  if (!isOptionToken(cur)) {
    const posSuggestions = suggestForArgument(state.path, state.consumedArgs, cur, inventory);
    if (posSuggestions.length > 0) return posSuggestions;
  }

  // Option value after an option expecting a value (separate token)
  if (state.pendingOption && !isOptionToken(cur)) {
    const valueSuggestions = suggestForOptionValue(state.path, state.pendingOption, cur, state.consumedArgs, inventory);
    if (valueSuggestions.length > 0) return valueSuggestions;
  }

  // Fallback: previous token is an option expecting a value
  if (!isOptionToken(cur) && args.cword > 0) {
    const prev = args.words[args.cword - 1] ?? '';
    if (isOptionToken(prev)) {
      const prevOpt = findOption(state.cmd, prev);
      if (prevOpt && optionTakesValue(prevOpt)) {
        const valueSuggestions = suggestForOptionValue(state.path, prevOpt, cur, state.consumedArgs, inventory);
        if (valueSuggestions.length > 0) return valueSuggestions;
      }
    }
  }

  // Option with inline assignment --opt=val
  if (isOptionToken(cur)) {
    const opt = findOption(state.cmd, cur);
    if (opt && optionTakesValue(opt) && cur.includes('=')) {
      return suggestForOptionValue(state.path, opt, cur, state.consumedArgs, inventory);
    }
  }

  // If current token looks like an option, suggest option names
  if (cur.startsWith('-')) {
    const optNames = listOptionNames(state.cmd);
    return filterByPrefix(optNames, cur);
  }

  // Otherwise, suggest subcommands from current context
  const subs = listSubcommandNames(state.cmd, state.path);
  if (subs.length > 0) {
    return filterByPrefix(subs, cur);
  }

  // Or options if no subcommands are available
  const optNames = listOptionNames(state.cmd);
  return filterByPrefix(optNames, cur);
}

function collectRoles(inventory?: WorkspaceInventory): string[] {
  if (!inventory) return [];
  const roles = new Set<string>();
  for (const doc of inventory.documents) {
    if (!doc.relativePath.endsWith('people/users.yaml')) continue;
    const data = doc.data as any;
    const users = Array.isArray(data?.users) ? data.users : [];
    for (const u of users) {
      const arr = Array.isArray(u?.roles) ? (u.roles as unknown[]) : [];
      for (const r of arr) {
        if (typeof r === 'string' && r.trim()) roles.add(r);
      }
    }
  }
  return Array.from(roles.values()).sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  // Ensure no interactive prompts from any imported logic
  process.env.HOUSTON_NO_INTERACTIVE = '1';

  const args = parseCli(process.argv);
  if (!args.words || args.words.length === 0) {
    return;
  }
  // Ensure cwd alignment for workspace detection
  const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
  try {
    process.chdir(cwd);
  } catch (e) {
    if (process.env.HOUSTON_COMPLETE_DEBUG) {
      process.stderr.write(`[debug] chdir failed: ${String(e)}\n`);
    }
    // ignore
  }

  const program = buildProgram();
  const config = getConfig(cwd);
  const inventory = getInventory(config);
  if (process.env.HOUSTON_COMPLETE_DEBUG) {
    try {
      const fs = await import('node:fs');
      process.stderr.write(`[debug] cwd=${cwd} cfg=${config ? config.tracking.root : 'none'} inv.users=${inventory ? inventory.users.length : 'n/a'} exists=${fs.existsSync(path.join(cwd, 'houston.config.yaml'))}\n`);
    } catch {
      process.stderr.write(`[debug] cwd=${cwd} cfg=${config ? config.tracking.root : 'none'} inv.users=${inventory ? inventory.users.length : 'n/a'}\n`);
    }
  }
  const suggestions = suggest(program, args, config, inventory);
  if (process.env.HOUSTON_COMPLETE_DEBUG) {
    process.stderr.write(`[debug] words=${JSON.stringify(args.words)} cword=${args.cword} path=${JSON.stringify(parseState(program, args.words, args.cword).path)}\n`);
    const st = parseState(program, args.words, args.cword);
    const p = st.pendingOption ? (st.pendingOption.long || st.pendingOption.short || st.pendingOption.flags) : 'none';
    process.stderr.write(`[debug] pending=${p} cur=${JSON.stringify(currentWord(args.words, args.cword))} consumed=${JSON.stringify(st.consumedArgs)}\n`);
  }
  // Print newline-separated suggestions with no ANSI/styling
  for (const s of suggestions) process.stdout.write(`${s}\n`);
}

await main();
