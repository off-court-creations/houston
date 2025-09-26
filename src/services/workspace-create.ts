import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fetch from 'node-fetch';

import { writeYamlFile, readYamlFile } from '../lib/yaml.js';
import { setDefaultWorkspaceIfUnset } from './user-config.js';
import { getSecret } from './secrets.js';

/**
 * Programmatic workspace creation service.
 * Mirrors the non-interactive CLI behavior in `workspace new`.
 */

export interface WorkspaceCreateOptions {
  directory: string; // absolute or relative to current working directory
  force?: boolean;
  git?: boolean; // default true
  remote?: string; // existing remote URL to set as origin
  createRemote?: string; // owner/repo to create on GitHub
  host?: string; // GitHub host (default: github.com)
  private?: boolean; // kept for arg parity (public=false)
  public?: boolean; // when true, create remote repo as public
  push?: boolean; // when undefined, defaults to auto when remote exists
  authLabel?: string; // label to persist in houston.config.yaml (github auth)
}

export interface WorkspaceCreateResult {
  workspaceRoot: string;
  gitInitialized: boolean;
  remoteUrl?: string;
  pushed: boolean;
  createdRemote?: string; // owner/repo if created
  messages: string[];
}

const WORKSPACE_GENERATOR = 'houston@workspace-create';
const IGNORED_DIRECTORY_ENTRIES = new Set([
  '.',
  '..',
  '.git',
  '.gitignore',
  '.gitattributes',
  '.DS_Store',
]);

const FILE_TEMPLATES: Array<[string, string]> = [
  [
    'houston.config.yaml',
    `tracking:\n  root: .\n  schemaDir: schema\n  ticketsDir: tickets\n  backlogDir: backlog\n  sprintsDir: sprints\n\ngit:\n  autoCommit: true\n  autoPush: auto\n  autoPull: true\n  pullRebase: true\n\n# auth:\n#   github:\n#     host: github.com\n#     label: default\n`,
  ],
  [
    'backlog/backlog.yaml',
    `ordered: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'backlog/next-sprint-candidates.yaml',
    `candidates: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  ['repos/repos.yaml', `repos: []\n`],
  [
    'repos/component-routing.yaml',
    `routes: {}\ndefaults:\n  epic: []\n  story: []\n  subtask: []\n  bug: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  ['people/users.yaml', `users: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`],
  ['taxonomies/components.yaml', `components: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`],
  ['taxonomies/labels.yaml', `labels: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`],
  [
    'transitions.yaml',
    `allowed:\n  epic:\n    Backlog: ["Ready", "Canceled", "Archived"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["In Progress", "Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  story:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["In Progress", "Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  subtask:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\n  bug:\n    Backlog: ["Ready", "Canceled"]\n    Ready: ["In Progress", "Canceled"]\n    In Progress: ["Blocked", "In Review", "Canceled"]\n    Blocked: ["In Progress", "In Review", "Canceled"]\n    In Review: ["Done", "Canceled"]\n    Done: ["Archived"]\n    Archived: []\n    Canceled: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'schema/README.md',
    '# Workspace Schemas\n\nRun `houston schemas` to generate the JSON schema files from the CLI.\n',
  ],
  [
    'tickets/README.md',
    '# Tickets\n\nOrganize ticket directories by type (EPIC/STORY/SUBTASK/BUG). Each ticket should contain `ticket.yaml` and `history.ndjson`.\n',
  ],
  ['sprints/README.md', '# Sprints\n\nPlace sprint shells here (e.g. `S-123e4567-e89b-42d3-a456-426614174000/sprint.yaml`).\n'],
];

const GITKEEP_PATHS = [
  'tickets/EPIC/.gitkeep',
  'tickets/STORY/.gitkeep',
  'tickets/SUBTASK/.gitkeep',
  'tickets/BUG/.gitkeep',
  'sprints/.gitkeep',
  'schema/.gitkeep',
];

export async function createWorkspace(options: WorkspaceCreateOptions): Promise<WorkspaceCreateResult> {
  const messages: string[] = [];
  const targetDir = path.resolve(process.cwd(), options.directory ?? '.');
  ensureDirectory(targetDir);
  if (!options.force && hasMeaningfulEntries(targetDir)) {
    throw new Error(`Target directory ${targetDir} is not empty. Use --force to continue.`);
  }

  scaffoldWorkspace(targetDir, options.force === true);
  messages.push(`Scaffolded workspace at ${targetDir}`);

  let gitInitialized = false;
  let remoteUrl: string | undefined;
  let pushed = false;
  let createdRemote: string | undefined;

  if (options.git !== false) {
    initGitRepository(targetDir);
    gitInitialized = true;
    try {
      copyBundledSchemas(path.join(targetDir, 'schema'));
    } catch {
      // non-fatal; schema copy is best-effort
    }
    createInitialCommit(targetDir);

    if (options.remote) {
      setRemoteOrigin(targetDir, options.remote);
      remoteUrl = options.remote;
      if (options.authLabel) {
        const host = (options.host ?? 'github.com').trim();
        const account = `github@${host}#${options.authLabel.trim()}`;
        try {
          upsertWorkspaceAuth(targetDir, { provider: 'github', host, account });
        } catch {
          // ignore persistence errors
        }
      }
    } else if (options.createRemote) {
      const host = (options.host ?? 'github.com').trim();
      const isPrivate = options.public ? false : true;
      const account = options.authLabel ? `github@${host}#${options.authLabel.trim()}` : undefined;
      const url = await createGitHubRepoFromArg(host, options.createRemote, isPrivate, account);
      setRemoteOrigin(targetDir, url);
      remoteUrl = url;
      createdRemote = options.createRemote;
      if (account) {
        try {
          upsertWorkspaceAuth(targetDir, { provider: 'github', host, account });
        } catch {
          // ignore persistence errors
        }
      }
      const shouldPush = resolveInitialPushDecision(targetDir, options);
      if (shouldPush) {
        pushInitial(targetDir);
        pushed = true;
      }
    }

    // If remote was provided, decide on push
    if (!pushed) {
      const shouldPush = resolveInitialPushDecision(targetDir, options);
      if (shouldPush) {
        pushInitial(targetDir);
        pushed = true;
      }
    }
  }

  try {
    setDefaultWorkspaceIfUnset(targetDir);
  } catch {
    // optional
  }

  return {
    workspaceRoot: targetDir,
    gitInitialized,
    remoteUrl,
    pushed,
    createdRemote,
    messages,
  };
}

function ensureDirectory(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    return;
  }
  const stats = fs.statSync(targetDir);
  if (!stats.isDirectory()) {
    throw new Error(`Target ${targetDir} exists and is not a directory.`);
  }
}

function hasMeaningfulEntries(targetDir: string): boolean {
  if (!fs.existsSync(targetDir)) return false;
  try {
    const entries = fs.readdirSync(targetDir);
    return entries.some((e) => !IGNORED_DIRECTORY_ENTRIES.has(e));
  } catch {
    return false;
  }
}

function scaffoldWorkspace(targetDir: string, force: boolean): void {
  const directories = [
    'schema',
    'tickets',
    'tickets/EPIC',
    'tickets/STORY',
    'tickets/SUBTASK',
    'tickets/BUG',
    'backlog',
    'sprints',
    'repos',
    'people',
    'taxonomies',
  ];
  for (const dir of directories) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }
  for (const [relativePath, content] of FILE_TEMPLATES) {
    writeTemplateFile(targetDir, relativePath, content, force);
  }
  for (const gitkeep of GITKEEP_PATHS) {
    writeTemplateFile(targetDir, gitkeep, '', force);
  }
}

function writeTemplateFile(targetDir: string, relativePath: string, content: string, force: boolean): void {
  const destination = path.join(targetDir, relativePath);
  if (fs.existsSync(destination) && !force) {
    throw new Error(`File ${destination} already exists. Use --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const normalized = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
  fs.writeFileSync(destination, normalized, 'utf8');
}

function copyBundledSchemas(destSchemaDir: string): void {
  const here = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
  const candidates = [
    path.resolve(here, '../../schema'),
    path.resolve(here, '../schema'),
  ];
  let sourceDir: string | undefined;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      sourceDir = c;
      break;
    }
  }
  if (!sourceDir) return;
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.schema.json'));
  fs.mkdirSync(destSchemaDir, { recursive: true });
  for (const file of files) {
    const src = path.join(sourceDir, file);
    const dst = path.join(destSchemaDir, file);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
  }
}

function initGitRepository(targetDir: string): void {
  const initArgs = ['init', '--initial-branch=main'];
  let result = spawnSync('git', initArgs, { cwd: targetDir, stdio: 'inherit' });
  if (result.error) throw new Error(`Failed to run git: ${result.error.message}`);

  if (typeof result.status === 'number' && result.status !== 0) {
    result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'inherit' });
    if (result.error) throw new Error(`Failed to run git: ${result.error.message}`);
    if (typeof result.status === 'number' && result.status !== 0) throw new Error('git init failed');

    const branchResult = spawnSync('git', ['checkout', '-b', 'main'], { cwd: targetDir, stdio: 'inherit' });
    if (branchResult.error) throw new Error(`Failed to create main branch: ${branchResult.error.message}`);
    if (typeof branchResult.status === 'number' && branchResult.status !== 0) throw new Error('Unable to set default branch to main');
  }
}

function createInitialCommit(targetDir: string): void {
  spawnSync('git', ['add', '-A', '--', '.'], { cwd: targetDir, stdio: 'inherit' });
  const res = spawnSync('git', ['commit', '-m', 'houston: initialize workspace'], { cwd: targetDir, stdio: 'inherit' });
  if (res.error) throw new Error(`Failed to create initial commit: ${res.error.message}`);
}

function setRemoteOrigin(targetDir: string, url: string): void {
  const hasRemote = spawnSync('git', ['remote'], { cwd: targetDir, encoding: 'utf8' });
  if (hasRemote.error) return;
  const list = (hasRemote.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!list.includes('origin')) {
    const addRes = spawnSync('git', ['remote', 'add', 'origin', url], { cwd: targetDir, stdio: 'inherit' });
    if (addRes.error) throw new Error(`Failed to add remote: ${addRes.error.message}`);
  } else {
    spawnSync('git', ['remote', 'set-url', 'origin', url], { cwd: targetDir, stdio: 'inherit' });
  }
}

function pushInitial(targetDir: string): void {
  const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: targetDir });
  if (typeof upstream.status === 'number' && upstream.status === 0) {
    spawnSync('git', ['push'], { cwd: targetDir, stdio: 'inherit' });
    return;
  }
  const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetDir, encoding: 'utf8' });
  const branch = (branchRes.stdout ?? 'main').trim() || 'main';
  spawnSync('git', ['push', '-u', 'origin', branch], { cwd: targetDir, stdio: 'inherit' });
}

function resolveInitialPushDecision(targetDir: string, options: WorkspaceCreateOptions): boolean {
  if (options.push === false) return false;
  if (options.push === true) return true;
  const remotes = spawnSync('git', ['remote'], { cwd: targetDir, encoding: 'utf8' });
  const list = (remotes.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return list.includes('origin');
}

function upsertWorkspaceAuth(
  rootDir: string,
  auth: { provider: 'github'; host: string; account: string },
): void {
  const file = path.join(rootDir, 'houston.config.yaml');
  let data: any = {};
  try {
    data = readYamlFile(file);
  } catch {}
  if (!data || typeof data !== 'object') data = {};
  data.auth = data.auth ?? {};
  data.auth.github = { host: auth.host, label: extractLabel(auth.account) };
  writeYamlFile(file, data, { sortKeys: true });
}

function extractLabel(account: string): string | undefined {
  const m = account.match(/^github@[^#]+#(.+)$/);
  return m ? m[1] : undefined;
}

async function createGitHubRepoFromArg(
  host: string,
  ownerRepo: string,
  isPrivate: boolean,
  account?: string,
): Promise<string> {
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) throw new Error(`Invalid value for createRemote: ${ownerRepo}. Expected owner/repo.`);
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const token = account
    ? await getSecret('archway-houston', account)
    :
      (await getSecret('archway-houston', `github@${host}#default`)) ||
      (await getSecret('archway-houston', `github@${host}`));
  if (!token) throw new Error(`No stored token for github@${host}. Run: houston auth login github --host ${host}`);
  const createUrl = `${apiBase}/orgs/${owner}/repos`;
  const altUrl = `${apiBase}/user/repos`;
  const payload = { name: repo, private: isPrivate } as Record<string, unknown>;
  let response = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'archway-houston-cli',
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 404) {
    response = await fetch(altUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'archway-houston-cli',
      },
      body: JSON.stringify({ ...payload, name: repo }),
    });
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub repo creation failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { ssh_url?: string; clone_url?: string };
  return (data.ssh_url ?? data.clone_url) as string;
}

