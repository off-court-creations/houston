# Valet App (TS)

A starter app using React 19, Vite, React Router, Zustand, and @archway/valet.

## Quickstart

- Install: `npm install`
- Start API server: `npm run dev:api` (localhost:5179)
- Dev (frontend): `npm run dev` (Vite; proxies /api to 5179)
- Typecheck: `npm run typecheck`
- Build: `npm run build`

## Env (Dev Server / HMR)

- `VITE_ALLOWED_HOSTS` — comma-separated hostnames for dev server allowlist.
- `VITE_HMR_HOST`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT` — tune HMR behind tunnels.

## Structure

- `src/main.tsx` — boots React and router, loads global presets
- `src/App.tsx` — lazy routes + fallback
- `src/presets/globalPresets.ts` — app-wide style presets via Valet
- `src/pages/*` — sample pages
- `src/store/*` — sample Zustand store
- `server/index.ts` — local API server bridging to Houston services

## API Endpoints (local)

- `POST /api/workspace/new` — create workspace; body: `{ directory, force?, git?, remoteUrl?, createRemote?, host?, visibility?: "private"|"public", push?, authLabel? }`
- `GET /api/workspace/info?root=...` — workspace snapshot JSON (same shape as CLI `workspace info --json`)
- `GET /api/github/accounts?host=github.com` — list stored account keys for the host (no tokens)
- `GET /api/github/owners?host=github.com&account=github@github.com#label` — list owners for repo creation (me + orgs)
- `GET /api/tickets` — list tickets with filters: `type,status,assignee,repo,component,label,sort,limit,root`
- `GET /api/tickets/:id` — ticket detail (YAML data + metadata); accepts `root`
- `PATCH /api/tickets/:id` — update YAML fields via `{ set: { ... } }`; accepts `root`
- `GET /api/tickets/lookup?ids=ID1,ID2&root=...` — return ticket stubs by id
- `POST /api/queues/backlog/set` — write backlog order `{ ids: [...] }`; accepts `root`
- `POST /api/queues/next-sprint/set` — write next-sprint candidates `{ ids: [...] }`; accepts `root`
