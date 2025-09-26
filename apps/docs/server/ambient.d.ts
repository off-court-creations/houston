declare module "../../../src/services/workspace-create.ts" {
  export interface WorkspaceCreateOptions {
    directory: string;
    force?: boolean;
    git?: boolean;
    remote?: string;
    createRemote?: string;
    host?: string;
    private?: boolean;
    public?: boolean;
    push?: boolean;
    authLabel?: string;
  }
  export interface WorkspaceCreateResult {
    workspaceRoot: string;
    gitInitialized: boolean;
    remoteUrl?: string;
    pushed: boolean;
    createdRemote?: string;
    messages: string[];
  }
  export function createWorkspace(
    options: WorkspaceCreateOptions,
  ): Promise<WorkspaceCreateResult>;
}

declare module "../../../src/services/workspace-info.ts" {
  export interface WorkspaceInfoSnapshot {
    workspace: {
      workspaceRoot: string;
      trackingRoot: string;
      schemaDir: string;
    };
    summary: unknown;
    sprints: { active: unknown[]; upcoming: unknown[]; completed: unknown[] };
    backlog: { path: string; ticketIds: string[]; missing: string[] };
    nextSprint: { path: string; ticketIds: string[]; missing: string[] };
    repos: {
      configured: Array<{
        id: string;
        provider?: string;
        remote?: string;
        ticketIds: string[];
      }>;
      unknownReferences: string[];
    };
  }
  export function getWorkspaceSnapshot(options?: { cwd?: string }): WorkspaceInfoSnapshot;
}

declare module "../../../src/services/secrets.ts" {
  export function listAccounts(service: string): Promise<string[]>;
  export function getSecret(
    service: string,
    account: string,
  ): Promise<string | null>;
}

declare module "../../../src/services/user-config.ts" {
  export function readUserConfig(): { workspace_path?: string };
  export function setDefaultWorkspace(root: string): void;
}
