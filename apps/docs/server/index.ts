import http from "node:http";
import fs from "node:fs";
import { parse } from "node:url";
import { StringDecoder } from "node:string_decoder";
// Cross-package imports resolved at runtime by tsx loader
import { createWorkspace } from "../../../src/services/workspace-create.ts";
import { getWorkspaceSnapshot } from "../../../src/services/workspace-info.ts";
import { listAccounts, getSecret } from "../../../src/services/secrets.ts";
import { readUserConfig, setDefaultWorkspace } from "../../../src/services/user-config.ts";
import { loadConfig } from "../../../src/config/config.ts";
import { collectWorkspaceInventory } from "../../../src/services/workspace-inventory.ts";
import { buildWorkspaceAnalytics, type TicketOverview } from "../../../src/services/workspace-analytics.ts";
import { readYamlFile, writeYamlFile } from "../../../src/lib/yaml.ts";

type Json =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

const PORT = Number(process.env.PORT ?? 5179);

function json(res: http.ServerResponse, code: number, body: Json): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { ok: false, error: "not_found" });
}

function methodNotAllowed(res: http.ServerResponse): void {
  json(res, 405, { ok: false, error: "method_not_allowed" });
}

function parseBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let received = 0;
    let raw = "";
    req.on("data", (chunk) => {
      received += (chunk as Buffer).length ?? 0;
      if (received > limit) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      raw += decoder.write(chunk as Buffer);
    });
    req.on("end", () => {
      raw += decoder.end();
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function getQuery(url: string): Record<string, string> {
  const parsed = parse(url, true);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.query)) {
    if (Array.isArray(v)) out[k] = v[0] ?? "";
    else if (v == null) out[k] = "";
    else out[k] = String(v);
  }
  return out;
}

function parseMulti(q: Record<string, string>, key: string): string[] | undefined {
  const raw = q[key];
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeAnalyticsFor(root?: string) {
  const cfg = loadConfig(root ? { cwd: root } : {});
  const inv = collectWorkspaceInventory(cfg);
  const analytics = buildWorkspaceAnalytics(inv);
  return { cfg, inv, analytics };
}

async function handleWorkspaceNew(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const directory = typeof body.directory === "string" ? body.directory : undefined;
    if (!directory) return json(res, 400, { ok: false, error: "bad_request", message: "directory is required" });

    const force = body.force === true;
    const git = body.git !== false;
    const remote = typeof body.remoteUrl === "string" ? (body.remoteUrl as string) : undefined;
    const createRemote = typeof body.createRemote === "string" ? (body.createRemote as string) : undefined;
    const host = typeof body.host === "string" && body.host.trim() ? (body.host as string).trim() : undefined;
    const visibility = typeof body.visibility === "string" ? (body.visibility as string) : undefined; // "private" | "public"
    const authLabel = typeof body.authLabel === "string" && body.authLabel.trim() ? (body.authLabel as string).trim() : undefined;
    const push = body.push === true ? true : body.push === false ? false : undefined;

    if (remote && createRemote) {
      return json(res, 400, { ok: false, error: "bad_request", message: "remoteUrl and createRemote are mutually exclusive" });
    }

    const result = await createWorkspace({
      directory,
      force,
      git,
      remote,
      createRemote,
      host,
      private: visibility === "private" ? true : visibility === "public" ? false : undefined,
      public: visibility === "public" ? true : undefined,
      push,
      authLabel,
    });

    json(res, 200, { ok: true, result });
  } catch (err: any) {
    const message = err?.message || "internal_error";
    json(res, 500, { ok: false, error: "internal_error", message });
  }
}

async function handleWorkspaceInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const cwd = q.root && q.root.trim() ? q.root : undefined;
    const snapshot = getWorkspaceSnapshot({ cwd }) as any;
    // Enrich with components list for UI consumers
    try {
      const { analytics } = computeAnalyticsFor(cwd);
      (snapshot.components = analytics.components);
    } catch {}
    json(res, 200, { ok: true, snapshot });
  } catch (err: any) {
    const code = err?.name === "WorkspaceConfigNotFoundError" ? 404 : 500;
    const message = err?.message || "internal_error";
    json(res, code, { ok: false, error: err?.name || "internal_error", message });
  }
}

async function handleWorkspaceDefaultGet(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const cfg = readUserConfig();
    json(res, 200, { ok: true, root: cfg.workspace_path ?? null });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleWorkspaceDefaultSet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const root = typeof body.root === "string" ? body.root.trim() : "";
    if (!root) return json(res, 400, { ok: false, error: "bad_request", message: "root is required" });
    setDefaultWorkspace(root);
    json(res, 200, { ok: true });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleTicketList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const root = q.root && q.root.trim() ? q.root : undefined;
    const { analytics } = computeAnalyticsFor(root);
    let list = analytics.tickets.slice();
    const type = parseMulti(q, "type") as ("epic" | "story" | "subtask" | "bug")[] | undefined;
    const status = parseMulti(q, "status");
    const assignee = parseMulti(q, "assignee");
    const repo = parseMulti(q, "repo");
    const sprint = parseMulti(q, "sprint");
    const component = parseMulti(q, "component");
    const label = parseMulti(q, "label");
    const sort = (q.sort || "id") as "id" | "status" | "assignee" | "updated";
    const limit = q.limit ? Math.max(1, Math.min(1000, Number(q.limit))) : undefined;

    list = list.filter((t) => {
      if (type && !type.includes(t.type)) return false;
      if (status && (!t.status || !status.includes(t.status))) return false;
      if (assignee && (!t.assignee || !assignee.includes(t.assignee))) return false;
      if (repo && !repo.some((r) => t.repoIds.includes(r))) return false;
      if (sprint && (!t.sprintId || !sprint.includes(t.sprintId))) return false;
      if (component && !component.some((c) => t.components.includes(c))) return false;
      if (label && !label.some((l) => t.labels.includes(l))) return false;
      return true;
    });

    switch (sort) {
      case "status":
        list.sort((a, b) => (a.status ?? "").localeCompare(b.status ?? "") || a.id.localeCompare(b.id));
        break;
      case "assignee":
        list.sort((a, b) => (a.assignee ?? "").localeCompare(b.assignee ?? "") || a.id.localeCompare(b.id));
        break;
      case "updated":
        list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
        break;
      case "id":
      default:
        list.sort((a, b) => a.id.localeCompare(b.id));
    }
    if (limit) list = list.slice(0, limit);
    const items = list.map((t) => toTicketStub(t));
    json(res, 200, { ok: true, tickets: items });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

function toTicketStub(t: TicketOverview) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    assignee: t.assignee,
    summary: t.summary ?? t.title ?? "",
    components: t.components,
    labels: t.labels,
    repoIds: t.repoIds,
    sprintId: t.sprintId,
    updatedAt: t.updatedAt,
  };
}

async function handleTicketDetail(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url || "/";
  const m = url.match(/^\/api\/tickets\/([^/?#]+)/);
  if (!m) return notFound(res);
  const id = decodeURIComponent(m[1]);
  if (req.method === "GET") {
    try {
      const q = getQuery(url);
      const root = q.root && q.root.trim() ? q.root : undefined;
      const { inv, analytics } = computeAnalyticsFor(root);
      const meta = analytics.tickets.find((t) => t.id === id);
      const info = inv.tickets.find((t) => t.id === id);
      if (!meta || !info) return json(res, 404, { ok: false, error: "not_found" });
      json(res, 200, {
        ok: true,
        ticket: {
          ...toTicketStub(meta),
          path: info.path,
          historyRelative: info.historyRelative,
          data: info.data,
        },
      });
    } catch (err: any) {
      json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
    }
    return;
  }
  if (req.method === "PATCH") {
    try {
      const q = getQuery(url);
      const root = q.root && q.root.trim() ? q.root : undefined;
      const { inv } = computeAnalyticsFor(root);
      const info = inv.tickets.find((t) => t.id === id);
      if (!info) return json(res, 404, { ok: false, error: "not_found" });
      const body = (await parseBody(req)) as Record<string, unknown>;
      const set = (body && (body as any).set) as Record<string, unknown> | undefined;
      if (!set || typeof set !== "object") return json(res, 400, { ok: false, error: "bad_request", message: "set object required" });
      const current = readYamlFile<Record<string, unknown>>(info.absolutePath);
      const next = { ...current, ...set } as Record<string, unknown>;
      writeYamlFile(info.absolutePath, next, { sortKeys: true });
      json(res, 200, { ok: true });
    } catch (err: any) {
      json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
    }
    return;
  }
  return methodNotAllowed(res);
}

async function handleTicketHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  const url = req.url || "/";
  const m = url.match(/^\/api\/tickets\/([^/?#]+)\/history/);
  if (!m) return notFound(res);
  const id = decodeURIComponent(m[1]);
  try {
    const q = getQuery(url);
    const root = q.root && q.root.trim() ? q.root : undefined;
    const { inv } = computeAnalyticsFor(root);
    const info = inv.tickets.find((t) => t.id === id);
    if (!info) return json(res, 404, { ok: false, error: "not_found" });
    const events: Array<Record<string, unknown>> = [];
    try {
      if (fs.existsSync(info.historyPath)) {
        const text = fs.readFileSync(info.historyPath, "utf8");
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            events.push(obj);
          } catch {
            // ignore bad lines
          }
        }
      }
    } catch {}
    json(res, 200, { ok: true, events });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleTicketsLookup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const root = q.root && q.root.trim() ? q.root : undefined;
    const ids = parseMulti(q, "ids") ?? [];
    const { analytics } = computeAnalyticsFor(root);
    const map: Record<string, ReturnType<typeof toTicketStub>> = {};
    for (const t of analytics.tickets) {
      if (ids.includes(t.id)) map[t.id] = toTicketStub(t);
    }
    json(res, 200, { ok: true, tickets: map });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleBacklogSet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const root = q.root && q.root.trim() ? q.root : undefined;
    const cfg = loadConfig(root ? { cwd: root } : {});
    const body = (await parseBody(req)) as Record<string, unknown>;
    const ids = Array.isArray((body as any).ids) ? ((body as any).ids as unknown[]).filter((v) => typeof v === "string") : [];
    const file = cfg.tracking.root + "/backlog/backlog.yaml";
    writeYamlFile(file, { ordered: ids }, { sortKeys: true });
    json(res, 200, { ok: true });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleNextSprintSet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const root = q.root && q.root.trim() ? q.root : undefined;
    const cfg = loadConfig(root ? { cwd: root } : {});
    const body = (await parseBody(req)) as Record<string, unknown>;
    const ids = Array.isArray((body as any).ids) ? ((body as any).ids as unknown[]).filter((v) => typeof v === "string") : [];
    const file = cfg.tracking.root + "/backlog/next-sprint-candidates.yaml";
    writeYamlFile(file, { candidates: ids }, { sortKeys: true });
    json(res, 200, { ok: true });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleGithubAccounts(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const host = q.host?.trim() || "github.com";
    const all = (await listAccounts("archway-houston")) as unknown as string[];
    const accounts: string[] = all.filter((acc: string) => acc === `github@${host}` || acc.startsWith(`github@${host}#`));
    const formatted = accounts.map((acc: string) => ({ account: acc, label: formatAccountLabel(acc) }));
    json(res, 200, { ok: true, accounts: formatted });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

async function handleGithubOwners(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET") return methodNotAllowed(res);
  try {
    const q = getQuery(req.url || "/");
    const host = q.host?.trim() || "github.com";
    const account = q.account?.trim();
    const owners = await listGitHubOwners(host, account);
    json(res, 200, { ok: true, owners });
  } catch (err: any) {
    json(res, 500, { ok: false, error: "internal_error", message: err?.message || "internal_error" });
  }
}

function formatAccountLabel(account: string): string {
  const m = account.match(/^github@([^#]+)(?:#(.*))?$/);
  if (!m) return account;
  const host = m[1];
  const label = m[2] ?? "default";
  return `${host} (${label})`;
}

async function listGitHubOwners(host: string, account?: string): Promise<string[]> {
  const token = account
    ? await getSecret("archway-houston", account)
    : (await getSecret("archway-houston", `github@${host}#default`)) || (await getSecret("archway-houston", `github@${host}`));
  if (!token) return [];
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "archway-houston-ui",
  } as Record<string, string>;
  const owners = new Set<string>();
  try {
    const meRes = await fetch(apiBase(host) + "/user", { headers });
    if (meRes.ok) {
      const me = (await meRes.json()) as { login?: string };
      if (me?.login) owners.add(me.login);
    }
  } catch {}
  try {
    const orgRes = await fetch(apiBase(host) + "/user/orgs", { headers });
    if (orgRes.ok) {
      const orgs = (await orgRes.json()) as Array<{ login?: string }>;
      for (const org of orgs) if (org?.login) owners.add(org.login);
    }
  } catch {}
  return Array.from(owners).sort((a, b) => a.localeCompare(b));
}

function apiBase(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

const server: RequestHandler = async (req, res) => {
  const url = req.url || "/";
  if (url === "/health") return json(res, 200, { ok: true });
  if (url.startsWith("/api/workspace/new")) return handleWorkspaceNew(req, res);
  if (url.startsWith("/api/workspace/info")) return handleWorkspaceInfo(req, res);
  if (url.startsWith("/api/workspace/default") && req.method === "GET") return handleWorkspaceDefaultGet(req, res);
  if (url.startsWith("/api/workspace/default") && req.method === "POST") return handleWorkspaceDefaultSet(req, res);
  if (url.match(/^\/api\/tickets\/[^/]+\/history/)) return handleTicketHistory(req, res);
  if (url.startsWith("/api/tickets/lookup")) return handleTicketsLookup(req, res);
  if (url.startsWith("/api/tickets/")) return handleTicketDetail(req, res);
  if (url.startsWith("/api/tickets")) return handleTicketList(req, res);
  if (url.startsWith("/api/queues/backlog/set")) return handleBacklogSet(req, res);
  if (url.startsWith("/api/queues/next-sprint/set")) return handleNextSprintSet(req, res);
  if (url.startsWith("/api/github/accounts")) return handleGithubAccounts(req, res);
  if (url.startsWith("/api/github/owners")) return handleGithubOwners(req, res);
  return notFound(res);
};

http
  .createServer((req, res) => {
    // Basic hardening headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    server(req, res);
  })
  .listen(PORT, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`Houston UI API listening on http://127.0.0.1:${PORT}`);
  });
