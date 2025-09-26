import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Surface,
  Stack,
  Box,
  Typography,
  Button,
  Accordion,
} from "@archway/valet";
import { getTicket, getTicketHistory, patchTicket } from "@/api/client";

type TicketData = {
  id: string;
  type: string;
  status?: string;
  assignee?: string;
  summary?: string;
  title?: string;
  priority?: string;
  due_date?: string;
  parent_id?: string;
  sprint_id?: string;
  components?: string[];
  labels?: string[];
  code?: {
    repos?: Array<{
      repo_id?: string;
      branch?: string;
      created_by?: string;
      created_at?: string;
    }>;
  };
  [key: string]: unknown;
};

export default function TicketDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [root, setRoot] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<TicketData | null>(null);
  const [history, setHistory] = React.useState<Array<Record<string, unknown>>>(
    [],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getTicket(id, root || undefined);
      if (!res.ok) setError(res.message || res.error);
      else setData(res.ticket.data as TicketData);
      const hist = await getTicketHistory(id, root || undefined);
      if (hist.ok) setHistory(hist.events || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const set: Record<string, unknown> = {
        status: data.status,
        assignee: data.assignee,
        summary: data.summary,
        title: data.title,
        priority: data.priority,
        due_date: data.due_date,
        parent_id: data.parent_id,
        sprint_id: data.sprint_id,
        components: data.components ?? [],
        labels: data.labels ?? [],
      };
      if (data.code?.repos) {
        set["code"] = { repos: data.code.repos };
      }
      const res = await patchTicket(id, set, root || undefined);
      if (!res.ok) setError(res.message || res.error);
      else await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Surface>
      <Box alignX="center" centerContent>
        <Stack sx={{ gap: "1rem", width: "min(1100px, 100%)" }}>
          <Typography variant="h2">Ticket {id}</Typography>
          <Box
            sx={{
              padding: "0.75rem",
              border: "1px solid #ddd",
              borderRadius: "8px",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="outlined" onClick={() => navigate("/tickets")}>
                Back to tickets
              </Button>
              <label>
                <div>Workspace Root</div>
                <input
                  type="text"
                  placeholder="(default)"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                />
              </label>
              <div style={{ alignSelf: "end" }}>
                <Button onClick={load} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              <div style={{ alignSelf: "end" }}>
                <Button onClick={save} disabled={saving || !data}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </Box>

          {error ? (
            <Typography sx={{ color: "#c62828" }}>{error}</Typography>
          ) : null}

          {!data ? (
            <Typography>Loading…</Typography>
          ) : (
            <>
              <Box
                sx={{
                  padding: "0.75rem",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                }}
              >
                <Typography variant="h3">Overview</Typography>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                    gap: 8,
                  }}
                >
                  <TextInput
                    label="Summary"
                    value={data.summary ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, summary: v } : d))
                    }
                  />
                  <TextInput
                    label="Title"
                    value={data.title ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, title: v } : d))
                    }
                  />
                  <TextInput
                    label="Status"
                    value={data.status ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, status: v } : d))
                    }
                  />
                  <TextInput
                    label="Assignee"
                    value={data.assignee ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, assignee: v } : d))
                    }
                  />
                  <TextInput
                    label="Priority"
                    value={data.priority ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, priority: v } : d))
                    }
                  />
                  <TextInput
                    label="Due date"
                    value={data.due_date ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, due_date: v } : d))
                    }
                  />
                  <TextInput
                    label="Parent ID"
                    value={data.parent_id ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, parent_id: v } : d))
                    }
                  />
                  <TextInput
                    label="Sprint ID"
                    value={data.sprint_id ?? ""}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, sprint_id: v } : d))
                    }
                  />
                  <CsvInput
                    label="Components"
                    value={data.components ?? []}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, components: v } : d))
                    }
                  />
                  <CsvInput
                    label="Labels"
                    value={data.labels ?? []}
                    onChange={(v) =>
                      setData((d) => (d ? { ...d, labels: v } : d))
                    }
                  />
                </div>
              </Box>

              <Box
                sx={{
                  padding: "0.75rem",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                }}
              >
                <Typography variant="h3">Code Repos</Typography>
                <RepoEditor
                  repos={data.code?.repos ?? []}
                  onChange={(repos) =>
                    setData((d) =>
                      d ? { ...d, code: { ...(d.code ?? {}), repos } } : d,
                    )
                  }
                />
              </Box>

              <Box
                sx={{
                  padding: "0.75rem",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                }}
              >
                <Typography variant="h3">History</Typography>
                <Accordion defaultOpen={0}>
                  <Accordion.Item header={`Events (${history.length})`}>
                    {history.length === 0 ? (
                      <Typography>No history events</Typography>
                    ) : (
                      <table style={{ width: "100%" }}>
                        <thead>
                          <tr>
                            <th align="left">Timestamp</th>
                            <th align="left">Actor</th>
                            <th align="left">Operation</th>
                            <th align="left">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((e, idx) => {
                            const rec = e as Record<string, unknown>;
                            return (
                              <tr key={idx}>
                                <td>{String(rec["ts"] ?? "")}</td>
                                <td>{String(rec["actor"] ?? "")}</td>
                                <td>{String(rec["op"] ?? "")}</td>
                                <td>
                                  <code style={{ fontSize: 12 }}>
                                    {JSON.stringify(e)}
                                  </code>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </Accordion.Item>
                </Accordion>
              </Box>
            </>
          )}
        </Stack>
      </Box>
    </Surface>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      <div>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function CsvInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <label>
      <div>{label}</div>
      <input
        type="text"
        value={value.join(",")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function RepoEditor({
  repos,
  onChange,
}: {
  repos: Array<{
    repo_id?: string;
    branch?: string;
    created_by?: string;
    created_at?: string;
  }>;
  onChange: (
    next: Array<{
      repo_id?: string;
      branch?: string;
      created_by?: string;
      created_at?: string;
    }>,
  ) => void;
}) {
  const [local, setLocal] = React.useState(repos);
  React.useEffect(() => setLocal(repos), [repos]);

  function update(
    i: number,
    patch: Partial<{
      repo_id?: string;
      branch?: string;
      created_by?: string;
      created_at?: string;
    }>,
  ) {
    const next = local.slice();
    next[i] = { ...next[i], ...patch };
    setLocal(next);
    onChange(next);
  }
  function add() {
    const next = [...local, { repo_id: "", branch: "" }];
    setLocal(next);
    onChange(next);
  }
  function remove(i: number) {
    const next = local.filter((_, idx) => idx !== i);
    setLocal(next);
    onChange(next);
  }

  return (
    <div>
      <table style={{ width: "100%" }}>
        <thead>
          <tr>
            <th align="left">repo_id</th>
            <th align="left">branch</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {local.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  type="text"
                  value={r.repo_id ?? ""}
                  onChange={(e) => update(i, { repo_id: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={r.branch ?? ""}
                  onChange={(e) => update(i, { branch: e.target.value })}
                />
              </td>
              <td>
                <Button variant="outlined" onClick={() => remove(i)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <Button onClick={add}>Add repo</Button>
      </div>
    </div>
  );
}
