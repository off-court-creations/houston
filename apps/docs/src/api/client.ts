import type {
  ApiResponse,
  WorkspaceCreatePayload,
  WorkspaceCreateResult,
} from "@/api/types";

async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = (await res.json()) as ApiResponse<T>;
  return json;
}

export async function postWorkspaceNew(payload: WorkspaceCreatePayload) {
  return api<WorkspaceCreateResult>("/api/workspace/new", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

import type { WorkspaceSnapshot } from "@/api/types";

export async function getWorkspaceInfo(
  root?: string,
): Promise<
  | { ok: true; snapshot: WorkspaceSnapshot }
  | { ok: false; error: string; message?: string }
> {
  const url = new URL("/api/workspace/info", location.origin);
  if (root) url.searchParams.set("root", root);
  const res = await api<WorkspaceSnapshot>(url.pathname + url.search);
  if (res.ok) {
    const ok = res as { ok: true; snapshot: WorkspaceSnapshot };
    return { ok: true, snapshot: ok.snapshot };
  }
  return res as { ok: false; error: string; message?: string };
}

export async function getGithubAccounts(host: string) {
  const url = new URL("/api/github/accounts", location.origin);
  url.searchParams.set("host", host);
  return api<{ account: string; label: string }[]>(url.pathname + url.search);
}

export async function getGithubOwners(host: string, account?: string) {
  const url = new URL("/api/github/owners", location.origin);
  url.searchParams.set("host", host);
  if (account) url.searchParams.set("account", account);
  return api<string[]>(url.pathname + url.search);
}

export async function getDefaultWorkspace(): Promise<
  | { ok: true; root: string | null }
  | { ok: false; error: string; message?: string }
> {
  const res = await api<{ root: string | null }>("/api/workspace/default");
  if (res.ok) {
    const ok = res as { ok: true; root: string | null };
    return { ok: true, root: ok.root ?? null };
  }
  return res as { ok: false; error: string; message?: string };
}

export async function setDefaultWorkspace(root: string) {
  return api("/api/workspace/default", {
    method: "POST",
    body: JSON.stringify({ root }),
  });
}

// Tickets
export type TicketStub = {
  id: string;
  type: "epic" | "story" | "subtask" | "bug";
  status?: string;
  assignee?: string;
  summary?: string;
  components: string[];
  labels: string[];
  repoIds: string[];
  sprintId?: string;
  updatedAt?: string;
};

export async function listTickets(
  params: Record<string, string | string[] | number | undefined>,
): Promise<
  | { ok: true; tickets: TicketStub[] }
  | { ok: false; error: string; message?: string }
> {
  const url = new URL("/api/tickets", location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
    else url.searchParams.set(k, String(v));
  }
  const res = await api<{ tickets: TicketStub[] }>(url.pathname + url.search);
  if ((res as { ok: boolean }).ok) {
    const ok = res as { ok: true; tickets?: TicketStub[] };
    return { ok: true, tickets: ok.tickets ?? [] };
  }
  return res as { ok: false; error: string; message?: string };
}

export async function getTicket(
  id: string,
  root?: string,
): Promise<
  | {
      ok: true;
      ticket: TicketStub & {
        path: string;
        historyRelative: string;
        data: Record<string, unknown>;
      };
    }
  | { ok: false; error: string; message?: string }
> {
  const url = new URL(
    `/api/tickets/${encodeURIComponent(id)}`,
    location.origin,
  );
  if (root) url.searchParams.set("root", root);
  const res = await api<{
    ticket: TicketStub & {
      path: string;
      historyRelative: string;
      data: Record<string, unknown>;
    };
  }>(url.pathname + url.search);
  if ((res as { ok: boolean }).ok) {
    const ok = res as {
      ok: true;
      ticket: TicketStub & {
        path: string;
        historyRelative: string;
        data: Record<string, unknown>;
      };
    };
    return { ok: true, ticket: ok.ticket };
  }
  return res as { ok: false; error: string; message?: string };
}

export async function patchTicket(
  id: string,
  set: Record<string, unknown>,
  root?: string,
) {
  const url = new URL(
    `/api/tickets/${encodeURIComponent(id)}`,
    location.origin,
  );
  if (root) url.searchParams.set("root", root);
  return api(url.pathname + url.search, {
    method: "PATCH",
    body: JSON.stringify({ set }),
  });
}

// Planner queues
export async function setBacklog(ids: string[], root?: string) {
  const url = new URL("/api/queues/backlog/set", location.origin);
  if (root) url.searchParams.set("root", root);
  return api(url.pathname + url.search, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function setNextSprint(ids: string[], root?: string) {
  const url = new URL("/api/queues/next-sprint/set", location.origin);
  if (root) url.searchParams.set("root", root);
  return api(url.pathname + url.search, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function lookupTickets(
  ids: string[],
  root?: string,
): Promise<
  | { ok: true; tickets: Record<string, TicketStub> }
  | { ok: false; error: string; message?: string }
> {
  const url = new URL("/api/tickets/lookup", location.origin);
  url.searchParams.set("ids", ids.join(","));
  if (root) url.searchParams.set("root", root);
  const res = await api<{ tickets: Record<string, TicketStub> }>(
    url.pathname + url.search,
  );
  if ((res as { ok: boolean }).ok) {
    const ok = res as { ok: true; tickets?: Record<string, TicketStub> };
    return { ok: true, tickets: ok.tickets ?? {} };
  }
  return res as { ok: false; error: string; message?: string };
}

export async function getTicketHistory(
  id: string,
  root?: string,
): Promise<
  | { ok: true; events: Array<Record<string, unknown>> }
  | { ok: false; error: string; message?: string }
> {
  const url = new URL(
    `/api/tickets/${encodeURIComponent(id)}/history`,
    location.origin,
  );
  if (root) url.searchParams.set("root", root);
  const res = await api<{ events: Array<Record<string, unknown>> }>(
    url.pathname + url.search,
  );
  if ((res as { ok: boolean }).ok) {
    const ok = res as { ok: true; events?: Array<Record<string, unknown>> };
    return { ok: true, events: ok.events ?? [] };
  }
  return res as { ok: false; error: string; message?: string };
}
