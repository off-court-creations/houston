import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { deepSortObject } from '../utils/object.js';

export interface WriteYamlOptions {
  sortKeys?: boolean;
}

export function readYamlFile<T = unknown>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(content) as T;
}

export function writeYamlFile(filePath: string, data: unknown, options: WriteYamlOptions = {}): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  const payload = options.sortKeys === false ? data : deepSortObject(data);
  const yamlString = YAML.stringify(payload, {
    indent: 2,
    lineWidth: 0,
  });
  fs.writeFileSync(filePath, ensureTrailingNewline(yamlString), 'utf8');
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}
