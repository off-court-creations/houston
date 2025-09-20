import fs from 'node:fs';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';

export interface PersonRecord {
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
  [key: string]: unknown;
}

interface PeopleFile {
  users?: PersonRecord[];
}

function resolvePeopleFile(config: CliConfig): string {
  return path.join(config.tracking.root, 'people', 'users.yaml');
}

export function loadPeople(config: CliConfig): PersonRecord[] {
  const file = resolvePeopleFile(config);
  if (!fs.existsSync(file)) {
    return [];
  }
  const data = readYamlFile<PeopleFile>(file);
  const users = Array.isArray(data.users) ? data.users : [];
  return users.filter((entry): entry is PersonRecord => Boolean(entry?.id));
}

export function upsertPerson(config: CliConfig, person: PersonRecord): void {
  const file = resolvePeopleFile(config);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const people = loadPeople(config);
  const existingIndex = people.findIndex((entry) => entry.id === person.id);
  if (existingIndex >= 0) {
    people[existingIndex] = { ...people[existingIndex], ...person };
  } else {
    people.push(person);
  }

  people.sort((a, b) => a.id.localeCompare(b.id));
  writeYamlFile(file, { users: people });
}

export function hasPerson(config: CliConfig, userId: string): boolean {
  return loadPeople(config).some((entry) => entry.id === userId);
}
