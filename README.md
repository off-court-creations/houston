# `@archway/stardate`

TypeScript implementation for the git-native ticketing workflow. The CLI exposes
schema-aware commands (`stardate`) that underpin ticket mutation,
backlog/sprint planning, and code-repo coordination.

## Development

```sh
cd packages/stardate
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

The compiled binary is exposed via `bin` as `stardate`. During
development use `npm run dev -- <args>` to execute commands without building:

```sh
npm run dev -- check
```

Once built (`npm run build`), invoke via `node dist/index.js` or install globally
with `npm link` (or eventually `npm i -g @archway/stardate`).

Run the tracking repo validation locally with:

```sh
stardate check
```

Use `--format json` to emit machine-readable results for custom CI wiring.

## Available Commands

- `new <type>` — create epics/stories/subtasks/bugs with deterministic scaffolding (add `--interactive` or omit flags to answer prompts in-terminal, including creating new assignees/components on the fly).
- `describe <id>` — print ticket metadata or open the backing files in `$EDITOR`.
- `assign <id> <user>` — change assignee with history audit.
- `status <id> <status>` — mutate ticket workflow status.
- `label <id> [+foo] [-bar]` — add/remove labels using `+`/`-` modifiers.
- `link --child <id> --parent <id>` — build Epic → Story / Story → Subtask relationships.
- `bug log-time <id> <minutes> [note]` — append time tracking entries to bug tickets.
- `backlog add <ids...>` / `backlog plan --sprint <id> [--take N]` — manage backlog ordering and sprint scope.
- `sprint new [--start YYYY-MM-DD] [--end YYYY-MM-DD] --name` & `sprint add <id> <tickets...>` — bootstrap sprint shells (defaults to today → +14 days; IDs include a slugged name + short token) and scope membership.
- `code start <id> --repo <repo> [--branch]` plus `code link/open-pr/sync` — manage branch/PR metadata on tickets (uses provider APIs when configured).
- `check` — validate workspace files against schemas, transitions, and guardrails.
- `hooks install` — install the `prepare-commit-msg` hook that adds `Ticket: <ID>` trailers.
- `user add [--id user:foo --name "Foo"]` — add or update entries in `people/users.yaml` (supports `--interactive`; default prompts when no flags given).
- `user info [--id user:foo] [--json]` — inspect a user (prompts for selection when `--id` is omitted).
- `component add [--id checkout --repos repo.checkout]` — add components to `taxonomies/components.yaml` and wire repos (`--interactive` by default when flagless).
- `component list` — list known components.
- `workspace create [dir]` — scaffold a new Stardate workspace (use `--no-git` to skip git init).
- `workspace summary|tickets|sprints|repos|backlog` — inspect workspace state from the CLI (supports `--json`).

## Workspace Insights

Use the `workspace` command group to monitor the local tracking repository:

```sh
stardate workspace summary --json
stardate workspace tickets --type story --label frontend
stardate workspace repos
```

Run `stardate workspace create new-workspace` to initialize a fresh tracking repo scaffolded with the standard directory layout.

### Provider Tokens

Remote branch/PR automation requires credentials. For GitHub, export a token via
`STARDATE_GITHUB_TOKEN` (or `GITHUB_TOKEN`/`GH_TOKEN`). When absent, Stardate quietly
skips provider calls while still updating local metadata.
