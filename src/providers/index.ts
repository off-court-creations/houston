import type { RepoConfig } from '../services/repo-registry.js';
import type { Provider } from './types.js';
import { GitHubProvider } from './github.js';

export function createProvider(repo: RepoConfig): Provider | null {
  try {
    switch (repo.provider) {
      case 'github':
        return new GitHubProvider(repo);
      default:
        return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[warn] Provider unavailable for ${repo.id}: ${message}\n`);
    return null;
  }
}
