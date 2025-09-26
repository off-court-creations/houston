import fs from 'node:fs';

export const IGNORED_DIRECTORY_ENTRIES = new Set(['.', '..', '.git', '.gitignore', '.gitattributes', '.DS_Store']);

export function ensureDirectory(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    return;
  }
  const stats = fs.statSync(targetDir);
  if (!stats.isDirectory()) {
    throw new Error(`Target ${targetDir} exists and is not a directory.`);
  }
}

export function hasMeaningfulEntries(targetDir: string): boolean {
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

export function listMeaningfulEntries(targetDir: string): string[] {
  if (!fs.existsSync(targetDir)) return [];
  try {
    return fs
      .readdirSync(targetDir)
      .filter((entry) => !IGNORED_DIRECTORY_ENTRIES.has(entry));
  } catch {
    return [];
  }
}
