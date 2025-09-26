import React from "react";
import { Surface, Stack, Box, Typography, Button } from "@archway/valet";
import { listTickets } from "@/api/client";

type Filters = {
  type: string[];
  status: string[];
  assignee: string[];
  repo: string[];
  component: string[];
  label: string[];
  sort: "id" | "status" | "assignee" | "updated";
  limit?: number;
};

const initial: Filters = {
  type: [],
  status: [],
  assignee: [],
  repo: [],
  component: [],
  label: [],
  sort: "id",
  limit: 200,
};

export default function TicketListPage() {
  const [root, setRoot] = React.useState<string>("");
  const [filters, setFilters] = React.useState<Filters>(initial);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<
    Array<{
      id: string;
      type: string;
      status?: string;
      assignee?: string;
      summary?: string;
    }>
  >([]);
  // Inline editor removed in favor of detail page
  // no inline saving in list view
  // const [saving, setSaving] = React.useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | string[] | number | undefined> = {
        ...filters,
        root: root || undefined,
      };
      for (const key of Object.keys(params)) {
        const v = params[key];
        if (Array.isArray(v) && v.length === 0) delete params[key];
      }
      const res = await listTickets(params);
      if (!res.ok) setError(res.message || res.error);
      else setRows(res.tickets || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Inline open editor kept for reference; row navigation uses route

  // async function saveTicket() { /* moved to detail page */ }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Surface>
      <Box alignX="center" centerContent>
        <Stack sx={{ gap: "1rem", width: "min(1200px, 100%)" }}>
          <Typography variant="h2">Tickets</Typography>
          <Box
            sx={{
              padding: "0.75rem",
              border: "1px solid #ddd",
              borderRadius: "8px",
            }}
          >
            <Typography variant="subtitle">Filters</Typography>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0,1fr))",
                gap: 8,
              }}
            >
              <TextArray
                label="Types"
                value={filters.type}
                onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
              />
              <TextArray
                label="Statuses"
                value={filters.status}
                onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              />
              <TextArray
                label="Assignees"
                value={filters.assignee}
                onChange={(v) => setFilters((f) => ({ ...f, assignee: v }))}
              />
              <TextArray
                label="Repos"
                value={filters.repo}
                onChange={(v) => setFilters((f) => ({ ...f, repo: v }))}
              />
              <TextArray
                label="Components"
                value={filters.component}
                onChange={(v) => setFilters((f) => ({ ...f, component: v }))}
              />
              <TextArray
                label="Labels"
                value={filters.label}
                onChange={(v) => setFilters((f) => ({ ...f, label: v }))}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <label>
                <div>Workspace Root</div>
                <input
                  type="text"
                  placeholder="(default)"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                />
              </label>
              <label>
                <div>Sort</div>
                <select
                  value={filters.sort}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      sort: e.target.value as Filters["sort"],
                    }))
                  }
                >
                  <option value="id">ID</option>
                  <option value="status">Status</option>
                  <option value="assignee">Assignee</option>
                  <option value="updated">Updated</option>
                </select>
              </label>
              <label>
                <div>Limit</div>
                <input
                  type="number"
                  value={filters.limit ?? 200}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      limit: Number(e.target.value || 0),
                    }))
                  }
                />
              </label>
              <div style={{ alignSelf: "end" }}>
                <Button onClick={refresh} disabled={loading}>
                  {loading ? "Loading…" : "Apply"}
                </Button>
              </div>
            </div>
          </Box>

          {error ? (
            <Typography sx={{ color: "#c62828" }}>{error}</Typography>
          ) : null}

          <Box
            sx={{
              padding: "0.75rem",
              border: "1px solid #ddd",
              borderRadius: "8px",
            }}
          >
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th align="left">ID</th>
                  <th align="left">Type</th>
                  <th align="left">Status</th>
                  <th align="left">Assignee</th>
                  <th align="left">Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      window.location.assign(
                        `/tickets/${encodeURIComponent(r.id)}`,
                      )
                    }
                  >
                    <td>{r.id}</td>
                    <td>{r.type}</td>
                    <td>{r.status ?? ""}</td>
                    <td>{r.assignee ?? ""}</td>
                    <td>{r.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>

          {/* Detailed editing moved to /tickets/:id */}
        </Stack>
      </Box>
    </Surface>
  );
}

function TextArray({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    setText(value.join(","));
  }, [value]);
  return (
    <label>
      <div>{label}</div>
      <input
        type="text"
        placeholder="comma,separated"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const parts = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parts);
        }}
      />
    </label>
  );
}
