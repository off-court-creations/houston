import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { buildWorkspaceAnalytics, type WorkspaceAnalytics } from '../services/workspace-analytics.js';
import { collectWorkspaceInventory } from '../services/workspace-inventory.js';
import { printOutput, formatTable } from '../lib/printer.js';
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
    record = await promptRepoDetails(config, defaults);
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

async function promptRepoDetails(config: ReturnType<typeof loadConfig>, initial: RepoConfig): Promise<RepoConfig> {
  // Entry method
  const method = await promptSelect(
    'How would you like to add this repository?',
    [
      { label: 'Detect from local path (git repo directory)', value: 'path' },
      { label: 'Enter details manually', value: 'manual' },
    ],
    { defaultValue: 'manual', allowCustom: false },
  );

  let detected: Partial<RepoConfig> = {};
  if (method === 'path') {
    const input = await promptText('Local repository path (absolute or relative)', { required: true });
    const repoPath = path.resolve(process.cwd(), input);
    if (!fs.existsSync(repoPath) || !fs.lstatSync(repoPath).isDirectory()) {
      throw new Error(`Path not found or not a directory: ${repoPath}`);
    }
    const isGit = fs.existsSync(path.join(repoPath, '.git')) || run('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree']).ok;
    if (!isGit) {
      throw new Error('The provided path is not a git repository');
    }
    // Try to detect remote
    const remotes = run('git', ['-C', repoPath, 'remote', '-v']).stdout;
    let remoteUrl: string | undefined;
    const lines = remotes.split(/\r?\n/).filter(Boolean);
    const origin = lines.find((l) => l.startsWith('origin\t')) || lines[0];
    if (origin) {
      const m = origin.match(/\t([^\s]+)\s+\((fetch|push)\)/);
      if (m) remoteUrl = m[1];
    }
    let provider: RepoConfig['provider'] | string = initial.provider || 'github';
    if (remoteUrl) {
      const parsed = parseRemote(remoteUrl);
      if (parsed && parsed.host.includes('github')) provider = 'github';
      // else leave as initial or ask later
      detected.remote = remoteUrl;
    } else {
      provider = 'local';
    }
    detected.id = suggestRepoIdFromPath(repoPath);
    // Default branch detection (best-effort)
    let defaultBranch: string | undefined;
    const headRef = run('git', ['-C', repoPath, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).stdout.trim();
    if (headRef && headRef.includes('/')) {
      defaultBranch = headRef.split('/').pop();
    } else {
      const current = run('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
      if (current && current !== 'HEAD') defaultBranch = current;
    }
    detected.provider = provider as RepoConfig['provider'];
    if (defaultBranch) detected.default_branch = defaultBranch;
  }

  // ID
  const defaultIdCandidate = detected.id ?? (initial.id && initial.id.trim() !== '' ? initial.id : undefined) ?? 'repo.sample';
  let id = await promptText('Repository id (e.g., repo.web)', {
    defaultValue: defaultIdCandidate,
    required: true,
    validate: (val) => (/^[a-z0-9][a-z0-9._-]*$/.test(val) ? null : 'Use lowercase id: ^[a-z0-9][a-z0-9._-]*$'),
  });
  id = id.trim();

  // Provider
  const provChoices = [
    { label: 'GitHub', value: 'github' },
    { label: 'Local only (no remote)', value: 'local' },
    { label: 'GitLab', value: 'gitlab' },
    { label: 'Bitbucket', value: 'bitbucket' },
  ];
  const provider =
    (await promptSelect('Provider', provChoices, {
      defaultValue: (detected.provider as string) || initial.provider || 'github',
      allowCustom: false,
    })) ?? 'github';

  // Remote
  let remote = '';
  if (provider !== 'local') {
    remote = await promptText('Remote (ssh/https, e.g., git@github.com:org/repo.git)', {
      defaultValue: detected.remote ?? initial.remote ?? '',
      required: true,
      validate: (val) => (val.trim().length ? null : 'Remote is required.'),
    });
  }

  // Default branch
  const defaultBranch = await promptText('Default branch', {
    defaultValue: detected.default_branch || initial.default_branch || 'main',
    required: true,
    validate: (val) => (val.trim().length ? null : 'Default branch is required.'),
  });

  // Branch prefixes
  const epicPrefix = await promptText('Branch prefix — epic', {
    defaultValue: initial.branch_prefix?.epic || 'epic',
    required: true,
    validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use ^[a-z0-9][a-z0-9_-]*$'),
  });
  const storyPrefix = await promptText('Branch prefix — story', {
    defaultValue: initial.branch_prefix?.story || 'story',
    required: true,
    validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use ^[a-z0-9][a-z0-9_-]*$'),
  });
  const subtaskPrefix = await promptText('Branch prefix — subtask', {
    defaultValue: initial.branch_prefix?.subtask || 'subtask',
    required: true,
    validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use ^[a-z0-9][a-z0-9_-]*$'),
  });
  const bugPrefix = await promptText('Branch prefix — bug', {
    defaultValue: initial.branch_prefix?.bug || 'bug',
    required: true,
    validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use ^[a-z0-9][a-z0-9_-]*$'),
  });

  // PR defaults
  const openByDefault = await yesNo('Open PR by default for new branches?', Boolean(initial.pr?.open_by_default));
  const prBase = await promptText('PR base branch (optional, defaults to default branch)', {
    defaultValue: initial.pr?.base ?? '',
    allowEmpty: true,
  });

  let prLabels: string[] = [];
  const availableLabels = loadLabels(config);
  if (availableLabels.length) {
    prLabels = await promptMultiSelect('Default PR labels (optional)', availableLabels, {
      defaultValue: initial.pr?.labels ?? [],
      required: false,
      allowEmpty: true,
    });
  } else {
    const raw = await promptText('Default PR labels (comma separated, optional)', { defaultValue: (initial.pr?.labels ?? []).join(', ') });
    prLabels = splitCsv(raw);
  }

  const reviewersFromApprovers = await yesNo('Add ticket approvers as PR reviewers?', Boolean(initial.pr?.reviewers_from_ticket_approvers));

  // Protections
  const requireChecks = await yesNo('Require status checks? (metadata only)', Boolean(initial.protections?.require_status_checks));
  const disallowForce = await yesNo('Disallow force push? (metadata only)', Boolean(initial.protections?.disallow_force_push));

  const record: RepoConfig = {
    id,
    provider: provider as RepoConfig['provider'],
    ...(provider !== 'local' ? { remote: remote.trim() } : {}),
    default_branch: defaultBranch.trim(),
    branch_prefix: { epic: epicPrefix, story: storyPrefix, subtask: subtaskPrefix, bug: bugPrefix },
    pr: {
      open_by_default: openByDefault,
      base: prBase.trim() === '' ? undefined : prBase.trim(),
      labels: prLabels,
      reviewers_from_ticket_approvers: reviewersFromApprovers,
    },
    protections: {
      require_status_checks: requireChecks,
      disallow_force_push: disallowForce,
    },
  };

  // Final confirmation summary
  console.log(c.heading('Repository configuration:'));
  console.log(`  id: ${c.id(record.id)}`);
  console.log(`  provider: ${record.provider}`);
  console.log(`  remote: ${record.remote}`);
  console.log(`  default_branch: ${record.default_branch}`);
  console.log(
    `  branch_prefix: epic=${record.branch_prefix?.epic}, story=${record.branch_prefix?.story}, subtask=${record.branch_prefix?.subtask}, bug=${record.branch_prefix?.bug}`,
  );
  if (record.pr) {
    console.log(
      `  pr: open_by_default=${record.pr.open_by_default ? 'yes' : 'no'}, base=${record.pr.base ?? '-'}, labels=${(record.pr.labels ?? []).join(',') || '-'}, reviewers_from_ticket_approvers=${
        record.pr.reviewers_from_ticket_approvers ? 'yes' : 'no'
      }`,
    );
  }
  if (record.protections) {
    console.log(
      `  protections: require_status_checks=${record.protections.require_status_checks ? 'yes' : 'no'}, disallow_force_push=${record.protections.disallow_force_push ? 'yes' : 'no'}`,
    );
  }
  const ok = await yesNo('Save this repository?', true);
  if (!ok) {
    console.log('Aborted. No changes saved.');
    return initial; // not used further
  }
  return record;
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
