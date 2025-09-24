import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { buildWorkspaceAnalytics, type WorkspaceAnalytics } from '../services/workspace-analytics.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { printOutput, formatTable, renderBoxTable } from '../lib/printer.js';
import { c } from '../lib/colors.js';
import { shortenTicketId } from '../lib/id.js';
import type { RepoConfig } from '../services/repo-registry.js';
import { upsertRepo, repoIdExists, validateRepoConfig } from '../services/repo-store.js';
import { canPrompt, promptSelect, promptText, promptConfirm, promptMultiSelect } from '../lib/interactive.js';
import { loadLabels } from '../services/label-store.js';
import { parseRemote } from '../services/repo-registry.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { wizardAttempt } from '../lib/wizard.js';

interface DetectedRepoInfo {
  path: string;
  id?: string;
  provider?: RepoConfig['provider'];
  remote?: string;
  default_branch?: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repository commands')
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston repo list\n  $ houston repo add --interactive\n  $ houston repo add --id repo.web --provider github --remote git@github.com:org/web.git --default-branch main\n`,
    );

  repo
    .command('list')
    .description('List configured repositories and ticket links')
    .option('-j, --json', 'output as JSON')
    .action(async (options: { json?: boolean }) => {
      await handleRepoList(options);
    })
    .addHelpText('after', `\nExamples:\n  $ houston repo list\n  $ houston repo list --json\n`);

  repo
    .command('add')
    .description('Add or update a repository in repos/repos.yaml')
    .option('--id <id>', 'repository id (e.g. repo.web)')
    .option('--provider <name>', 'provider (github|gitlab|bitbucket)')
    .option('--remote <url>', 'git remote (ssh or https)')
    .option('--default-branch <name>', 'default branch name (e.g. main)')
    .option('--prefix-epic <value>', 'branch prefix for epics (default epic)')
    .option('--prefix-story <value>', 'branch prefix for stories (default story)')
    .option('--prefix-subtask <value>', 'branch prefix for subtasks (default subtask)')
    .option('--prefix-bug <value>', 'branch prefix for bugs (default bug)')
    .option('--pr-open-by-default', 'open PRs by default for new branches')
    .option('--pr-base <name>', 'default PR base branch (defaults to default branch)')
    .option('--pr-labels <list>', 'comma separated default PR labels')
    .option('--pr-reviewers-from-ticket-approvers', 'add ticket approvers as PR reviewers')
    .option('--require-status-checks', 'require status checks (metadata only)')
    .option('--disallow-force-push', 'disallow force push (metadata only)')
    .option('-i, --interactive', 'prompt for fields when omitted')
    .action(async (opts) => {
      await handleRepoAdd(opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ houston repo add --interactive\n  $ houston repo add --id repo.web --provider github --remote git@github.com:org/web.git --default-branch main \\\n      --prefix-epic epic --prefix-story story --prefix-subtask subtask --prefix-bug fix \\\n      --pr-open-by-default --pr-base main --pr-labels frontend,ci --pr-reviewers-from-ticket-approvers \\\n      --require-status-checks --disallow-force-push\n`,
    );
}

async function handleRepoList(options: { json?: boolean }): Promise<void> {
  const { analytics } = loadAnalytics();

  const payload = {
    count: analytics.repoUsage.length,
    repos: analytics.repoUsage.map((entry) => ({
      id: entry.config.id,
      provider: entry.config.provider,
      remote: entry.config.remote,
      ticketIds: entry.tickets.map((ticket) => ticket.id),
    })),
    unknownReferences: analytics.unknownRepoTickets.map((ticket) => ticket.id),
  };

  const lines: string[] = [];
  if (analytics.repoUsage.length === 0) {
    lines.push('No repositories configured.');
  } else {
    const rows = analytics.repoUsage.map((entry) => ({
      id: entry.config.id,
      provider: entry.config.provider,
      remote: entry.config.remote ?? '-',
      tickets: entry.tickets.length ? entry.tickets.map((t) => shortenTicketId(t.id)).join(',') : '-',
    }));
    const table = formatTable(rows, [
      { header: 'ID', value: (row) => row.id },
      { header: 'Provider', value: (row) => row.provider },
      { header: 'Remote', value: (row) => row.remote ?? '-' },
      { header: 'Tickets', value: (row) => row.tickets },
    ]);
    lines.push(...table);
  }

  if (analytics.unknownRepoTickets.length) {
    lines.push('');
    const unknown = analytics.unknownRepoTickets.map((t) => shortenTicketId(t.id)).join(', ');
    lines.push(c.warn(`Unknown repo references: ${unknown}`));
  }

  printOutput(payload, lines, options);
}

function loadAnalytics(): { analytics: WorkspaceAnalytics } {
  const config = loadConfig();
  const inventory = collectWorkspaceInventory(config);
  const analytics = buildWorkspaceAnalytics(inventory);
  return { analytics };
}

async function handleRepoAdd(opts: Record<string, unknown>): Promise<void> {
  const config = loadConfig();
  const interactive = Boolean(opts.interactive || !opts.id || !opts.provider || !opts.remote || !opts['default-branch']);
  if (interactive && !canPrompt()) {
    throw new Error('Missing required options. Re-run with --interactive in a terminal or provide flags.');
  }

  const defaults = {
    id: String(opts.id ?? ''),
    provider: String(opts.provider ?? ''),
    remote: String(opts.remote ?? ''),
    default_branch: String(opts['default-branch'] ?? 'main'),
    branch_prefix: {
      epic: String(opts['prefix-epic'] ?? 'epic'),
      story: String(opts['prefix-story'] ?? 'story'),
      subtask: String(opts['prefix-subtask'] ?? 'subtask'),
      bug: String(opts['prefix-bug'] ?? 'bug'),
    },
    pr: {
      open_by_default: Boolean(opts['pr-open-by-default'] ?? false),
      base: (opts['pr-base'] as string | undefined) ?? undefined,
      labels: splitCsv(String(opts['pr-labels'] ?? '')),
      reviewers_from_ticket_approvers: Boolean(opts['pr-reviewers-from-ticket-approvers'] ?? false),
    },
    protections: {
      require_status_checks: Boolean(opts['require-status-checks'] ?? false),
      disallow_force_push: Boolean(opts['disallow-force-push'] ?? false),
    },
  } as RepoConfig;

  let record: RepoConfig = defaults;
  if (interactive) {
    const result = await promptRepoDetails(config, defaults);
    if (!result) {
      console.log('Aborted. No changes saved.');
      return;
    }
    record = result;
  }

  const errors = validateRepoConfig(record);
  if (errors.length) {
    throw new Error(`Invalid repo configuration:\n- ${errors.join('\n- ')}`);
  }

  if (repoIdExists(config, record.id)) {
    if (interactive) {
      const overwrite = await promptConfirm(`Repo ${record.id} exists. Update it?`, false);
      if (!overwrite) {
        console.log('Aborted without changes.');
        return;
      }
    } else {
      // Non-interactive: proceed to update silently.
    }
  }

  upsertRepo(config, record);
  console.log(c.ok(`Recorded ${c.id(record.id)} in repos/repos.yaml`));

  if (interactive && canPrompt()) {
    while (true) {
      const again = await yesNo('Add another repository?', false);
      if (!again) break;
      const next = await promptRepoDetails(config, {
        id: '',
        provider: 'github',
        remote: '',
        default_branch: 'main',
        branch_prefix: { epic: 'epic', story: 'story', subtask: 'subtask', bug: 'bug' },
      } as RepoConfig);
      if (!next) {
        console.log('Aborted. No additional repositories added.');
        continue;
      }
      const errs = validateRepoConfig(next);
      if (errs.length) {
        console.log(c.warn(`Skipped entry due to errors:\n- ${errs.join('\n- ')}`));
        continue;
      }
      upsertRepo(config, next);
      console.log(c.ok(`Recorded ${c.id(next.id)} in repos/repos.yaml`));
    }
  }
}

async function promptRepoDetails(config: ReturnType<typeof loadConfig>, initial: RepoConfig): Promise<RepoConfig | null> {
  let detected: DetectedRepoInfo | undefined;

  while (true) {
    const method = await promptSelect(
      'How would you like to add this repository?',
      [
        { label: 'Detect from local path (git repo directory)', value: 'path' },
        { label: 'Enter details manually', value: 'manual' },
      ],
      { defaultValue: 'manual', allowCustom: false },
    );

    if (method === 'path') {
      const detection = await wizardAttempt(() => detectRepoFromPath(initial), {
        allowBack: true,
        prompt: 'Path detection failed. What next?',
      });
      if (detection.status === 'ok' && detection.value) {
        detected = detection.value;
        break;
      }
      if (detection.status === 'back') {
        continue; // choose method again
      }
      return null;
    }

    detected = undefined;
    break;
  }

  let record = await collectRepoDetails(config, initial, detected);
  const confirmed = await reviewRepoRecord(config, record);
  if (!confirmed) {
    return null;
  }
  return record;
}

async function detectRepoFromPath(initial: RepoConfig): Promise<DetectedRepoInfo> {
  const input = await promptText('Local repository path (absolute or relative)', { required: true });
  const repoPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(repoPath) || !fs.lstatSync(repoPath).isDirectory()) {
    throw new Error(`Path not found or not a directory: ${repoPath}`);
  }
  const inGitWorktree = fs.existsSync(path.join(repoPath, '.git')) || run('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree']).ok;
  if (!inGitWorktree) {
    throw new Error('The provided path is not a git repository');
  }

  const info: DetectedRepoInfo = { path: repoPath };

  const remotes = run('git', ['-C', repoPath, 'remote', '-v']).stdout;
  const lines = remotes.split(/\r?\n/).filter(Boolean);
  const origin = lines.find((l) => l.startsWith('origin\t')) || lines[0];
  if (origin) {
    const m = origin.match(/\t([^\s]+)\s+\((fetch|push)\)/);
    if (m) info.remote = m[1];
  }

  if (info.remote) {
    const parsed = parseRemote(info.remote);
    if (parsed?.host?.includes('github')) {
      info.provider = 'github';
    }
  } else {
    info.provider = 'local';
  }

  info.id = suggestRepoIdFromPath(repoPath);

  const headRef = run('git', ['-C', repoPath, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).stdout.trim();
  if (headRef && headRef.includes('/')) {
    info.default_branch = headRef.split('/').pop();
  } else {
    const current = run('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    if (current && current !== 'HEAD') info.default_branch = current;
  }

  if (!info.provider) {
    info.provider = (initial.provider as RepoConfig['provider']) ?? 'github';
  }

  return info;
}

async function collectRepoDetails(
  config: ReturnType<typeof loadConfig>,
  initial: RepoConfig,
  detected?: DetectedRepoInfo,
): Promise<RepoConfig> {
  const defaultIdCandidate = detected?.id ?? (initial.id && initial.id.trim() !== '' ? initial.id : undefined) ?? 'repo.sample';
  let id = await promptText('Repository id (e.g., repo.web)', {
    defaultValue: defaultIdCandidate,
    required: true,
    validate: (val) => (/^[a-z0-9][a-z0-9._-]*$/.test(val) ? null : 'Use lowercase id: ^[a-z0-9][a-z0-9._-]*$'),
  });
  id = id.trim();

  const provChoices = [
    { label: 'GitHub', value: 'github' },
    { label: 'Local only (no remote)', value: 'local' },
    { label: 'GitLab', value: 'gitlab' },
    { label: 'Bitbucket', value: 'bitbucket' },
  ];
  const provider =
    (await promptSelect('Provider', provChoices, {
      defaultValue: detected?.provider ?? initial.provider ?? 'github',
      allowCustom: false,
    })) ?? 'github';

  let remote: string | undefined;
  if (provider !== 'local') {
    remote = await promptText('Remote (ssh/https, e.g., git@github.com:org/repo.git)', {
      defaultValue: detected?.remote ?? initial.remote ?? '',
      required: true,
      validate: (val) => (val.trim().length ? null : 'Remote is required.'),
    });
    remote = remote.trim();
  }

  const defaultBranch = await promptText('Default branch', {
    defaultValue: detected?.default_branch ?? initial.default_branch ?? 'main',
    required: true,
    validate: (val) => (val.trim().length ? null : 'Default branch is required.'),
  });

  const branchPrefix = {
    epic: await promptBranchPrefix('Branch prefix — epic', initial.branch_prefix?.epic ?? 'epic'),
    story: await promptBranchPrefix('Branch prefix — story', initial.branch_prefix?.story ?? 'story'),
    subtask: await promptBranchPrefix('Branch prefix — subtask', initial.branch_prefix?.subtask ?? 'subtask'),
    bug: await promptBranchPrefix('Branch prefix — bug', initial.branch_prefix?.bug ?? 'bug'),
  } as RepoConfig['branch_prefix'];

  const prSettings = await promptPrSettings(config, initial.pr);
  const protections = await promptProtections(initial.protections);

  return {
    id,
    provider: provider as RepoConfig['provider'],
    ...(provider !== 'local' && remote ? { remote } : {}),
    default_branch: defaultBranch.trim(),
    branch_prefix: branchPrefix,
    pr: prSettings,
    protections,
  };
}

async function reviewRepoRecord(config: ReturnType<typeof loadConfig>, record: RepoConfig): Promise<boolean> {
  while (true) {
    displayRepoSummary(record);
    const choice = await promptSelect(
      'Adjust repository configuration?',
      [
        { label: 'Looks good – save', value: 'done' },
        { label: 'Change repository id', value: 'id' },
        { label: 'Change provider', value: 'provider' },
        { label: 'Change remote URL', value: 'remote' },
        { label: 'Change default branch', value: 'defaultBranch' },
        { label: 'Edit branch prefixes', value: 'prefixes' },
        { label: 'Edit PR defaults', value: 'pr' },
        { label: 'Edit branch protections', value: 'protections' },
        { label: 'Cancel without saving', value: 'cancel' },
      ],
      { defaultValue: 'done', allowCustom: false },
    );

    switch (choice) {
      case 'done':
        return true;
      case 'cancel':
        return false;
      case 'id': {
        const next = await promptText('Repository id', {
          defaultValue: record.id,
          required: true,
          validate: (val) => (/^[a-z0-9][a-z0-9._-]*$/.test(val) ? null : 'Use lowercase id: ^[a-z0-9][a-z0-9._-]*$'),
        });
        record.id = next.trim();
        break;
      }
      case 'provider': {
        const prov = (await promptSelect('Provider', [
          { label: 'GitHub', value: 'github' },
          { label: 'Local only (no remote)', value: 'local' },
          { label: 'GitLab', value: 'gitlab' },
          { label: 'Bitbucket', value: 'bitbucket' },
        ], { defaultValue: record.provider, allowCustom: false })) as RepoConfig['provider'];
        record.provider = prov ?? record.provider;
        if (record.provider === 'local') {
          delete record.remote;
        } else if (!record.remote) {
          const remote = await promptText('Remote (ssh/https)', {
            required: true,
            validate: (val) => (val.trim().length ? null : 'Remote is required.'),
          });
          record.remote = remote.trim();
        }
        break;
      }
      case 'remote': {
        if (record.provider === 'local') {
          console.log(c.warn('Provider is set to local; update the provider before configuring a remote.'));
          break;
        }
        const remote = await promptText('Remote (ssh/https)', {
          defaultValue: record.remote ?? '',
          required: true,
          validate: (val) => (val.trim().length ? null : 'Remote is required.'),
        });
        record.remote = remote.trim();
        break;
      }
      case 'defaultBranch': {
        const branch = await promptText('Default branch', {
          defaultValue: record.default_branch,
          required: true,
          validate: (val) => (val.trim().length ? null : 'Default branch is required.'),
        });
        record.default_branch = branch.trim();
        break;
      }
      case 'prefixes': {
        record.branch_prefix = {
          epic: await promptBranchPrefix('Branch prefix — epic', record.branch_prefix?.epic ?? 'epic'),
          story: await promptBranchPrefix('Branch prefix — story', record.branch_prefix?.story ?? 'story'),
          subtask: await promptBranchPrefix('Branch prefix — subtask', record.branch_prefix?.subtask ?? 'subtask'),
          bug: await promptBranchPrefix('Branch prefix — bug', record.branch_prefix?.bug ?? 'bug'),
        };
        break;
      }
      case 'pr': {
        record.pr = await promptPrSettings(config, record.pr);
        break;
      }
      case 'protections': {
        record.protections = await promptProtections(record.protections);
        break;
      }
      default:
        break;
    }
  }
}

function displayRepoSummary(record: RepoConfig): void {
  const rows: string[][] = [
    [c.bold('Field'), c.bold('Value')],
    ['id', record.id],
    ['provider', record.provider],
    ['remote', record.remote ?? '-'],
    ['default_branch', record.default_branch],
    [
      'branch_prefix',
      `epic=${record.branch_prefix?.epic}, story=${record.branch_prefix?.story}, subtask=${record.branch_prefix?.subtask}, bug=${record.branch_prefix?.bug}`,
    ],
  ];

  if (record.pr) {
    rows.push([
      'pr',
      `open=${record.pr.open_by_default ? 'yes' : 'no'}, base=${record.pr.base ?? '-'}, labels=${(record.pr.labels ?? []).join(',') || '-'}, reviewers=${
        record.pr.reviewers_from_ticket_approvers ? 'yes' : 'no'
      }`,
    ]);
  }

  if (record.protections) {
    rows.push([
      'protections',
      `require_checks=${record.protections.require_status_checks ? 'yes' : 'no'}, disallow_force=${record.protections.disallow_force_push ? 'yes' : 'no'}`,
    ]);
  }

  console.log('');
  console.log(c.heading('Repository configuration'));
  for (const line of renderBoxTable(rows)) {
    console.log(line);
  }
  console.log('');
}

async function promptBranchPrefix(question: string, current: string): Promise<string> {
  const value = await promptText(question, {
    defaultValue: current,
    required: true,
    validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use ^[a-z0-9][a-z0-9_-]*$'),
  });
  return value.trim();
}

async function promptPrSettings(
  config: ReturnType<typeof loadConfig>,
  existing: RepoConfig['pr'] | undefined,
): Promise<RepoConfig['pr']> {
  const openByDefault = await yesNo('Open PR by default for new branches?', Boolean(existing?.open_by_default));
  const prBase = await promptText('PR base branch (optional, defaults to default branch)', {
    defaultValue: existing?.base ?? '',
    allowEmpty: true,
  });

  let labels: string[] = [];
  const availableLabels = loadLabels(config);
  if (availableLabels.length) {
    labels = await promptMultiSelect('Default PR labels (optional)', availableLabels, {
      defaultValue: existing?.labels ?? [],
      required: false,
      allowEmpty: true,
    });
  } else {
    const raw = await promptText('Default PR labels (comma separated, optional)', {
      defaultValue: (existing?.labels ?? []).join(', '),
      allowEmpty: true,
    });
    labels = splitCsv(raw);
  }

  const reviewersFromApprovers = await yesNo('Add ticket approvers as PR reviewers?', Boolean(existing?.reviewers_from_ticket_approvers));

  return {
    open_by_default: openByDefault,
    base: prBase.trim() === '' ? undefined : prBase.trim(),
    labels,
    reviewers_from_ticket_approvers: reviewersFromApprovers,
  };
}

async function promptProtections(existing: RepoConfig['protections'] | undefined): Promise<RepoConfig['protections']> {
  const requireChecks = await yesNo('Require status checks? (metadata only)', Boolean(existing?.require_status_checks));
  const disallowForce = await yesNo('Disallow force push? (metadata only)', Boolean(existing?.disallow_force_push));
  return {
    require_status_checks: requireChecks,
    disallow_force_push: disallowForce,
  };
}

function splitCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function yesNo(question: string, defaultValue = false): Promise<boolean> {
  if (!canPrompt()) return defaultValue;
  return promptConfirm(question, defaultValue);
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    const ok = typeof res.status === 'number' ? res.status === 0 : true;
    return { ok, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  } catch {
    return { ok: false, stdout: '', stderr: '' };
  }
}

function suggestRepoIdFromPath(repoPath: string): string {
  const dirName = path.basename(repoPath);
  const normalized = dirName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  const suffix = normalized || 'repo';
  const candidate = `repo.${suffix}`;
  return ID_PATTERN.test(candidate) ? candidate : 'repo.sample';
}
