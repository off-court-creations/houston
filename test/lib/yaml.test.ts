import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readYamlFile, writeYamlFile } from '../../src/lib/yaml.js';

let tempDir: string | undefined;

function createTempDir(): string {
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardate-yaml-test-'));
  }
  return tempDir;
}

describe('yaml helpers', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('writes YAML with sorted keys', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'sample.yaml');
    writeYamlFile(file, {
      b: 1,
      a: {
        c: 2,
        b: 1,
      },
    });
    const contents = fs.readFileSync(file, 'utf8');
    expect(contents).toMatchInlineSnapshot(`
"a:\n  b: 1\n  c: 2\nb: 1\n"
`);
  });

  it('reads YAML files', () => {
    const dir = createTempDir();
    const file = path.join(dir, 'sample.yaml');
    fs.writeFileSync(file, 'foo: bar\n');
    const data = readYamlFile<{ foo: string }>(file);
    expect(data.foo).toBe('bar');
  });
});
