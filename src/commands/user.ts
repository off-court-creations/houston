import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { loadConfig, type CliConfig } from '../config/config.js';
import { promptText, promptMultiSelect, promptSelect, promptConfirm, canPrompt as canInteractive } from '../lib/interactive.js';
import { loadPeople, upsertPerson, hasPerson, type PersonRecord } from '../services/people-store.js';
import { normalizeUserId, isValidUserId } from '../utils/user-id.js';
import { c } from '../lib/colors.js';
import { renderBoxTable } from '../lib/printer.js';

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
  const user = program
    .command('user')
    .description('Manage workspace users')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston user add --id user:alice --name "Alice" --email alice@example.com\n  $ houston user add --interactive\n  $ houston user info --id user:alice\n`,
    );

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
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston user add --id user:bob --name "Bob"\n  $ houston user add --interactive\nNotes:\n  - When run interactively, prompts for id, name, email, and roles.\n`,
    );

  user
    .command('info')
    .description('Inspect a user from people/users.yaml')
    .option('--id <user:id>', 'user identifier to show')
    .option('-j, --json', 'output as JSON')
    .action(async (opts: UserInfoOptions) => {
      await handleUserInfo(opts);
    })
    .addHelpText('after', `\nExamples:\n  $ houston user info --id user:alice\n  $ houston user info --json --id user:bob\n`);

  user
    .command('list')
    .description('List users from people/users.yaml')
    .action(async () => {
      await handleUserList();
    });
}

async function handleAddUser(opts: AddUserOptions): Promise<void> {
  const config = loadConfig();
  let resolved = { ...opts };
  const missing = collectMissingUserFields(resolved);

  let interactiveSession = Boolean(resolved.interactive || missing.length > 0);
  const okPrompt = canInteractive();

  if (interactiveSession && !okPrompt) {
    throw new Error(`Missing required options: ${missing.join(', ')}. Re-run with --interactive in a terminal.`);
  }

  // Helper to persist a user and print status + list
  const saveAndShow = (record: PersonRecord): void => {
    upsertPerson(config, record);
    console.log(c.ok(`Recorded ${c.id(record.id)} in ${relativePeoplePath(config)}`));
    printAllUsers(config);
  };

  // First entry: either from flags or from interactive prompts
  if (interactiveSession) {
    resolved = await runInteractiveAddUser(resolved, config);
  }

  const remainingMissing = collectMissingUserFields(resolved);
  if (remainingMissing.length > 0) {
    throw new Error(`Missing required options: ${remainingMissing.join(', ')}`);
  }

  const firstPerson: PersonRecord = {
    id: normalizeUserId(resolved.id!),
    name: resolved.name?.trim() || undefined,
    email: resolved.email?.trim() || undefined,
    roles: splitList(resolved.roles),
  };
  if (firstPerson.roles?.length === 0) {
    delete firstPerson.roles;
  }

  saveAndShow(firstPerson);

  // If interactive, offer to add more users in a loop
  if (interactiveSession && okPrompt) {
    while (true) {
      const again = await promptConfirm('Add another user?', false);
      if (!again) {
        break;
      }
      const next = await runInteractiveAddUser({}, config);
      const person: PersonRecord = {
        id: normalizeUserId(next.id!),
        name: next.name?.trim() || undefined,
        email: next.email?.trim() || undefined,
        roles: splitList(next.roles),
      };
      if (person.roles?.length === 0) {
        delete person.roles;
      }
      saveAndShow(person);
    }
  }
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

  const id = await promptText('User id (e.g. user:alice)', {
    defaultValue: opts.id,
    required: true,
    validate: (value) => {
      const v = String(value).trim();
      const normalized = normalizeUserId(v);
      return isValidUserId(normalized) ? null : 'Use letters, digits, underscore, hyphen';
    },
  });
  next.id = normalizeUserId(id);

  const existing = people.find((person) => person.id === next.id);
  const defaultName = existing?.name ?? opts.name;
  const name = await promptText('Display name', {
    defaultValue: defaultName,
    required: true,
    validate: (value) => (value.trim() === '' ? 'Display name is required.' : null),
  });
  next.name = name.trim();

  const email = await promptText('Email (optional)', {
    defaultValue: existing?.email ?? opts.email ?? '',
    allowEmpty: true,
  });
  next.email = email.trim() === '' ? undefined : email.trim();

  const defaultRoles = splitList(opts.roles ?? existing?.roles?.join(', '));
  const roleChoices = Array.from(new Set([...aggregateRoles(people), ...defaultRoles])).sort((a, b) =>
    a.localeCompare(b),
  );

  const selectedRoles = roleChoices.length > 0
    ? await promptMultiSelect('Roles (optional)', roleChoices, {
        defaultValue: defaultRoles,
        required: false,
        allowEmpty: true,
      })
    : [...defaultRoles];

  const rolePrompt = roleChoices.length > 0
    ? 'Add roles (comma separated, optional)'
    : 'Roles (comma separated, optional)';
  const newRoleInput = await promptText(rolePrompt, {
    defaultValue: '',
  });
  const additionalRoles = splitList(newRoleInput);

  const allRoles: string[] = [];
  const seen = new Set<string>();
  for (const role of [...selectedRoles, ...additionalRoles]) {
    const value = role.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    allRoles.push(value);
  }
  next.roles = allRoles.length > 0 ? allRoles.join(', ') : undefined;

  if (!existingIds.has(next.id!) && !next.email) {
    const followUpEmail = await promptText('Provide email for new user? (optional)', {
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
    if (!canInteractive()) {
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

  printPerson(person);
}

function formatPersonSummary(person: PersonRecord): string {
  const name = person.name ?? '(no name)';
  return `${person.id} — ${name}`;
}

function printPerson(person: PersonRecord): void {
  console.log(`${c.id(person.id)} — ${person.name ?? '(no name)'}`);

  const rows: string[][] = [];
  if (person.email) {
    rows.push(['Email', person.email]);
  }
  if (Array.isArray(person.roles) && person.roles.length > 0) {
    rows.push(['Roles', person.roles.join(', ')]);
  }
  const extraKeys = Object.keys(person).filter(
    (key) => !['id', 'name', 'email', 'roles'].includes(key) && person[key] !== undefined,
  );
  for (const key of extraKeys) {
    const value = person[key];
    rows.push([key, JSON.stringify(value)]);
  }

  if (rows.length === 0) {
    return;
  }

  const renderedRows = renderBoxTable(rows);
  for (const line of renderedRows) {
    console.log(line);
  }
}

function printAllUsers(config: CliConfig): void {
  const people = loadPeople(config);
  if (people.length === 0) {
    console.log('No users defined.');
    return;
  }
  console.log(c.heading('Current users:'));
  const sorted = people.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const person of sorted) {
    console.log(`  ${c.id(person.id)} — ${person.name ?? '(no name)'}`);
  }
}


async function handleUserList(): Promise<void> {
  const config = loadConfig();
  const people = loadPeople(config);
  if (people.length === 0) {
    console.log('No users defined.');
    return;
  }
  const sorted = people.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const person of sorted) {
    console.log(`${c.id(person.id)} — ${person.name ?? '(no name)'}`);
  }
}
