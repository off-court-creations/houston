import { spawnSync } from 'node:child_process';

/** Lightweight fzf integration with graceful fallback detection. */
export function hasFzf(): boolean {
  try {
    const res = spawnSync('fzf', ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Presents a list of lines to fzf and returns the selected line(s).
 * The caller should encode any metadata (e.g., IDs) into each line
 * so it can be parsed after selection.
 */
export function fzfSelect(
  lines: string[],
  opts: {
    multi?: boolean;
    header?: string;
    height?: number | string;
    previewCmd?: string;
    previewWindow?: string; // e.g., 'right,60%'
  } = {},
): string[] | null {
  const args = ['--ansi'];
  if (opts.header) args.push('--header', opts.header);
  if (opts.multi) args.push('--multi');
  if (opts.height !== undefined) args.push('--height', String(opts.height));
  if (opts.previewCmd) {
    args.push('--preview', opts.previewCmd);
    if (opts.previewWindow) args.push('--preview-window', opts.previewWindow);
  }
  try {
    const res = spawnSync('fzf', args, {
      input: lines.join('\n'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (res.status !== 0) return null; // cancelled
    const out = (res.stdout ?? '').trim();
    if (!out) return null;
    return out.split('\n');
  } catch {
    return null;
  }
}
