import React from "react";
import {
  Surface,
  Stack,
  Box,
  Typography,
  Button,
  Divider,
  Panel,
  Table,
  Chip,
} from "@archway/valet";
import {
  getWorkspaceInfo,
  getDefaultWorkspace,
  setDefaultWorkspace,
} from "@/api/client";
import type {
  WorkspaceSnapshot,
  SprintMini,
  QueueMini,
  RepoMini,
} from "@/api/types";

export default function WorkspaceInfoPage() {
  const [root, setRoot] = React.useState<string>("");
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [defaultRoot, setDefaultRoot] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getWorkspaceInfo(root || undefined);
      if (!res.ok) {
        setError(res.message || res.error);
        setSnapshot(null);
      } else {
        setSnapshot(res.snapshot);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [root]);

  React.useEffect(() => {
    // Load default root and snapshot on mount
    (async () => {
      const def = await getDefaultWorkspace();
      if (def.ok) setDefaultRoot(def.root ?? null);
      await refresh();
    })();
  }, [refresh]);

  return (
    <Surface>
      <Box centerContent fullWidth>
        <Stack>
          <Typography variant="h2">Workspace Overview</Typography>

          <Box sx={{ padding: "0.75rem" }} fullWidth>
            <Typography variant="subtitle">Workspace Root</Typography>
            <Stack direction="row" sx={{ gap: "0.5rem" }}>
              <input
                type="text"
                placeholder="Leave blank to use default"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button onClick={refresh} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </Stack>
            {defaultRoot ? (
              <Typography variant="subtitle">
                Default workspace: {defaultRoot}
              </Typography>
            ) : (
              <Typography variant="subtitle">
                No default workspace set
              </Typography>
            )}
          </Box>

          {error ? (
            <Typography sx={{ color: "#c62828" }}>{error}</Typography>
          ) : null}

          {!snapshot ? (
            <Typography>No workspace data yet. Try refreshing.</Typography>
          ) : (
            <>
              <Overview
                snapshot={snapshot}
                defaultRoot={defaultRoot}
                onSetDefault={async (rootPath: string) => {
                  const res = await setDefaultWorkspace(rootPath);
                  if (res.ok) setDefaultRoot(rootPath);
                }}
              />
              <Sprints snapshot={snapshot} />
              <Queues snapshot={snapshot} />
              <Components snapshot={snapshot} />
              <Repos snapshot={snapshot} />
            </>
          )}
        </Stack>
      </Box>
    </Surface>
  );
}

function Overview({
  snapshot,
  defaultRoot,
  onSetDefault,
}: {
  snapshot: WorkspaceSnapshot;
  defaultRoot: string | null;
  onSetDefault: (root: string) => Promise<void> | void;
}) {
  const ws = snapshot.workspace;
  const sum = snapshot.summary as Record<string, unknown> & {
    totalTickets: number;
    backlogCount: number;
    nextSprintCount: number;
    repoCount: number;
    componentCount: number;
    labelCount: number;
    userCount: number;
    activeSprintCount: number;
  };
  return (
    <Panel>
      <Typography variant="h3">Summary</Typography>
      <Stack>
        <Stack direction="row" sx={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <Metric label="Tickets" value={sum.totalTickets} />
          <Metric label="Backlog" value={sum.backlogCount} />
          <Metric label="Next Sprint" value={sum.nextSprintCount} />
          <Metric label="Repos" value={sum.repoCount} />
          <Metric label="Components" value={sum.componentCount} />
          <Metric label="Labels" value={sum.labelCount} />
          <Metric label="Users" value={sum.userCount} />
          <Metric label="Active Sprints" value={sum.activeSprintCount} />
        </Stack>
      </Stack>
      <Divider />
      <Typography variant="subtitle">Paths</Typography>
      <Stack>
        <Typography>Workspace root: {ws.workspaceRoot}</Typography>
        <Typography>Tracking root: {ws.trackingRoot}</Typography>
        <Typography>Schema dir: {ws.schemaDir}</Typography>
      </Stack>
      <Stack
        direction="row"
        sx={{ gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}
      >
        <Button
          variant="outlined"
          disabled={Boolean(defaultRoot && defaultRoot === ws.workspaceRoot)}
          onClick={() => onSetDefault(ws.workspaceRoot)}
        >
          {defaultRoot === ws.workspaceRoot ? "Default set" : "Set as default"}
        </Button>
      </Stack>
    </Panel>
  );
}

function Sprints({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const sprints = snapshot.sprints as {
    active: SprintMini[];
    upcoming: SprintMini[];
    completed: SprintMini[];
  };
  const sections = [
    { label: "Active", list: sprints.active },
    { label: "Upcoming", list: sprints.upcoming },
    { label: "Completed", list: sprints.completed },
  ];
  return (
    <Panel>
      <Typography variant="h3">Sprints</Typography>
      {sections.map((section, idx) => (
        <Stack
          key={section.label}
          sx={{ gap: "0.5rem", marginTop: idx ? "0.75rem" : 0 }}
        >
          <Typography variant="subtitle">{`${section.label} (${section.list.length})`}</Typography>
          {section.list.length === 0 ? (
            <Typography>No sprints</Typography>
          ) : (
            <Table
              data={section.list}
              columns={[
                { header: "Sprint", accessor: "pretty" },
                { header: "Status", accessor: "status" },
                {
                  header: "Window",
                  accessor: (r: SprintMini) =>
                    r.startDate || r.endDate
                      ? `${r.startDate ?? ""} → ${r.endDate ?? ""}`
                      : "",
                },
              ]}
              striped
              hoverable
            />
          )}
          {idx < sections.length - 1 ? <Divider /> : null}
        </Stack>
      ))}
    </Panel>
  );
}

function Queues({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const backlog = snapshot.backlog;
  const next = snapshot.nextSprint;
  return (
    <Panel>
      <Typography variant="h3">Queues</Typography>
      <Stack direction="row" sx={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: "320px" }}>
          <QueueCard title="Backlog" data={backlog} />
        </Box>
        <Box sx={{ flex: 1, minWidth: "320px" }}>
          <QueueCard title="Next Sprint Candidates" data={next} />
        </Box>
      </Stack>
    </Panel>
  );
}

function QueueCard({ title, data }: { title: string; data: QueueMini }) {
  return (
    <Box sx={{ padding: "0.75rem" }}>
      <Typography variant="h4">{title}</Typography>
      <Typography>Total: {data.ticketIds.length}</Typography>
      {data.missing.length > 0 ? (
        <Typography sx={{ color: "#c62828" }}>
          Missing references: {data.missing.length}
        </Typography>
      ) : null}
      <Typography variant="subtitle">Path</Typography>
      <Typography>{data.path}</Typography>
    </Box>
  );
}

function Repos({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const repos = snapshot.repos;
  return (
    <Panel>
      <Typography variant="h3">Repositories</Typography>
      <Typography variant="subtitle">Configured</Typography>
      {repos.configured.length === 0 ? (
        <Typography>No repos configured</Typography>
      ) : (
        <Table
          sx={{ minHeight: "100%" }}
          data={repos.configured}
          columns={[
            { header: "ID", accessor: "id" },
            { header: "Provider", accessor: (r: RepoMini) => r.provider ?? "" },
            { header: "Remote", accessor: (r: RepoMini) => r.remote ?? "" },
            {
              header: "Ticket refs",
              accessor: (r: RepoMini) => String(r.ticketIds.length),
            },
          ]}
          striped
          hoverable
        />
      )}
      {repos.unknownReferences.length > 0 ? (
        <Typography sx={{ marginTop: 8 }}>
          Unknown repo references: {repos.unknownReferences.length}
        </Typography>
      ) : null}
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Panel>
      <Typography variant="subtitle">{label}</Typography>
      <Typography variant="h3">{value}</Typography>
    </Panel>
  );
}

function Components({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const items = snapshot.components as string[] | undefined;
  if (!items || items.length === 0) return null;
  return (
    <Panel>
      <Typography variant="h3">Components</Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: "0.5rem" }}>
        {items.map((c) => (
          <Chip key={c} label={c} />
        ))}
      </Stack>
    </Panel>
  );
}

// Types are imported from @/api/types
