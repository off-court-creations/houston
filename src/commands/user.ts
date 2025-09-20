import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { loadConfig, type CliConfig } from '../config/config.js';
import { promptInput, promptMultiSelect } from '../lib/prompter.js';
import { promptSelect } from '../lib/prompter.js';
import { loadPeople, upsertPerson, hasPerson, type PersonRecord } from '../services/people-store.js';

interface AddUserOptions {
  interactive?: boolean;
  id?: string;
  name?: string;
  email?: string;
  roles?: string;
}

interface UserInfoOptions {
  id?: string;
  json?: boolean;
}

export function registerUserCommand(program: Command): void {
  const user = program.command('user').description('Manage workspace users');

  user
    .command('add')
    .description('Add or update a user in people/users.yaml')
    .option('--id <user:id>', 'user identifier (e.g. user:alice)')
    .option('--name <name>', 'display name')
    .option('--email <email>', 'email address')
    .option('--roles <list>', 'comma separated role list')
    .option('-i, --interactive', 'prompt for fields when omitted')
    .action(async (opts: AddUserOptions) => {
      if (!opts.id && !opts.name && !opts.email && !opts.roles) {
        opts.interactive = true;
      }
      await handleAddUser(opts);
    });

  user
    .command('info')
    .description('Inspect a user from people/users.yaml')
    .option('--id <user:id>', 'user identifier to show')
    .option('-j, --json', 'output as JSON')
    .action(async (opts: UserInfoOptions) => {
      await handleUserInfo(opts);
    });
}

async function handleAddUser(opts: AddUserOptions): Promise<void> {
  const config = loadConfig();
  let resolved = { ...opts };
  const missing = collectMissingUserFields(resolved);

  const requiresPrompt = resolved.interactive || missing.length > 0;
  if (requiresPrompt) {
    const canPrompt = (process.stdin.isTTY && process.stdout.isTTY) || process.env.STARDATE_FORCE_INTERACTIVE === '1';
    if (!canPrompt) {
      throw new Error(`Missing required options: ${missing.join(', ')}. Re-run with --interactive in a terminal.`);
    }
    resolved = await runInteractiveAddUser(resolved, config);
  }

  const remainingMissing = collectMissingUserFields(resolved);
  if (remainingMissing.length > 0) {
    throw new Error(`Missing required options: ${remainingMissing.join(', ')}`);
  }

  const person: PersonRecord = {
    id: resolved.id!,
    name: resolved.name?.trim() || undefined,
    email: resolved.email?.trim() || undefined,
    roles: splitList(resolved.roles),
  };
  if (person.roles?.length === 0) {
    delete person.roles;
  }

  upsertPerson(config, person);

  console.log(`Recorded ${person.id} in ${relativePeoplePath(config)}`);
}

function collectMissingUserFields(opts: AddUserOptions): string[] {
  const missing: string[] = [];
  if (!opts.id) {
    missing.push('--id');
  }
  if (!opts.name) {
    missing.push('--name');
  }
  return missing;
}

async function runInteractiveAddUser(opts: AddUserOptions, config: CliConfig): Promise<AddUserOptions> {
  const people = loadPeople(config);
  const existingIds = new Set(people.map((person) => person.id));
  const next: AddUserOptions = { ...opts };

  const id = await promptInput('User id (e.g. user:alice)', {
    defaultValue: opts.id,
    required: true,
    validate: (value) => (value.trim() === '' ? 'User id is required.' : null),
  });
  next.id = id.trim();

  const existing = people.find((person) => person.id === next.id);
  const defaultName = existing?.name ?? opts.name;
  const name = await promptInput('Display name', {
    defaultValue: defaultName,
    required: true,
    validate: (value) => (value.trim() === '' ? 'Display name is required.' : null),
  });
  next.name = name.trim();

  const email = await promptInput('Email (optional)', {
    defaultValue: existing?.email ?? opts.email ?? '',
    allowEmpty: true,
  });
  next.email = email.trim() === '' ? undefined : email.trim();

  const roles = await promptMultiSelect('Roles (optional)', aggregateRoles(people), {
    defaultValue: splitList(opts.roles ?? existing?.roles?.join(', ')),
    required: false,
    allowEmpty: true,
  });
  if (roles.length > 0) {
    next.roles = roles.join(', ');
  } else {
    next.roles = undefined;
  }

  if (!existingIds.has(next.id!) && !next.email) {
    const followUpEmail = await promptInput('Provide email for new user? (optional)', {
      defaultValue: '',
      allowEmpty: true,
    });
    next.email = followUpEmail.trim() === '' ? undefined : followUpEmail.trim();
  }

  return next;
}

function aggregateRoles(people: PersonRecord[]): string[] {
  const values = new Set<string>();
  for (const person of people) {
    if (!Array.isArray(person.roles)) continue;
    for (const role of person.roles) {
      if (typeof role === 'string' && role.trim() !== '') {
        values.add(role);
      }
    }
  }
  return Array.from(values.values()).sort();
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function relativePeoplePath(config: CliConfig): string {
  return path.relative(process.cwd(), path.join(config.tracking.root, 'people', 'users.yaml'));
}

async function handleUserInfo(opts: UserInfoOptions): Promise<void> {
  const config = loadConfig();
  const people = loadPeople(config);
  if (people.length === 0) {
    console.log('No users defined.');
    return;
  }

  let id = opts.id;
  if (!id) {
    const canPrompt = (process.stdin.isTTY && process.stdout.isTTY) || process.env.STARDATE_FORCE_INTERACTIVE === '1';
    if (!canPrompt) {
      throw new Error('No --id provided and stdin is not interactive.');
    }
    const selection = await promptSelect('Select a user to inspect', people.map((person) => ({
      label: formatPersonSummary(person),
      value: person.id,
    })), {
      allowCustom: false,
    });
    id = selection;
  }

  const person = people.find((entry) => entry.id === id);
  if (!person) {
    throw new Error(`User ${id} not found in people/users.yaml`);
  }

  if (opts.json) {
    console.log(JSON.stringify(person, null, 2));
    return;
  }

  printPerson(person, config);
}

function formatPersonSummary(person: PersonRecord): string {
  const name = person.name ?? '(no name)';
  const email = person.email ? ` ${person.email}` : '';
  return `${person.id} — ${name}${email}`;
}

function printPerson(person: PersonRecord, config: CliConfig): void {
  console.log(`${person.id}`);
  if (person.name) {
    console.log(`  Name  : ${person.name}`);
  }
  if (person.email) {
    console.log(`  Email : ${person.email}`);
  }
  if (Array.isArray(person.roles) && person.roles.length > 0) {
    console.log(`  Roles : ${person.roles.join(', ')}`);
  }
  const extraKeys = Object.keys(person).filter(
    (key) => !['id', 'name', 'email', 'roles'].includes(key) && person[key] !== undefined,
  );
  for (const key of extraKeys) {
    const value = person[key];
    console.log(`  ${key} : ${JSON.stringify(value)}`);
  }
}
