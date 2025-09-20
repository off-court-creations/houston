import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import type { CliConfig } from '../config/config.js';
import { getRepo } from '../services/repo-registry.js';
import { createProvider } from '../providers/index.js';
import { loadTicket, saveTicket, type TicketRecord, type HistoryEventInput } from '../services/ticket-store.js';
import { resolveActor, resolveTimestamp } from '../utils/runtime.js';
import { c } from '../lib/colors.js';

interface CodeStartOptions {
  repo: string[];
  branch?: string;
  provider?: boolean;
}

interface CodeLinkOptions {
  repo: string;
  branch: string;
  pr?: number;
  url?: string;
  base?: string;
}

interface CodeOpenPrOptions {
  repo: string;
  number?: number;
  url?: string;
  base?: string;
  head?: string;
  provider?: boolean;
}

interface CodeRepoEntry {
  repo_id: string;
  branch?: string;
  created_by?: string;
  created_at?: string;
  last_synced_at?: string;
  pr?: {
    number?: number;
    url?: string;
    base?: string;
    head?: string;
    state?: string;
  };
  [key: string]: unknown;
}

export function registerCodeCommand(program: Command): void {
  const code = program
    .command('code')
    .description('Code integration helpers')
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate ticket code start ST-123 --repo repo.web\n  $ stardate ticket code link ST-123 --repo repo.web --branch feat/ST-123--checkout\n  $ stardate ticket code open-pr ST-123 --repo repo.web --base main\n  $ stardate ticket code sync ST-123\nNotes:\n  - Provider integration requires credentials (e.g. STARDATE_GITHUB_TOKEN).\n`,
    );

  code
    .command('start')
    .description('Prepare branches for a ticket')
    .argument('<ticketId>')
    .requiredOption('--repo <repoId>', 'repository id (can be passed multiple times)', collectValues, [])
    .option('--branch <branchName>', 'explicit branch name')
    .option('--no-provider', 'skip remote provider integration')
    .action(async (ticketId: string, options: CodeStartOptions) => {
      await handleCodeStart(ticketId, options);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate ticket code start ST-123 --repo repo.web\n  $ stardate ticket code start ST-123 --repo repo.web --repo repo.api\n  $ stardate ticket code start ST-123 --repo repo.web --branch feat/ST-123--checkout\n`,
    );

  code
    .command('link')
    .description('Attach an existing branch (and optional PR) to a ticket')
    .argument('<ticketId>')
    .requiredOption('--repo <repoId>', 'repository id')
    .requiredOption('--branch <branchName>', 'branch name')
    .option('--pr <number>', 'pull request number', (value) => Number.parseInt(value, 10))
    .option('--url <url>', 'pull request URL')
    .option('--base <branch>', 'pull request base branch')
    .action(async (ticketId: string, opts: CodeLinkOptions) => {
      await handleCodeLink(ticketId, opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate ticket code link ST-123 --repo repo.web --branch feat/ST-123--checkout\n  $ stardate ticket code link ST-123 --repo repo.web --branch feat/ST-123--checkout --pr 42\n`,
    );

  code
    .command('open-pr')
    .description('Record pull request details on a ticket')
    .argument('<ticketId>')
    .requiredOption('--repo <repoId>', 'repository id')
    .option('--number <pr>', 'PR number', (value) => Number.parseInt(value, 10))
    .option('--url <url>', 'PR URL')
    .option('--base <branch>', 'base branch name (defaults to repo config)')
    .option('--head <branch>', 'head branch name')
    .option('--no-provider', 'skip remote provider integration')
    .action(async (ticketId: string, opts: CodeOpenPrOptions) => {
      await handleOpenPr(ticketId, opts);
    })
    .addHelpText(
      'after',
      `\nExamples:\n  $ stardate ticket code open-pr ST-123 --repo repo.web --base main\n  $ stardate ticket code open-pr ST-123 --repo repo.web --number 42 --url https://github.com/org/repo/pull/42\n`,
    );

  code
    .command('sync')
    .description('Update last synced timestamp for ticket code metadata')
    .argument('<ticketId>')
    .option('--repo <repoId>', 'limit sync to a single repo')
    .action(async (ticketId: string, opts: { repo?: string }) => {
      await handleCodeSync(ticketId, opts.repo);
    })
    .addHelpText('after', `\nExamples:\n  $ stardate ticket code sync ST-123\n  $ stardate ticket code sync ST-123 --repo repo.web\n`);
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function handleCodeStart(ticketId: string, options: CodeStartOptions): Promise<void> {
  if (!options.repo || options.repo.length === 0) {
    throw new Error('At least one --repo must be provided');
  }
  const config = loadConfig();
  const actor = resolveActor();
  const now = resolveTimestamp();
  const ticket = loadTicket(config, ticketId);
  const { codeBlock, repos } = readCodeBlock(ticket);
  const branchName = options.branch ?? generateBranchName(ticketId, ticket.title as string | undefined, ticket.type);
  const historyEvents: HistoryEventInput[] = [];

  for (const repoId of options.repo) {
    const payload: CodeRepoEntry = {
      repo_id: repoId,
      branch: branchName,
      created_by: actor,
      created_at: now,
      last_synced_at: now,
    };
    const existing = repos.find((entry) => entry.repo_id === repoId);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      repos.push(payload);
    }
    historyEvents.push({ op: 'code.branch', repo_id: repoId, branch: branchName });

    if (options.provider !== false) {
      await ensureRemoteBranch(config, repoId, branchName);
    }
  }

  codeBlock.repos = repos;
  ticket.code = codeBlock;
  saveTicket(config, ticket, {
    actor,
    history: historyEvents,
  });
  console.log(`Linked branch ${branchName} for ${ticketId}`);
}

async function handleCodeLink(ticketId: string, opts: CodeLinkOptions): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const now = resolveTimestamp();
  const ticket = loadTicket(config, ticketId);
  const { codeBlock, repos } = readCodeBlock(ticket);
  let entry = repos.find((item) => item.repo_id === opts.repo);
  if (!entry) {
    entry = { repo_id: opts.repo };
    repos.push(entry);
  }
  entry.branch = opts.branch;
  entry.created_by = entry.created_by ?? actor;
  entry.created_at = entry.created_at ?? now;
  entry.last_synced_at = now;
  if (opts.pr) {
    entry.pr = {
      number: opts.pr,
      url: opts.url,
      base: opts.base,
      head: opts.branch,
      state: 'open',
    };
  }
  codeBlock.repos = repos;
  ticket.code = codeBlock;
  const history: HistoryEventInput = {
    op: opts.pr ? 'code.pr.link' : 'code.branch.link',
    repo_id: opts.repo,
    branch: opts.branch,
  };
  if (opts.pr) {
    history.number = opts.pr;
  }
  saveTicket(config, ticket, {
    actor,
    history,
  });
  console.log(`Linked ${opts.branch} on ${opts.repo} to ${ticketId}`);
}

async function handleOpenPr(ticketId: string, opts: CodeOpenPrOptions): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const now = resolveTimestamp();
  const ticket = loadTicket(config, ticketId);
  const { codeBlock, repos } = readCodeBlock(ticket);
  const entry = repos.find((item) => item.repo_id === opts.repo);
  if (!entry) {
    throw new Error(`No branch linked for repo ${opts.repo}`);
  }

  const headBranch = entry.branch ?? opts.head;
  if (!headBranch) {
    throw new Error('Head branch required to open a pull request');
  }

  const repoConfig = getRepo(config, opts.repo);
  const baseBranch =
    opts.base ??
    (typeof repoConfig.pr === 'object' && repoConfig.pr && 'base' in repoConfig.pr
      ? (repoConfig.pr as { base?: string }).base
      : undefined) ??
    repoConfig.default_branch ??
    'main';

  let prNumber = opts.number;
  let prUrl = opts.url;

  if (opts.provider !== false) {
    const result = await openRemotePullRequest(config, ticket, {
      repoId: opts.repo,
      head: headBranch,
      base: baseBranch,
      draft: false,
    }).catch((error) => {
      process.stderr.write(`[warn] Failed to open remote PR for ${opts.repo}: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    });
    if (result) {
      prNumber = prNumber ?? result.number;
      prUrl = prUrl ?? result.url;
    }
  }

  const resolvedNumber = prNumber ?? 0;
  const resolvedUrl = prUrl ?? '';
  entry.pr = {
    number: resolvedNumber,
    url: resolvedUrl,
    base: baseBranch,
    head: headBranch,
    state: 'open',
  } as Record<string, unknown>;
  entry.last_synced_at = now;
  codeBlock.repos = repos;
  ticket.code = codeBlock;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'code.pr.open',
      repo_id: opts.repo,
      number: resolvedNumber,
    },
  });
  console.log(c.ok(`Recorded PR #${resolvedNumber} for ${c.id(ticketId)}`));
}

async function handleCodeSync(ticketId: string, repoId?: string): Promise<void> {
  const config = loadConfig();
  const actor = resolveActor();
  const now = resolveTimestamp();
  const ticket = loadTicket(config, ticketId);
  const { codeBlock, repos } = readCodeBlock(ticket);
  if (repoId) {
    const entry = repos.find((item) => item.repo_id === repoId);
    if (entry) {
      entry.last_synced_at = now;
    }
  } else {
    for (const entry of repos) {
      entry.last_synced_at = now;
    }
  }
  codeBlock.repos = repos;
  ticket.code = codeBlock;
  saveTicket(config, ticket, {
    actor,
    history: {
      op: 'code.sync',
      repo_id: repoId,
    },
  });
  console.log(c.ok(`Updated sync timestamp for ${c.id(ticketId)}`));
}

async function ensureRemoteBranch(config: CliConfig, repoId: string, branch: string): Promise<void> {
  try {
    const repoConfig = getRepo(config, repoId);
    const provider = createProvider(repoConfig);
    if (!provider) {
      return;
    }
    await provider.ensureBranch({ branch, base: repoConfig.default_branch });
  } catch (error) {
    process.stderr.write(`[warn] Unable to create remote branch for ${repoId}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function openRemotePullRequest(
  config: CliConfig,
  ticket: TicketRecord,
  params: { repoId: string; head: string; base: string; draft?: boolean },
): Promise<{ number: number; url: string } | null> {
  try {
    const repoConfig = getRepo(config, params.repoId);
    const provider = createProvider(repoConfig);
    if (!provider) {
      return null;
    }
    const titleBase = ticket.title ?? ticket.summary ?? ticket.id;
    const title = `[${ticket.id}] ${titleBase}`;
    return await provider.openPullRequest({
      title,
      head: params.head,
      base: params.base,
      draft: params.draft ?? false,
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function generateBranchName(ticketId: string, title: string | undefined, type: TicketRecord['type']): string {
  const prefixMap: Record<TicketRecord['type'], string> = {
    epic: 'epic',
    story: 'feat',
    subtask: 'task',
    bug: 'fix',
  };
  const prefix = prefixMap[type];
  const slug = (title ?? ticketId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const finalSlug = slug.length > 0 ? slug : 'work';
  return `${prefix}/${ticketId}--${finalSlug}`;
}

function readCodeBlock(ticket: TicketRecord): { codeBlock: Record<string, unknown>; repos: CodeRepoEntry[] } {
  const codeBlock = { ...(ticket.code as Record<string, unknown> | undefined) };
  const reposRaw = Array.isArray((codeBlock as { repos?: unknown }).repos)
    ? (codeBlock as { repos?: CodeRepoEntry[] }).repos ?? []
    : [];
  const repos = reposRaw.map((entry) => ({ ...entry }));
  return { codeBlock, repos };
}
