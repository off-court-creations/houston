import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { printOutput, renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import {
  buildWorkspaceAnalytics,
  SprintOverview,
  SprintPhase,
  TicketOverview,
  WorkspaceAnalytics,
} from '../services/workspace-analytics.js';
import { collectWorkspaceInventory, TicketType } from '../services/workspace-inventory.js';
import { canPrompt as canInteractive, intro as uiIntro, outro as uiOutro, promptConfirm as uiConfirm, promptText as uiText, promptSelect as uiSelect, spinner as uiSpinner } from '../lib/interactive.js';
import { shortenTicketId } from '../lib/id.js';
import { setDefaultWorkspaceIfUnset } from '../services/user-config.js';
import { wizardAttempt } from '../lib/wizard.js';

interface JsonOption {
  json?: boolean;
}

interface TicketListOptions extends JsonOption {
  type?: TicketType[];
  status?: string[];
  assignee?: string[];
  repo?: string[];
  sprint?: string[];
  component?: string[];
  label?: string[];
  limit?: number;
  sort?: 'id' | 'status' | 'assignee' | 'updated';
}

interface SprintListOptions extends JsonOption {
  status?: ('active' | 'upcoming' | 'completed' | 'unknown')[];
}

interface BacklogOptions extends JsonOption {
  includeMissing?: boolean;
}

interface CreateWorkspaceOptions {
  force?: boolean;
  git?: boolean;
  interactive?: boolean;
  remote?: string;
  createRemote?: string;
  host?: string;
  private?: boolean;
  public?: boolean;
  push?: boolean;
  authLabel?: string;
}

export interface SetupFollowUpChoices {
  addUsers: boolean;
  addComponents: boolean;
  addLabels: boolean;
  authLogin: boolean;
  addRepos: boolean;
  newEpic: boolean;
  newStory: boolean;
  newSubtask: boolean;
  newSprint: boolean;
  planBacklog: boolean;
}

const WORKSPACE_GENERATOR = 'houston@workspace-create';
const IGNORED_DIRECTORY_ENTRIES = new Set(['.', '..', '.git', '.gitignore', '.gitattributes', '.DS_Store']);

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
  [
    'repos/repos.yaml',
    `repos: []\n`,
  ],
  [
    'repos/component-routing.yaml',
    `routes: {}\ndefaults:\n  epic: []\n  story: []\n  subtask: []\n  bug: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'people/users.yaml',
    `users: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'taxonomies/components.yaml',
    `components: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
  [
    'taxonomies/labels.yaml',
    `labels: []\ngenerated_by: ${WORKSPACE_GENERATOR}\n`,
  ],
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
  [
    'sprints/README.md',
    '# Sprints\n\nPlace sprint shells here (e.g. `S-123e4567-e89b-42d3-a456-426614174000/sprint.yaml`).\n',
  ],
];

const GITKEEP_PATHS = [
  'tickets/EPIC/.gitkeep',
  'tickets/STORY/.gitkeep',
  'tickets/SUBTASK/.gitkeep',
  'tickets/BUG/.gitkeep',
  'sprints/.gitkeep',
  'schema/.gitkeep',
];

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Inspect workspace state')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace info\n  $ houston workspace info --json\n  $ houston workspace new my-workspace --no-git\n  $ houston workspace new --interactive\n`,
    );

  workspace
    .command('new')
    .description('Scaffold a new Houston workspace')
    .argument('[directory]', 'target directory (defaults to current directory)', '.')
    .option('--force', 'allow creation in a non-empty directory')
    .option('--no-git', 'skip git initialization')
    .option('-i, --interactive', 'run guided setup even when arguments are provided')
    .option('--no-interactive', 'run non-interactively (bypass prompts)')
    .option('--remote <url>', 'add remote origin with the provided git URL')
    .option('--create-remote <owner/repo>', 'create a GitHub repo and set as origin')
    .option('--host <host>', 'GitHub host (default: github.com)')
    .option('--private', 'create GitHub repo as private (default)')
    .option('--public', 'create GitHub repo as public')
    .option('--auth-label <label>', 'auth account label to use (e.g., work, hobby)')
    .option('--push', 'push initial commit to remote (default when remote configured)')
    .option('--no-push', 'do not push initial commit')
    .action((directory: string, options: CreateWorkspaceOptions) => {
      // Run wizard by default when in a TTY, unless explicitly disabled.
      const shouldInteractive = options.interactive !== false && canInteractive();
      if (shouldInteractive) {
        return runWorkspaceNewInteractive(directory, options);
      }
      const targetDir = path.resolve(process.cwd(), directory ?? '.');
      ensureDirectory(targetDir);
      if (!options.force && hasMeaningfulEntries(targetDir)) {
        throw new Error(`Target directory ${targetDir} is not empty. Use --force to continue.`);
      }
      scaffoldWorkspace(targetDir, options.force === true);
      if (options.git !== false) {
        initGitRepository(targetDir);
        try { copyBundledSchemas(path.join(targetDir, 'schema')); } catch {}
        createInitialCommit(targetDir);
        if (options.remote) {
          setRemoteOrigin(targetDir, options.remote);
          // If auth label provided, persist workspace auth metadata
          if (options.authLabel) {
            const host = (options.host ?? 'github.com').trim();
            const account = `github@${host}#${options.authLabel.trim()}`;
            try { upsertWorkspaceAuth(targetDir, { provider: 'github', host, account }); } catch {}
          }
        } else if (options.createRemote) {
          const host = (options.host ?? 'github.com').trim();
          const isPrivate = options.public ? false : true;
          const account = options.authLabel ? `github@${host}#${options.authLabel.trim()}` : undefined;
          return createGitHubRepoFromArg(host, options.createRemote, isPrivate, account)
            .then((url) => {
              setRemoteOrigin(targetDir, url);
              if (account) {
                try { upsertWorkspaceAuth(targetDir, { provider: 'github', host, account }); } catch {}
              }
              const shouldPush = resolveInitialPushDecision(targetDir, options);
              if (shouldPush) pushInitial(targetDir);
              console.log(c.ok(`Initialized Houston workspace at ${targetDir}`));
              try { setDefaultWorkspaceIfUnset(targetDir); } catch {}
            });
        }
        const shouldPush = resolveInitialPushDecision(targetDir, options);
        if (shouldPush) {
          pushInitial(targetDir);
        }
      }
      console.log(c.ok(`Initialized Houston workspace at ${targetDir}`));
      try { setDefaultWorkspaceIfUnset(targetDir); } catch {}
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace new\n  $ houston workspace new ./tracking --no-git\n  $ houston workspace new ./tracking --force\n  $ houston workspace new ./tracking --no-interactive --force\n  $ houston workspace new ./tracking --remote git@github.com:owner/repo.git --push\n  $ houston workspace new ./tracking --create-remote owner/repo --host github.com --private --push\nNotes:\n  - Creates a directory structure with schema, tickets, backlog, sprints, repos, people, taxonomies.\n  - Use --force to overwrite existing files.\n  - Use --no-interactive to bypass the wizard in TTY contexts.\n  - Use --remote or --create-remote to set up a remote and optionally push.\n  - Interactive mode can list owners from your PAT (Me + orgs).\n  - Wizard can queue first epic/story/subtask/sprint and backlog planning.\n`,
    );

  workspace
    .command('info')
    .description('Show high-level workspace snapshot')
    .option('-j, --json', 'output as JSON')
    .action((options: JsonOption) => {
      const { config, analytics } = loadAnalytics();
      const activeSprints = analytics.sprints.filter((sprint) => sprint.status === 'active');
      const upcomingSprints = analytics.sprints.filter((sprint) => sprint.status === 'upcoming');
      const completedSprints = analytics.sprints.filter((sprint) => sprint.status === 'completed');
      const payload = {
        workspace: {
          workspaceRoot: config.workspaceRoot,
          trackingRoot: config.tracking.root,
          schemaDir: config.tracking.schemaDir,
        },
        summary: analytics.summary,
        sprints: {
          active: activeSprints.map(minifySprint),
          upcoming: upcomingSprints.map(minifySprint),
          completed: completedSprints.map(minifySprint),
        },
        backlog: {
          path: analytics.backlog.path,
          ticketIds: analytics.backlog.tickets.map((ticket) => ticket.id),
          missing: analytics.backlog.missing,
        },
        nextSprint: {
          path: analytics.nextSprint.path,
          ticketIds: analytics.nextSprint.tickets.map((ticket) => ticket.id),
          missing: analytics.nextSprint.missing,
        },
        repos: {
          configured: analytics.repoUsage.map((entry) => ({
            id: entry.config.id,
            provider: entry.config.provider,
            remote: entry.config.remote,
            ticketIds: entry.tickets.map((ticket) => ticket.id),
          })),
          unknownReferences: analytics.unknownRepoTickets.map((ticket) => ticket.id),
        },
      };

      const lines: string[] = [];

      const workspaceTable = renderBoxTable([
        [c.bold('Resource'), c.bold('Value')],
        ['Workspace root', config.workspaceRoot],
        ['Tracking root', config.tracking.root],
        ['Schema dir', config.tracking.schemaDir],
        ['Backlog path', analytics.backlog.path],
        ['Next sprint path', analytics.nextSprint.path],
      ]);

      const summaryRows: string[][] = [
        [c.bold('Group'), c.bold('Metric'), c.bold('Value')],
        ['Totals', 'Total tickets', analytics.summary.totalTickets.toString()],
      ];

      const typeEntries = Object.entries(analytics.summary.ticketTypeCounts).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      for (const [type, count] of typeEntries) {
        summaryRows.push(['Type', capitalize(type), count.toString()]);
      }

      const statusEntries = Object.entries(analytics.summary.ticketStatusCounts).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      if (statusEntries.length > 0) {
        for (const [status, count] of statusEntries) {
          summaryRows.push(['Status', capitalize(status), count.toString()]);
        }
      }

      summaryRows.push(
        ['Totals', 'Backlog items', analytics.summary.backlogCount.toString()],
        ['Totals', 'Next sprint items', analytics.summary.nextSprintCount.toString()],
        ['Totals', 'Repos configured', analytics.summary.repoCount.toString()],
        ['Totals', 'Components', analytics.summary.componentCount.toString()],
        ['Totals', 'Labels', analytics.summary.labelCount.toString()],
        ['Totals', 'People', analytics.summary.userCount.toString()],
        ['Totals', 'Active sprints', analytics.summary.activeSprintCount.toString()],
        ['Totals', 'Unknown repo refs', analytics.unknownRepoTickets.length.toString()],
        ['Queues', 'Backlog missing tickets', analytics.backlog.missing.length.toString()],
        ['Queues', 'Next sprint missing tickets', analytics.nextSprint.missing.length.toString()],
      );

      const summaryTable = renderBoxTable(summaryRows);
      lines.push('');
      lines.push(c.heading('Summary'));
      lines.push(...summaryTable);

      const displayedSprints = [
        ...activeSprints,
        ...upcomingSprints,
        ...completedSprints.slice(-3),
      ];
      lines.push('');
      lines.push(c.heading('Sprints'));
      if (displayedSprints.length > 0) {
        const sprintRows: string[][] = [
          [c.bold('Sprint'), c.bold('Label'), c.bold('Status'), c.bold('Scoped')],
        ];
        for (const sprint of displayedSprints) {
          sprintRows.push([
            c.id(sprint.id),
            formatSprintPretty(sprint),
            c.status(capitalize(sprint.status)),
            sprint.totalScoped.toString(),
          ]);
        }
        const sprintTable = renderBoxTable(sprintRows);
        lines.push(...sprintTable);
      } else {
        lines.push('No sprints found.');
      }

      lines.push('');
      lines.push(c.heading('Workspace'));
      lines.push(...workspaceTable);

      printOutput(payload, lines, options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston workspace info\n  $ houston workspace info --json\n`,
    );

  // No additional workspace aliases; use top-level `houston check` instead.
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
  if (!fs.existsSync(targetDir)) {
    return false;
  }
  try {
    const entries = fs.readdirSync(targetDir);
    return entries.some((entry) => !IGNORED_DIRECTORY_ENTRIES.has(entry));
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
  // Try both source and dist layouts
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
  if (result.error) {
    throw new Error(`Failed to run git: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    // Fallback for older Git versions that do not understand --initial-branch
    result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'inherit' });
    if (result.error) {
      throw new Error(`Failed to run git: ${result.error.message}`);
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error('git init failed');
    }

    const branchResult = spawnSync('git', ['checkout', '-b', 'main'], { cwd: targetDir, stdio: 'inherit' });
    if (branchResult.error) {
      throw new Error(`Failed to create main branch: ${branchResult.error.message}`);
    }
    if (typeof branchResult.status === 'number' && branchResult.status !== 0) {
      throw new Error('Unable to set default branch to main');
    }
  }
}

function createInitialCommit(targetDir: string): void {
  // Stage entire workspace and create initial commit
  spawnSync('git', ['add', '-A', '--', '.'], { cwd: targetDir, stdio: 'inherit' });
  const res = spawnSync('git', ['commit', '-m', 'houston: initialize workspace'], { cwd: targetDir, stdio: 'inherit' });
  if (res.error) {
    throw new Error(`Failed to create initial commit: ${res.error.message}`);
  }
}

function setRemoteOrigin(targetDir: string, url: string): void {
  const hasRemote = spawnSync('git', ['remote'], { cwd: targetDir, encoding: 'utf8' });
  if (hasRemote.error) return;
  const list = (hasRemote.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!list.includes('origin')) {
    const addRes = spawnSync('git', ['remote', 'add', 'origin', url], { cwd: targetDir, stdio: 'inherit' });
    if (addRes.error) {
      throw new Error(`Failed to add remote: ${addRes.error.message}`);
    }
  } else {
    spawnSync('git', ['remote', 'set-url', 'origin', url], { cwd: targetDir, stdio: 'inherit' });
  }
}

function pushInitial(targetDir: string): void {
  // Try push with upstream; if not set, establish upstream on main
  const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: targetDir });
  if (typeof upstream.status === 'number' && upstream.status === 0) {
    spawnSync('git', ['push'], { cwd: targetDir, stdio: 'inherit' });
    return;
  }
  const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetDir, encoding: 'utf8' });
  const branch = (branchRes.stdout ?? 'main').trim() || 'main';
  spawnSync('git', ['push', '-u', 'origin', branch], { cwd: targetDir, stdio: 'inherit' });
}

function resolveInitialPushDecision(targetDir: string, options: CreateWorkspaceOptions): boolean {
  if (options.push === false) return false;
  if (options.push === true) return true;
  // Default: push when a remote exists
  const remotes = spawnSync('git', ['remote'], { cwd: targetDir, encoding: 'utf8' });
  const list = (remotes.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return list.includes('origin');
}

import fetch from 'node-fetch';
import { getSecret, listAccounts as listSecretAccounts } from '../services/secrets.js';
import { listAuthAccounts as listTrackedAuthAccounts } from '../services/user-config.js';
import { readYamlFile, writeYamlFile } from '../lib/yaml.js';

async function createGitHubRepoFromArg(host: string, ownerRepo: string, isPrivate: boolean, account?: string): Promise<string> {
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) throw new Error(`Invalid value for --create-remote: ${ownerRepo}. Expected owner/repo.`);
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const token = account
    ? await getSecret('archway-houston', account)
    : await getSecret('archway-houston', `github@${host}#default`) || await getSecret('archway-houston', `github@${host}`);
  if (!token) throw new Error(`No stored token for github@${host}. Run: houston auth login github --host ${host}`);
  // Check if owner is a user or org; attempt org first
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
    // Fall back to creating under the authenticated user
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
  // Prefer SSH URL when available
  return (data.ssh_url ?? data.clone_url) as string;
}

type OwnerChoice = { type: 'known'; owner: string } | { type: 'custom' };

async function chooseGitHubOwner(host: string, account?: string): Promise<OwnerChoice | null> {
  const choices = await listGitHubOwners(host, account).catch(() => [] as Array<{ label: string; value: string }>);
  if (!choices || choices.length === 0) {
    return { type: 'custom' };
  }
  const selected = await uiSelect('Select repository owner', [...choices, { label: 'Other…', value: '__custom__' }], { allowCustom: false });
  if (!selected || selected === '__custom__') return { type: 'custom' };
  return { type: 'known', owner: selected };
}

async function listGitHubOwners(host: string, account?: string): Promise<Array<{ label: string; value: string }>> {
  const apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const token = account
    ? await getSecret('archway-houston', account)
    : await getSecret('archway-houston', `github@${host}#default`) || await getSecret('archway-houston', `github@${host}`);
  if (!token) return [];
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'archway-houston-cli',
  } as Record<string, string>;
  const out: Array<{ label: string; value: string }> = [];
  try {
    const meRes = await fetch(`${apiBase}/user`, { headers });
    if (meRes.ok) {
      const me = (await meRes.json()) as { login?: string };
      if (me?.login) out.push({ label: `Me (${me.login})`, value: me.login });
    }
  } catch {}
  try {
    const orgRes = await fetch(`${apiBase}/user/orgs`, { headers });
    if (orgRes.ok) {
      const orgs = (await orgRes.json()) as Array<{ login?: string }>;
      for (const org of orgs) {
        if (org?.login) out.push({ label: org.login, value: org.login });
      }
    }
  } catch {}
  const dedup = new Map<string, string>();
  for (const c of out) dedup.set(c.value, c.label);
  return Array.from(dedup.entries()).map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
}

function parseOwnerRepo(input: string): { owner: string; repo: string } {
  const idx = input.indexOf('/');
  if (idx <= 0 || idx >= input.length - 1) {
    throw new Error(`Invalid repository: ${input}. Expected owner/repo.`);
  }
  const owner = input.slice(0, idx).trim();
  const repo = input.slice(idx + 1).trim();
  if (!owner || !repo) throw new Error(`Invalid repository: ${input}. Expected owner/repo.`);
  return { owner, repo };
}

async function selectGithubAccount(host: string): Promise<string | null> {
  // Gather tracked accounts via secrets and config
  const accounts = await listSecretAccounts('archway-houston');
  const byHost = accounts.filter((acc) => acc === `github@${host}` || acc.startsWith(`github@${host}#`));
  if (byHost.length === 0) return null;
  const options = byHost.map((acc) => ({ label: formatAccountLabel(acc), value: acc }));
  const selected = await uiSelect('Select a GitHub account to use', [...options, { label: 'Other (manual)', value: '__none__' }], { allowCustom: false });
  if (!selected || selected === '__none__') return null;
  return selected;
}

function formatAccountLabel(account: string): string {
  // github@host#label → host (label)
  const m = account.match(/^github@([^#]+)(?:#(.*))?$/);
  if (!m) return account;
  const host = m[1];
  const label = m[2] ?? 'default';
  return `${host} (${label})`;
}

function upsertWorkspaceAuth(rootDir: string, auth: { provider: 'github'; host: string; account: string }): void {
  const file = path.join(rootDir, 'houston.config.yaml');
  let data: any = {};
  try { data = readYamlFile(file); } catch {}
  if (!data || typeof data !== 'object') data = {};
  data.auth = data.auth ?? {};
  data.auth.github = { host: auth.host, label: extractLabel(auth.account) };
  writeYamlFile(file, data, { sortKeys: true });
}

function extractLabel(account: string): string | undefined {
  const m = account.match(/^github@[^#]+#(.+)$/);
  return m ? m[1] : undefined;
}

async function runWorkspaceNewInteractive(initialDir?: string, options: CreateWorkspaceOptions = {}): Promise<void> {
  await uiIntro('Create Houston Workspace');

  let directoryInput = initialDir ?? '.';
  let targetDir = path.resolve(process.cwd(), directoryInput);
  let existingHasFiles = hasMeaningfulEntries(targetDir);
  let allowOverwrite = Boolean(options.force);

  while (true) {
    const dirAnswer = (await uiText('Directory', { defaultValue: directoryInput, required: true })).trim();
    directoryInput = dirAnswer.length === 0 ? '.' : dirAnswer;
    targetDir = path.resolve(process.cwd(), directoryInput);
    existingHasFiles = hasMeaningfulEntries(targetDir);
    if (existingHasFiles && !allowOverwrite) {
      const selection = await uiSelect(
        `Directory ${targetDir} is not empty.`,
        [
          { label: 'Overwrite existing files', value: 'overwrite' },
          { label: 'Choose a different directory', value: 'retry' },
          { label: 'Cancel setup', value: 'cancel' },
        ],
        { defaultValue: 'retry', allowCustom: false },
      );
      if (selection === 'overwrite') {
        allowOverwrite = true;
      } else if (selection === 'retry') {
        continue;
      } else {
        await uiOutro('Aborted');
        return;
      }
    }
    break;
  }

  let initGit = options.git !== false;
  if (options.git === undefined) {
    initGit = await uiConfirm('Initialize git?', true);
  }

  const sp = uiSpinner();
  await sp.start('Scaffolding workspace...');
  try {
    ensureDirectory(targetDir);
    scaffoldWorkspace(targetDir, allowOverwrite || existingHasFiles);
    try {
      copyBundledSchemas(path.join(targetDir, 'schema'));
    } catch {
      // best-effort; fallback loader can still supply bundled schemas at runtime
    }

    if (initGit) {
      initGitRepository(targetDir);
      try { createInitialCommit(targetDir); } catch {}
      await handleRemoteSetup(targetDir, options);
    }

    sp.stop('Workspace created');
    try { setDefaultWorkspaceIfUnset(targetDir); } catch {}

    const checklistRows: string[][] = [
      [c.bold('Area'), c.bold('Focus')],
      ['People', 'Add core users (owner/IC/PM)'],
      ['Components', 'Record stable product areas'],
      ['Labels', 'Define taxonomy for filtering/reporting'],
      ['Repos', 'Register code repositories (remote optional)'],
      ['Auth', 'Store a GitHub token for automation'],
      ['Tickets', 'Create your first epic/story/subtask'],
      ['Sprints', 'Create your first sprint shell'],
      ['Backlog', 'Plan top items into a sprint'],
    ];
    console.log('');
    console.log(c.subheading('Setup focus'));
    for (const line of renderBoxTable(checklistRows)) {
      console.log(line);
    }

    const followUps = await collectFollowUpChoices();
    const queue = buildSetupQueue(targetDir, followUps);

    const commandRows: string[][] = [[c.bold('Command'), c.bold('Purpose')]];
    for (const cmd of queue) {
      const purpose = describeSetupCommand(cmd);
      const formatted = formatSetupCommand(cmd);
      commandRows.push([formatted, purpose]);
    }

    const lines: string[] = [];
    lines.push(c.heading('Houston workspace ready'));
    lines.push(`Workspace scaffolded at ${c.id(targetDir)}`);
    await uiOutro(lines.join('\n'));

    const shouldRun = await uiConfirm('Run the setup commands now?', true);
    if (shouldRun) {
      const execCwd = targetDir;
      for (const cmd of queue) {
        if (cmd.startsWith('cd ')) continue;
        const pretty = formatSetupCommand(cmd);
        console.log(pretty);
        const parts = cmd.trim().split(/\s+/);
        const argv = parts[0] === 'houston' ? parts.slice(1) : parts;
        const res = spawnSync('houston', argv, { cwd: execCwd, stdio: 'inherit' });
        if (res.error) {
          throw res.error;
        }
        if (typeof res.status === 'number' && res.status !== 0) {
          process.exitCode = res.status;
          break;
        }
      }
    } else {
      console.log('');
      console.log(c.subheading('Run these next'));
      for (const line of renderBoxTable(commandRows)) {
        console.log(line);
      }
    }
  } catch (error) {
    sp.stopWithError('Failed to create workspace');
    throw error;
  }
}

async function collectFollowUpChoices(): Promise<SetupFollowUpChoices> {
  const choices: SetupFollowUpChoices = {
    addUsers: await uiConfirm('Add users now?', true),
    addComponents: await uiConfirm('Add components now?', true),
    addLabels: await uiConfirm('Add labels now?', true),
    authLogin: await uiConfirm('Login to GitHub for PR/branch automation now?', true),
    addRepos: await uiConfirm('Add repositories now?', true),
    newEpic: await uiConfirm('Create your first epic now?', true),
    newStory: await uiConfirm('Create your first story now?', true),
    newSubtask: await uiConfirm('Create your first subtask now?', false),
    newSprint: await uiConfirm('Create your first sprint now?', true),
    planBacklog: await uiConfirm('Run backlog planning wizard now?', true),
  };
  return refineFollowUpChoices(choices);
}

async function refineFollowUpChoices(choices: SetupFollowUpChoices): Promise<SetupFollowUpChoices> {
  while (true) {
    const selection = await uiSelect(
      'Adjust setup steps?',
      [
        { label: 'Looks good – continue', value: 'done' },
        { label: `Add users (${formatToggle(choices.addUsers)})`, value: 'addUsers' },
        { label: `Add components (${formatToggle(choices.addComponents)})`, value: 'addComponents' },
        { label: `Add labels (${formatToggle(choices.addLabels)})`, value: 'addLabels' },
        { label: `GitHub auth login (${formatToggle(choices.authLogin)})`, value: 'authLogin' },
        { label: `Add repositories (${formatToggle(choices.addRepos)})`, value: 'addRepos' },
        { label: `Create epic (${formatToggle(choices.newEpic)})`, value: 'newEpic' },
        { label: `Create story (${formatToggle(choices.newStory)})`, value: 'newStory' },
        { label: `Create subtask (${formatToggle(choices.newSubtask)})`, value: 'newSubtask' },
        { label: `Create sprint (${formatToggle(choices.newSprint)})`, value: 'newSprint' },
        { label: `Plan backlog (${formatToggle(choices.planBacklog)})`, value: 'planBacklog' },
      ],
      { defaultValue: 'done', allowCustom: false },
    );
    if (!selection || selection === 'done') {
      return choices;
    }
    switch (selection) {
      case 'addUsers':
        choices.addUsers = !choices.addUsers;
        break;
      case 'addComponents':
        choices.addComponents = !choices.addComponents;
        break;
      case 'addLabels':
        choices.addLabels = !choices.addLabels;
        break;
      case 'authLogin':
        choices.authLogin = !choices.authLogin;
        break;
      case 'addRepos':
        choices.addRepos = !choices.addRepos;
        break;
      case 'newEpic':
        choices.newEpic = !choices.newEpic;
        break;
      case 'newStory':
        choices.newStory = !choices.newStory;
        break;
      case 'newSubtask':
        choices.newSubtask = !choices.newSubtask;
        break;
      case 'newSprint':
        choices.newSprint = !choices.newSprint;
        break;
      case 'planBacklog':
        choices.planBacklog = !choices.planBacklog;
        break;
      default:
        break;
    }
  }
}

function formatToggle(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

export function buildSetupQueue(targetDir: string, choices: SetupFollowUpChoices): string[] {
  const queue: string[] = [`cd ${targetDir}`];
  if (choices.addUsers) queue.push('houston user add');
  if (choices.addComponents) queue.push('houston component add');
  if (choices.addLabels) queue.push('houston label add');
  if (choices.authLogin) queue.push('houston auth login github');
  if (choices.addRepos) queue.push('houston repo add');
  if (choices.newEpic) queue.push('houston ticket new epic --interactive');
  if (choices.newStory) queue.push('houston ticket new story --interactive');
  if (choices.newSubtask) queue.push('houston ticket new subtask --interactive');
  if (choices.newSprint) queue.push('houston sprint new --interactive');
  if (choices.planBacklog) queue.push('houston backlog plan --interactive');
  queue.push('houston check');
  queue.push('houston workspace info');
  return queue;
}

interface RemotePromptsState {
  url?: string;
  host?: string;
  ownerRepo?: string;
}

async function handleRemoteSetup(targetDir: string, options: CreateWorkspaceOptions): Promise<void> {
  const wantsRemote = await uiConfirm('Configure a remote origin now?', true);
  if (!wantsRemote) {
    return;
  }
  const promptState: RemotePromptsState = {
    url: options.remote,
    host: options.host ?? 'github.com',
    ownerRepo: options.createRemote,
  };
  let methodDefault: 'url' | 'github' = options.createRemote ? 'github' : 'url';

  while (true) {
    const method = await uiSelect(
      'How would you like to configure the remote?',
      [
        { label: 'Enter existing remote URL', value: 'url' },
        { label: 'Create a GitHub repository', value: 'github' },
        { label: 'Skip remote setup', value: 'skip' },
      ],
      { defaultValue: methodDefault, allowCustom: false },
    );
    if (!method || method === 'skip') {
      return;
    }
    if (method === 'url') {
      methodDefault = 'url';
      const outcome = await configureRemoteWithUrl(targetDir, promptState, options);
      if (outcome === 'done') {
        return;
      }
      continue;
    }
    if (method === 'github') {
      methodDefault = 'github';
      const outcome = await configureRemoteWithGitHub(targetDir, promptState, options);
      if (outcome === 'done') {
        return;
      }
      continue;
    }
  }
}

async function configureRemoteWithUrl(
  targetDir: string,
  state: RemotePromptsState,
  options: CreateWorkspaceOptions,
): Promise<'done' | 'back'> {
  const attempt = await wizardAttempt(async () => {
    const remoteUrl = (await uiText('Remote URL', { defaultValue: state.url, required: true })).trim();
    state.url = remoteUrl;
    setRemoteOrigin(targetDir, remoteUrl);
    return remoteUrl;
  }, {
    allowBack: true,
    prompt: 'Remote configuration failed. What next?',
  });

  if (attempt.status !== 'ok' || !attempt.value) {
    return 'back';
  }

  const shouldPush = options.push === true
    ? true
    : options.push === false
      ? false
      : await uiConfirm('Push initial commit now?', true);
  if (shouldPush) {
    pushInitial(targetDir);
  }
  return 'done';
}

type GitHubSetupOutcome =
  | { kind: 'ok'; url: string }
  | { kind: 'switch-to-url' }
  | { kind: 'skip' };

async function configureRemoteWithGitHub(
  targetDir: string,
  state: RemotePromptsState,
  options: CreateWorkspaceOptions,
): Promise<'done' | 'back'> {
  const result = await wizardAttempt(async () => {
    const host = (await uiText('GitHub host', { defaultValue: state.host ?? 'github.com', required: true })).trim();
    state.host = host;

    try {
      const tracked = listTrackedAuthAccounts();
      if (!tracked || tracked.length === 0) {
        console.log(c.subheading('No GitHub accounts configured'));
        console.log('Let\'s add one now:');
        const res = spawnSync('houston', ['auth', 'login', 'github', '--host', host], { stdio: 'inherit' });
        if (res.error) {
          console.log('Auth login encountered an error; you can also select "Enter existing remote URL" from the previous menu.');
        }
      }
    } catch {}

    const account = await selectGithubAccount(host);

    const ownerData = await collectOwnerAndRepo(host, account ?? undefined, state);
    if (ownerData.kind === 'switch-to-url' || ownerData.kind === 'skip') {
      return ownerData;
    }

    const priv = options.public === true
      ? false
      : options.private === true
        ? true
        : await uiConfirm('Private repository?', true);

    const repoResult = await createGitHubRepoWithRecovery(host, ownerData.owner, ownerData.repo, priv, account ?? undefined, state);
    if (repoResult.kind === 'switch-to-url' || repoResult.kind === 'skip') {
      return repoResult;
    }

    setRemoteOrigin(targetDir, repoResult.url);
    if (account) {
      try { upsertWorkspaceAuth(targetDir, { provider: 'github', host, account }); } catch {}
    }

    const shouldPush = options.push === true
      ? true
      : options.push === false
        ? false
        : await uiConfirm('Push initial commit now?', true);
    if (shouldPush) {
      pushInitial(targetDir);
    }

    return { kind: 'ok', url: repoResult.url } satisfies GitHubSetupOutcome;
  }, {
    allowBack: true,
    prompt: 'GitHub repository setup failed. What next?',
  });

  if (result.status !== 'ok') {
    return 'back';
  }

  const payload = result.value as GitHubSetupOutcome | undefined;
  if (!payload) {
    return 'back';
  }

  switch (payload.kind) {
    case 'ok':
      return 'done';
    case 'switch-to-url':
      return configureRemoteWithUrl(targetDir, state, options);
    case 'skip':
      return 'done';
    default:
      return 'back';
  }
}

async function promptOwnerAndRepo(
  host: string,
  account: string | undefined,
  previous?: string,
): Promise<{ owner: string; repo: string }> {
  let defaultOwner: string | undefined;
  let defaultRepo: string | undefined;
  if (previous) {
    if (previous.includes('/')) {
      const parsed = parseOwnerRepo(previous);
      defaultOwner = parsed.owner;
      defaultRepo = parsed.repo;
    } else {
      defaultRepo = previous;
    }
  }

  while (true) {
    const repoName = (await uiText('Repository name', { defaultValue: defaultRepo, required: true })).trim();
    const owner = await promptOwnerSelection(host, account, defaultOwner);
    if (!owner) {
      console.log(c.error('Repository owner is required.'));
      continue;
    }
    return { owner, repo: repoName };
  }
}

async function promptOwnerSelection(
  host: string,
  account: string | undefined,
  defaultOwner?: string,
): Promise<string> {
  const choices = await listGitHubOwners(host, account).catch(() => [] as Array<{ label: string; value: string }>);
  if (!choices || choices.length === 0) {
    const value = (await uiText('Repository owner (user or org)', {
      defaultValue: defaultOwner,
      required: true,
    })).trim();
    return value;
  }

  const normalizedChoices = [...choices];
  if (defaultOwner && !normalizedChoices.some((choice) => choice.value === defaultOwner)) {
    normalizedChoices.unshift({ label: defaultOwner, value: defaultOwner });
  }
  normalizedChoices.push({ label: 'Other…', value: '__manual__' });

  const selected = await uiSelect('Select repository owner', normalizedChoices, {
    allowCustom: false,
    defaultValue: defaultOwner ?? normalizedChoices[0]?.value,
  });

  if (!selected || selected === '__manual__') {
    const manualOwner = (await uiText('Repository owner (user or org)', {
      defaultValue: defaultOwner,
      required: true,
    })).trim();
    return manualOwner;
  }
  return selected;
}

async function collectOwnerAndRepo(
  host: string,
  account: string | undefined,
  state: RemotePromptsState,
): Promise<{ kind: 'ok'; owner: string; repo: string } | { kind: 'switch-to-url' } | { kind: 'skip' }> {
  while (true) {
    const ownerChoice = await chooseGitHubOwner(host, account ?? undefined);
    let owner: string;
    let repoName: string;
    if (ownerChoice?.type === 'known') {
      const repoAnswerRaw = (await uiText('Repository name', {
        defaultValue:
          state.ownerRepo && state.ownerRepo.startsWith(`${ownerChoice.owner}/`)
            ? state.ownerRepo.slice(ownerChoice.owner.length + 1)
            : state.ownerRepo && !state.ownerRepo.includes('/')
              ? state.ownerRepo
              : undefined,
        required: true,
      })).trim();
      if (repoAnswerRaw.includes('/')) {
        const parsed = parseOwnerRepo(repoAnswerRaw);
        owner = parsed.owner;
        repoName = parsed.repo;
      } else {
        owner = ownerChoice.owner;
        repoName = repoAnswerRaw;
      }
    } else {
      const manual = await promptOwnerAndRepo(host, account ?? undefined, state.ownerRepo);
      owner = manual.owner;
      repoName = manual.repo;
    }

    state.ownerRepo = `${owner}/${repoName}`;

    return { kind: 'ok', owner, repo: repoName };
  }
}

async function createGitHubRepoWithRecovery(
  host: string,
  owner: string,
  repo: string,
  priv: boolean,
  account: string | undefined,
  state: RemotePromptsState,
): Promise<GitHubSetupOutcome> {
  while (true) {
    try {
      const url = await createGitHubRepoFromArg(host, `${owner}/${repo}`, priv, account ?? undefined);
      state.ownerRepo = `${owner}/${repo}`;
      return { kind: 'ok', url };
    } catch (error) {
      if (isMissingTokenError(error) || isAuthError(error)) {
        const choice = await uiSelect(
          'Houston needs a GitHub token to create the repository.',
          [
            { label: 'Login to GitHub now', value: 'login' },
            { label: 'Enter remote URL manually', value: 'manual' },
            { label: 'Skip remote setup', value: 'skip' },
            { label: 'Try again', value: 'retry' },
          ],
          { defaultValue: 'login', allowCustom: false },
        );

        switch (choice) {
          case 'login': {
            const loginRes = spawnSync('houston', ['auth', 'login', 'github', '--host', host], { stdio: 'inherit' });
            if (loginRes.error || (typeof loginRes.status === 'number' && loginRes.status !== 0)) {
              console.log(c.warn('Login command did not complete successfully.'));
            }
            continue;
          }
          case 'manual':
            return { kind: 'switch-to-url' };
          case 'skip':
            return { kind: 'skip' };
          case 'retry':
          default:
            continue;
        }
      }

      throw error;
    }
  }
}

function isMissingTokenError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No stored token for github@');
}

function isAuthError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('(401)') || message.toLowerCase().includes('bad credentials');
}

function formatSetupCommand(cmd: string): string {
  if (cmd.startsWith('cd ')) {
    return `$ cd ${c.id(cmd.slice(3))}`;
  }
  return `$ ${c.id(cmd)}`;
}

function describeSetupCommand(cmd: string): string {
  if (cmd.startsWith('cd ')) return 'Enter the workspace directory';
  switch (cmd) {
    case 'houston user add':
      return 'Capture people in people/users.yaml';
    case 'houston component add':
      return 'Register product components';
    case 'houston label add':
      return 'Record shared labels';
    case 'houston auth login github':
      return 'Store a GitHub token for automation';
    case 'houston repo add':
      return 'Add repositories to repos/repos.yaml';
    case 'houston ticket new epic --interactive':
      return 'Create your first epic';
    case 'houston ticket new story --interactive':
      return 'Create your first story';
    case 'houston ticket new subtask --interactive':
      return 'Create your first subtask';
    case 'houston sprint new --interactive':
      return 'Create your first sprint';
    case 'houston backlog plan --interactive':
      return 'Plan backlog items into a sprint';
    case 'houston check':
      return 'Validate workspace health';
    case 'houston workspace info':
      return 'Review workspace snapshot';
    default:
      return '';
  }
}

function loadAnalytics(): {
  config: ReturnType<typeof loadConfig>;
  analytics: WorkspaceAnalytics;
} {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { config, analytics };
}

function renderTicketLine(ticket: TicketOverview): string {
  const status = ticket.status ? `[${ticket.status}]` : '';
  const assignee = ticket.assignee ? `@${ticket.assignee}` : '';
  const summary = ticket.summary ?? ticket.title ?? '';
  const coloredStatus = ticket.status ? `[${c.status(ticket.status)}]` : '';
  const coloredAssignee = ticket.assignee ? c.dim(`@${ticket.assignee}`) : '';
  const shortId = shortenTicketId(ticket.id);
  return `${c.id(shortId)} ${coloredStatus} ${coloredAssignee} ${summary}`.replace(/\s+/g, ' ').trim();
}

function toTicketStub(ticket: TicketOverview): {
  id: string;
  type: TicketType;
  status?: string;
  assignee?: string;
  summary?: string;
} {
  return {
    id: ticket.id,
    type: ticket.type,
    status: ticket.status,
    assignee: ticket.assignee,
    summary: ticket.summary ?? ticket.title,
  };
}

function minifySprint(sprint: SprintOverview): {
  id: string;
  status: SprintOverview['status'];
  startDate?: string;
  endDate?: string;
  name?: string;
  pretty: string;
} {
  return {
    id: sprint.id,
    status: sprint.status,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    name: sprint.name,
    pretty: formatSprintPretty(sprint),
  };
}

interface TicketFilters {
  types?: TicketType[];
  statuses?: string[];
  assignees?: string[];
  repos?: string[];
  sprints?: string[];
  components?: string[];
  labels?: string[];
  limit?: number;
  sort: 'id' | 'status' | 'assignee' | 'updated';
}

function normalizeTicketFilters(options: TicketListOptions, analytics: WorkspaceAnalytics): TicketFilters {
  const filters: TicketFilters = {
    sort: normalizeSort(options.sort),
  };
  if (options.limit !== undefined) {
    filters.limit = options.limit;
  }
  if (options.type) {
    const normalized = options.type.map((value) => value.toLowerCase()) as TicketType[];
    const invalid = normalized.filter((value) => !['epic', 'story', 'subtask', 'bug'].includes(value));
    if (invalid.length) {
      throw new Error(`Unknown ticket type(s): ${invalid.join(', ')}`);
    }
    filters.types = normalized;
  }
  if (options.status) {
    filters.statuses = options.status;
  }
  if (options.assignee) {
    filters.assignees = options.assignee;
  }
  if (options.repo) {
    filters.repos = options.repo;
  }
  if (options.sprint) {
    filters.sprints = options.sprint;
  }
  if (options.component) {
    filters.components = options.component;
  }
  if (options.label) {
    filters.labels = options.label;
  }

  // Validate repo filters against list of known repos if available
  if (filters.repos) {
    const configuredRepoIds = new Set(analytics.repoUsage.map((entry) => entry.config.id));
    const referencedRepoIds = new Set<string>();
    for (const ticket of analytics.tickets) {
      for (const repoId of ticket.repoIds) {
        referencedRepoIds.add(repoId);
      }
    }
    const unknown = filters.repos.filter(
      (repoId) => !configuredRepoIds.has(repoId) && !referencedRepoIds.has(repoId),
    );
    if (unknown.length) {
      throw new Error(`Unknown repo id(s): ${unknown.join(', ')}`);
    }
  }

  return filters;
}

function applyTicketFilters(tickets: TicketOverview[], filters: TicketFilters): TicketOverview[] {
  return tickets.filter((ticket) => {
    if (filters.types && !filters.types.includes(ticket.type)) {
      return false;
    }
    if (filters.statuses && (!ticket.status || !filters.statuses.includes(ticket.status))) {
      return false;
    }
    if (filters.assignees && (!ticket.assignee || !filters.assignees.includes(ticket.assignee))) {
      return false;
    }
    if (filters.repos && !filters.repos.some((repo) => ticket.repoIds.includes(repo))) {
      return false;
    }
    if (filters.sprints && (!ticket.sprintId || !filters.sprints.includes(ticket.sprintId))) {
      return false;
    }
    if (filters.components && !filters.components.some((component) => ticket.components.includes(component))) {
      return false;
    }
    if (filters.labels && !filters.labels.some((label) => ticket.labels.includes(label))) {
      return false;
    }
    return true;
  });
}

function sortTickets(tickets: TicketOverview[], sort: TicketFilters['sort']): TicketOverview[] {
  const sorted = tickets.slice();
  switch (sort) {
    case 'status':
      sorted.sort((a, b) => (a.status ?? '').localeCompare(b.status ?? '') || a.id.localeCompare(b.id));
      break;
    case 'assignee':
      sorted.sort((a, b) => (a.assignee ?? '').localeCompare(b.assignee ?? '') || a.id.localeCompare(b.id));
      break;
    case 'updated':
      sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
      break;
    case 'id':
    default:
      sorted.sort((a, b) => a.id.localeCompare(b.id));
      break;
  }
  return sorted;
}

function normalizeSort(sortValue: TicketListOptions['sort']): TicketFilters['sort'] {
  if (!sortValue) {
    return 'id';
  }
  if (['id', 'status', 'assignee', 'updated'].includes(sortValue)) {
    return sortValue as TicketFilters['sort'];
  }
  throw new Error(`Unknown sort field: ${sortValue}`);
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Count must be a positive integer');
  }
  return parsed;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatSprintPretty(sprint: SprintOverview): string {
  const window = formatSprintWindow(sprint.startDate, sprint.endDate);
  const name = sprint.name?.trim();
  if (name && window) {
    return `${name} (${window})`;
  }
  if (name) {
    return name;
  }
  if (window) {
    return window;
  }
  return sprint.id;
}

function formatSprintWindow(start?: string, end?: string): string | undefined {
  if (start && end) {
    return `${start} → ${end}`;
  }
  if (start) {
    return start;
  }
  if (end) {
    return end;
  }
  return undefined;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
