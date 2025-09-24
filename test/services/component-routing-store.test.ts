import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadComponentRouting } from '../../src/services/component-routing-store.js';
import { loadConfig } from '../../src/config/config.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/workspace');

let tempDir: string;
const originalCwd = process.cwd;

function setupWorkspace(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houston-routing-'));
  fs.cpSync(FIXTURE_DIR, tempDir, { recursive: true });
}

function teardownWorkspace(): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.cwd = originalCwd;
}

describe('component-routing repo@path parsing', () => {
  beforeEach(() => {
    setupWorkspace();
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    teardownWorkspace();
  });

  it('parses repo@path entries into { repoId, path }', () => {
    const file = path.join(tempDir, 'repos', 'component-routing.yaml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `routes:\n  checkout:\n    - repo.checkout@packages/checkout\n    - repo.web@apps/web\n  payments:\n    - repo.checkout@packages/payments\n    - repo.api@services/payments\n`,
      'utf8',
    );
    const config = loadConfig();
    const routing = loadComponentRouting(config);
    expect(routing.routes.checkout?.[0]).toEqual({ repoId: 'repo.checkout', path: 'packages/checkout' });
    expect(routing.routes.checkout?.[1]).toEqual({ repoId: 'repo.web', path: 'apps/web' });
    expect(routing.routes.payments?.[0]).toEqual({ repoId: 'repo.checkout', path: 'packages/payments' });
    expect(routing.routes.payments?.[1]).toEqual({ repoId: 'repo.api', path: 'services/payments' });
  });
});

