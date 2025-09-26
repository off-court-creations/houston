import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandHistoryEntry } from './history.js';

interface CoachSection {
  id: string;
  title: string;
  body: string;
}

let workspaceDocsCache: CoachSection[] | null = null;

function loadDocSections(): CoachSection[] {
  if (workspaceDocsCache) return workspaceDocsCache;
  try {
    const here = path.dirname(fileURLToPath(new URL('../', import.meta.url)));
    const docPath = path.join(here, '..', 'CLI_COMMANDS.md');
    const text = fs.readFileSync(docPath, 'utf8');
    workspaceDocsCache = extractSections(text);
  } catch {
    workspaceDocsCache = [];
  }
  return workspaceDocsCache;
}

function extractSections(text: string): CoachSection[] {
  const lines = text.split(/\r?\n/);
  const sections: CoachSection[] = [];
  let current: CoachSection | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (current) sections.push(current);
      current = {
        id: heading[1]!.toLowerCase(),
        title: heading[1]!,
        body: '',
      };
      continue;
    }
    if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);
  return sections;
}

export interface CoachingTip {
  title: string;
  detail: string;
}

export type CoachingStep = 'directory' | 'git' | 'remote' | 'followups' | 'summary';

export function getCoachingTips(step: CoachingStep, history: CommandHistoryEntry[]): CoachingTip[] {
  const sections = loadDocSections();
  const tips: CoachingTip[] = [];

  const workspaceSection = sections.find((section) => section.id.toLowerCase().includes('workspace'));
  const repoSection = sections.find((section) => section.id.toLowerCase().includes('repo'));
  const backlogSection = sections.find((section) => section.id.toLowerCase().includes('backlog'));

  switch (step) {
    case 'directory': {
      if (workspaceSection) {
        tips.push({
          title: 'Workspace Layout',
          detail: snippet(workspaceSection.body, 3),
        });
      }
      const prior = history.find((entry) => entry.command.includes('workspace new'));
      if (prior) {
        tips.push({
          title: 'Reuse Past Setup',
          detail: `You last ran ${prior.command} on ${formatDate(prior.timestamp)} — align directory naming for consistency.`,
        });
      }
      break;
    }
    case 'git': {
      tips.push({
        title: 'Git Automation',
        detail: 'Houston can auto-commit and push initial scaffolding. Disable git init only for throwaway sandboxes.',
      });
      const hasAuto = history.some((entry) => entry.command.includes('git clone'));
      if (hasAuto && workspaceSection) {
        tips.push({
          title: 'Link Existing Repos',
          detail: 'Since you recently cloned repositories, consider linking them as defaults during setup.',
        });
      }
      break;
    }
    case 'remote': {
      if (repoSection) {
        tips.push({
          title: 'Repository Links',
          detail: snippet(repoSection.body, 2),
        });
      }
      const usedAuth = history.find((entry) => entry.command.includes('auth login'));
      tips.push({
        title: usedAuth ? 'Accounts Ready' : 'Authenticate for Automation',
        detail: usedAuth
          ? `GitHub auth detected from ${formatDate(usedAuth.timestamp)} — you can reuse that account for remote creation.`
          : 'Run `houston auth login github` first to let Houston create repositories for you.',
      });
      break;
    }
    case 'followups': {
      if (backlogSection) {
        tips.push({
          title: 'Plan First Sprint',
          detail: snippet(backlogSection.body, 2),
        });
      }
      const hasRepoAdd = history.some((entry) => entry.command.includes('repo add'));
      if (hasRepoAdd) {
        tips.push({
          title: 'Reuse Repository Templates',
          detail: 'You recently ran `houston repo add`; import that configuration to avoid duplicate prompts.',
        });
      }
      break;
    }
    case 'summary': {
      tips.push({
        title: 'Next Steps',
        detail: 'Use `houston workspace info` after creation to confirm tracking paths and sprint status.',
      });
      break;
    }
    default:
      break;
  }

  return tips;
}

function snippet(body: string, maxLines: number): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('|'));
  const slice = lines.slice(0, maxLines);
  return slice.join(' ');
}

function formatDate(ts: string): string {
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts;
    return date.toISOString().slice(0, 10);
  } catch {
    return ts;
  }
}
