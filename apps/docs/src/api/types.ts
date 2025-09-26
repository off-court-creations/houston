export interface ApiResponseOk<T> {
  ok: true;
  result?: T;
  snapshot?: unknown;
  accounts?: Array<{ account: string; label: string }>;
  owners?: string[];
}

export interface ApiResponseErr {
  ok: false;
  error: string;
  message?: string;
}

export type ApiResponse<T = unknown> = ApiResponseOk<T> | ApiResponseErr;

export interface WorkspaceCreatePayload {
  directory: string;
  force?: boolean;
  git?: boolean;
  remoteUrl?: string;
  createRemote?: string; // owner/repo
  host?: string;
  visibility?: "private" | "public";
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

export type SprintMini = {
  id: string;
  status: string;
  pretty: string;
  startDate?: string;
  endDate?: string;
};

export type QueueMini = {
  path: string;
  ticketIds: string[];
  missing: string[];
};

export type RepoMini = {
  id: string;
  provider?: string;
  remote?: string;
  ticketIds: string[];
};

export interface WorkspaceSnapshot {
  workspace: { workspaceRoot: string; trackingRoot: string; schemaDir: string };
  summary: {
    totalTickets: number;
    backlogCount: number;
    nextSprintCount: number;
    repoCount: number;
    componentCount: number;
    labelCount: number;
    userCount: number;
    activeSprintCount: number;
  };
  sprints: {
    active: SprintMini[];
    upcoming: SprintMini[];
    completed: SprintMini[];
  };
  backlog: QueueMini;
  nextSprint: QueueMini;
  repos: { configured: RepoMini[]; unknownReferences: string[] };
  components?: string[];
}
