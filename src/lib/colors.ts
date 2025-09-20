import process from 'node:process';
import chalk from 'chalk';

let enabled = computeDefaultEnabled();

function computeDefaultEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  // Default to TTY-based color enabling.
  return Boolean(process.stdout.isTTY);
}

export function isEnabled(): boolean {
  return enabled;
}

export function setEnabled(value: boolean): void {
  enabled = value;
}

function apply(style: (s: string) => string, text: string): string {
  return enabled ? style(text) : text;
}

// Status color mapping used across lists.
const STATUS_COLORS: Record<string, (s: string) => string> = {
  backlog: chalk.gray,
  ready: chalk.cyan,
  'in progress': chalk.blue,
  blocked: chalk.yellow,
  'in review': chalk.magenta,
  done: chalk.green,
  archived: chalk.gray,
  canceled: chalk.dim,
};

export const c = {
  bold: (s: string) => apply(chalk.bold, s),
  dim: (s: string) => apply(chalk.dim, s),
  heading: (s: string) => apply(chalk.cyan.bold, s),
  subheading: (s: string) => apply(chalk.cyan, s),
  ok: (s: string) => apply(chalk.green, s),
  warn: (s: string) => apply(chalk.yellow, s),
  error: (s: string) => apply(chalk.red, s),
  id: (s: string) => apply(chalk.cyan, s),
  value: (s: string) => (enabled ? s : s),
  status: (name?: string) => {
    if (!name) return '';
    const key = name.toLowerCase();
    const fn = STATUS_COLORS[key] ?? chalk.white;
    return apply(fn, name);
  },
};

export type Colors = typeof c;
