import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { CliConfig } from '../config/config.js';
import { createLogger } from '../logger.js';
import type { ChangeType } from './mutation-tracker.js';

const logger = createLogger();

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string): RunResult {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

export function isGitRepo(cwd: string): boolean {
  const res = runGit(['rev-parse', '--git-dir'], cwd);
  return (res.status ?? 1) === 0;
}

export function currentBranch(cwd: string): string | null {
  const res = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if ((res.status ?? 1) !== 0) return null;
  const branch = res.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : null;
}

export function hasUpstream(cwd: string): boolean {
  const res = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  return (res.status ?? 1) === 0;
}

export function hasRemote(cwd: string, name = 'origin'): boolean {
  const res = runGit(['remote'], cwd);
  if ((res.status ?? 1) !== 0) return false;
  return res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).includes(name);
}

export function isClean(cwd: string): boolean {
  const res = runGit(['status', '--porcelain'], cwd);
  return (res.status ?? 1) === 0 && res.stdout.trim().length === 0;
}

export interface PrePullOptions {
  cwd: string;
  rebase?: boolean;
}

export function prePullIfNeeded({ cwd, rebase = true }: PrePullOptions): void {
  if (!isGitRepo(cwd)) return;
  if (!hasUpstream(cwd)) return;
  if (!isClean(cwd)) {
    logger.debug('Workspace has uncommitted changes; skipping pre-pull');
    return;
  }
  const args = ['pull'];
  if (rebase) args.push('--rebase');
  const res = runGit(args, cwd);
  if ((res.status ?? 1) !== 0) {
    logger.warn(`git pull failed: ${res.stderr.trim() || res.stdout.trim()}`);
  } else {
    logger.debug('Pre-pull completed');
  }
}

export interface AutoCommitOptions {
  cwd: string;
  trackingRoot: string;
  changeTypes: ChangeType[];
  pushPolicy: 'auto' | boolean;
  pullRebase?: boolean;
  commandPath?: string;
}

export function autoCommitAndMaybePush(opts: AutoCommitOptions): void {
  const { cwd, trackingRoot, changeTypes, pushPolicy, commandPath } = opts;
  if (!isGitRepo(cwd)) return;
  // Stage changes under tracking root
  const addRes = runGit(['add', '-A', '--', trackingRoot], cwd);
  if ((addRes.status ?? 1) !== 0) {
    logger.warn(`git add failed: ${addRes.stderr.trim() || addRes.stdout.trim()}`);
    return;
  }
  // Check if anything is staged
  const diffRes = runGit(['diff', '--cached', '--name-only'], cwd);
  if ((diffRes.status ?? 1) !== 0) return;
  const staged = diffRes.stdout.split(/\r?\n/).filter(Boolean);
  if (staged.length === 0) return;

  const message = buildCommitMessage(changeTypes, commandPath);
  const commitRes = runGit(['commit', '-m', message], cwd);
  if ((commitRes.status ?? 1) !== 0) {
    logger.warn(`git commit failed: ${commitRes.stderr.trim() || commitRes.stdout.trim()}`);
    return;
  }

  const shouldPush = resolvePushEnabled(pushPolicy, cwd);
  if (!shouldPush) return;

  if (hasUpstream(cwd)) {
    const pushRes = runGit(['push'], cwd);
    if ((pushRes.status ?? 1) !== 0) {
      logger.warn(`git push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
    }
    return;
  }

  const branch = currentBranch(cwd) ?? 'main';
  if (hasRemote(cwd, 'origin')) {
    const pushRes = runGit(['push', '-u', 'origin', branch], cwd);
    if ((pushRes.status ?? 1) !== 0) {
      logger.warn(`git push -u failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
    }
  }
}

export function buildCommitMessage(changeTypes: ChangeType[], commandPath?: string): string {
  const list = changeTypes.length ? changeTypes.join(', ') : 'workspace';
  const subject = `houston: update [${list}]`;
  const lines: string[] = [subject];
  if (commandPath) {
    lines.push('', `cmd: ${commandPath}`);
  }
  lines.push('', `Change-Types: ${list}`);
  return lines.join('\n');
}

export function deriveChangeTypesFromStatus(config: CliConfig, cwd: string): ChangeType[] {
  if (!isGitRepo(cwd)) return [];
  const relRoot = path.relative(cwd, config.tracking.root) || '.';
  const res = runGit(['status', '--porcelain', '--', relRoot], cwd);
  if ((res.status ?? 1) !== 0) return [];
  const files = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^..\s+/, '')); // strip porcelain status

  const types = new Set<ChangeType>();

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.startsWith('tickets/')) {
      types.add('tickets');
      continue;
    }
    if (normalized.startsWith('backlog/')) {
      types.add('backlog');
      continue;
    }
    if (normalized.startsWith('sprints/')) {
      types.add('sprints');
      continue;
    }
    if (normalized === 'repos/repos.yaml') {
      types.add('repos');
      continue;
    }
    if (normalized === 'repos/component-routing.yaml') {
      types.add('routing');
      continue;
    }
    if (normalized === 'people/users.yaml') {
      types.add('people');
      continue;
    }
    if (normalized === 'taxonomies/components.yaml') {
      types.add('components');
      continue;
    }
    if (normalized === 'taxonomies/labels.yaml') {
      types.add('labels');
      continue;
    }
    if (normalized.startsWith('schema/')) {
      types.add('schema');
      continue;
    }
    if (normalized === 'transitions.yaml') {
      types.add('transitions');
      continue;
    }
  }

  return Array.from(types.values()).sort();
}

function resolvePushEnabled(policy: 'auto' | boolean, cwd: string): boolean {
  if (policy === true) return true;
  if (policy === false) return false;
  // auto: enable when upstream exists or remote origin exists
  return hasUpstream(cwd) || hasRemote(cwd, 'origin');
}

