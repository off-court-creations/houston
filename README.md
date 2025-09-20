# `@archway/houston`

TypeScript implementation for the git-native ticketing workflow. The CLI exposes
schema-aware commands (`houston`) that underpin ticket mutation,
backlog/sprint planning, and code-repo coordination.

## Development

```sh
cd .
npm install
```

- `npm run dev` — run the CLI entrypoint through `tsx` (useful during
  development).
- `npm run build` — emit compiled JavaScript + type declarations to `dist/`.
- `npm run test` — execute the Vitest suite (unit + integration flows).
- `npm run lint` — ESLint with the project rules.
- `npm run clean` — remove the `dist/` artefacts.

## Schema Authoring

Authoritative schemas live in the tracking repo root `schema/`. Regenerate them
from the canonical TypeScript definitions via:

```sh
npm run schemas
```

This executes `scripts/emit-schemas.mjs` and rewrites every
`*.schema.json` file with stable formatting.

## Running the CLI

The compiled binary is exposed via `bin` as `houston`. During
development use `npm run dev -- <args>` to execute commands without building:

```sh
npm run dev -- check
```

Once built (`npm run build`), invoke via `node dist/index.js` or install globally
with `npm link` (or eventually `npm i -g @archway/houston`).

Run the tracking repo validation locally with:

```sh
houston check
```

Use `--format json` to emit machine-readable results for custom CI wiring.

## Available Commands

- `ticket new <type>` — create epics/stories/subtasks/bugs with deterministic scaffolding (add `--interactive` or omit flags to answer prompts in-terminal, including creating new assignees/components on the fly).
- `ticket show <id>` — print ticket metadata or open the backing files in `$EDITOR`.
- `ticket assign <id> <user>` — change assignee with history audit.
- `ticket status <id> <status>` — mutate ticket workflow status.
- `ticket label <id> [+foo] [-bar]` — add/remove labels using `+`/`-` modifiers.
- `ticket link --child <id> --parent <id>` — build Epic → Story / Story → Subtask relationships.
- `ticket time log <id> <minutes> [note]` — append time tracking entries to bug tickets.
- `ticket code start <id> --repo <repo> [--branch]` plus `ticket code link|open-pr|sync` — manage branch/PR metadata on tickets (uses provider APIs when configured).
- `ticket list [filters]` — list tickets (`--json` supported; filters: `--type`, `--status`, `--assignee`, `--repo`, `--sprint`, `--component`, `--label`, `--sort`, `--limit`).
- `backlog add <ids...>` / `backlog plan --sprint <id> [--take N]` — manage backlog ordering and sprint scope.
- `backlog show` — display backlog and next sprint candidates.
- `sprint new [--start YYYY-MM-DD] [--end YYYY-MM-DD] --name` & `sprint add <id> <tickets...>` — bootstrap sprint shells and scope membership.
- `sprint list [--status active|upcoming|completed|unknown]` — list sprint shells and scope counts.
- `repo list` — list configured repositories and referenced tickets.
- `repo add [--id repo.web --provider github --remote git@github.com:org/web.git --default-branch main]` — add or update repositories (`--interactive` by default when flagless; supports detecting details from a local git directory; prompts for branch prefixes, PR defaults, and protections; supports `provider: local` with no remote). Use `houston auth login github` to enable branch/PR automation.
- `check` — validate workspace files against schemas, transitions, and guardrails.
- `hooks install` — install the `prepare-commit-msg` hook that adds `Ticket: <ID>` trailers.
- `user add [--id user:foo --name "Foo"]` — add or update entries in `people/users.yaml` (supports `--interactive`; default prompts when no flags given).
- `user info [--id user:foo] [--json]` — inspect a user (prompts for selection when `--id` is omitted).
- `component add [--id checkout --repos repo.checkout]` — add components to `taxonomies/components.yaml` and wire repos (`--interactive` by default when flagless).
- `component list` — list known components.
- `label add [--id frontend] [--labels frontend,backend]` — add labels to `taxonomies/labels.yaml` (`--interactive` by default when flagless).
- `label list` — list known labels.
- `workspace new [dir]` — scaffold a new Houston workspace (use `--no-git` to skip git init).
- `workspace info` — high-level snapshot of the current workspace (`--json` supported).

## Workspace Insights

Use `workspace info` and the `ticket`/`sprint`/`repo`/`backlog` groups to monitor the local tracking repository:

```sh
houston workspace info --json
houston ticket list --type story --label frontend
houston repo list
```

Run `houston workspace new new-workspace` to initialize a fresh tracking repo scaffolded with the standard directory layout.

### Provider Tokens

Remote branch/PR automation requires credentials stored securely:

- `houston auth login github [--host github.com]` — prompts for a token and stores it encrypted (OS keychain when available, otherwise AES‑GCM encrypted file under `~/.config/houston/`).
- `houston auth status` — shows stored accounts and backend.
- `houston auth logout github [--host]` — removes a stored token.

Houston reads tokens from its secure store only. When no token is available, Houston skips provider calls while still updating local metadata.
