import React from "react";
import { Surface, Stack, Box, Typography, Button } from "@archway/valet";
import {
  getWorkspaceInfo,
  lookupTickets,
  setBacklog,
  setNextSprint,
} from "@/api/client";

type TicketItem = { id: string; summary?: string; type: string };

export default function PlannerPage() {
  const [root, setRoot] = React.useState<string>("");
  const [backlog, setBacklogState] = React.useState<string[]>([]);
  const [next, setNextState] = React.useState<string[]>([]);
  const [map, setMap] = React.useState<Record<string, TicketItem>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setError(null);
    const info = await getWorkspaceInfo(root || undefined);
    if (!info.ok) {
      setError(info.message || info.error);
      return;
    }
    const bl = info.snapshot.backlog.ticketIds as string[];
    const ns = info.snapshot.nextSprint.ticketIds as string[];
    setBacklogState(bl);
    setNextState(ns);
    const ids = Array.from(new Set([...bl, ...ns]));
    const look = await lookupTickets(ids, root || undefined);
    if (look.ok) setMap(look.tickets || {});
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onDragStart(e: React.DragEvent<HTMLDivElement>, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDropList(
    e: React.DragEvent<HTMLDivElement>,
    list: "backlog" | "next",
  ) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    if (list === "backlog") {
      setBacklogState((arr) => (arr.includes(id) ? arr : [...arr, id]));
      setNextState((arr) => arr.filter((x) => x !== id));
    } else {
      setNextState((arr) => (arr.includes(id) ? arr : [...arr, id]));
      setBacklogState((arr) => arr.filter((x) => x !== id));
    }
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  async function persist() {
    setSaving(true);
    try {
      const calls = [
        setBacklog(backlog, root || undefined),
        setNextSprint(next, root || undefined),
      ];
      await Promise.all(calls);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Surface>
      <Box alignX="center" centerContent>
        <Stack sx={{ gap: "1rem", width: "min(1200px, 100%)" }}>
          <Typography variant="h2">Backlog Planner</Typography>
          <Box
            sx={{
              padding: "0.75rem",
              border: "1px solid #ddd",
              borderRadius: "8px",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
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
                <Button onClick={load}>Refresh</Button>
              </div>
              <div style={{ alignSelf: "end" }}>
                <Button onClick={persist} disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </Box>

          {error ? (
            <Typography sx={{ color: "#c62828" }}>{error}</Typography>
          ) : null}

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <ListColumn
              title={`Backlog (${backlog.length})`}
              items={backlog}
              map={map}
              onDragStart={onDragStart}
              onDrop={(e) => onDropList(e, "backlog")}
              onDragOver={onDragOver}
            />
            <ListColumn
              title={`Next Sprint Candidates (${next.length})`}
              items={next}
              map={map}
              onDragStart={onDragStart}
              onDrop={(e) => onDropList(e, "next")}
              onDragOver={onDragOver}
            />
          </div>
        </Stack>
      </Box>
    </Surface>
  );
}

function ListColumn({
  title,
  items,
  map,
  onDragStart,
  onDrop,
  onDragOver,
}: {
  title: string;
  items: string[];
  map: Record<string, TicketItem>;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <Box
      sx={{
        padding: "0.75rem",
        border: "1px solid #ddd",
        borderRadius: "8px",
        minHeight: "400px",
      }}
    >
      <Typography variant="h3">{title}</Typography>
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{
          minHeight: 300,
          border: "1px dashed #ccc",
          borderRadius: 8,
          padding: 8,
        }}
      >
        {items.map((id) => (
          <Box
            key={id}
            draggable
            onDragStart={(e) => onDragStart(e, id)}
            preset="draggableItem"
            sx={{
              padding: "8px",
              border: "1px solid #eee",
              borderRadius: "6px",
              marginBottom: "6px",
              // background comes from preset above
            }}
            title={map[id]?.summary || id}
          >
            <b>{id}</b> — {map[id]?.summary ?? ""}
          </Box>
        ))}
      </div>
    </Box>
  );
}
