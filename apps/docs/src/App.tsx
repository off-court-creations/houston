import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import { useInitialTheme, Surface, Stack, Typography } from "@archway/valet";

const page = <T extends { default: React.ComponentType }>(
  p: () => Promise<T>,
) => lazy(() => p().then((m) => ({ default: m.default })));

const QuickstartPage = page(() => import("@/pages/start/Quickstart"));
const SecondPage = page(() => import("@/pages/second/SecondPage"));
const NewWorkspacePage = page(() => import("@/pages/workspace/NewWorkspace"));
const WorkspaceInfoPage = page(() => import("@/pages/workspace/Info"));
const TicketListPage = page(() => import("@/pages/tickets/List"));
const PlannerPage = page(() => import("@/pages/planner/Planner"));
const TicketDetailPage = page(() => import("@/pages/tickets/Detail"));

export function App() {
  useInitialTheme(
    {
      fonts: {
        heading: "Kumbh Sans",
        body: "Inter",
        mono: "JetBrains Mono",
        button: "Kumbh Sans",
      },
    },
    ["Kumbh Sans", "JetBrains Mono", "Inter"],
  );

  const Fallback = (
    <Surface>
      <Stack sx={{ padding: "2rem", alignItems: "center" }}>
        <Typography variant="subtitle">Loading…</Typography>
      </Stack>
    </Surface>
  );

  return (
    <Suspense fallback={Fallback}>
      <Routes>
        <Route path="/" element={<QuickstartPage />} />
        <Route path="/secondpage" element={<SecondPage />} />
        <Route path="/workspace/new" element={<NewWorkspacePage />} />
        <Route path="/workspace/info" element={<WorkspaceInfoPage />} />
        <Route path="/tickets" element={<TicketListPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/planner" element={<PlannerPage />} />
      </Routes>
    </Suspense>
  );
}
