# `@archway/houston`

Git‑native ticketing and planning from the command line. Houston keeps tickets, backlog, and sprints as YAML in git and provides schema‑aware commands to create, plan, and sync work across repos. When credentials are configured, Houston also coordinates branches and PRs.

## Quick Start

```sh
npm install
npm run dev -- help

# Create a new workspace (scaffold folders and schemas)
npm run dev -- workspace new my-workspace

# Create and list tickets
npm run dev -- ticket new story --interactive
npm run dev -- ticket list --type story

# Validate the workspace
npm run dev -- check --format table
```

Tip: Once built (`npm run build`), you can run the compiled binary with `node dist/index.js <cmd>` or symlink with `npm link` to invoke `houston` directly.

## Everyday Tasks (Examples)

```sh
# Assign and move status
houston ticket assign ST-550e8400 user:alice
houston ticket status ST-550e8400 in-progress

# Sprint planning
houston backlog add ST-... ST-...
houston backlog plan --sprint sprint:2025-10 --take 10

# Repo + PR automation (when authed)
houston ticket code start ST-... --repo repo.web
houston ticket code open-pr ST-...

# Inspect workspace
houston workspace info --json
```

## Key Concepts

- Git‑native data: YAML under `people/`, `repos/`, `tickets/`, `backlog/`, `sprints/` is the source of truth.
- Strong validation: Commands read/write with strict schema checks (`schema/`).
- Deterministic scaffolding: New tickets, backlog entries, and sprints are generated with predictable structure.
- Canonical IDs: Tickets use `PREFIX-uuid` (e.g., `ST-550e8400-e29b-41d4-a716-446655440000`). Short forms (e.g., `ST-550e8400`) are accepted when unique.
- Provider‑aware code flow: With `houston auth login <provider>`, Houston links branches and PRs to tickets.
- JSON output everywhere: Most list/info commands support `--json` for automation.

## Commands

Houston ships many subcommands for tickets, backlog, sprints, repos, and workspace operations. Explore in‑CLI help or see the full reference:

- `houston help`, `houston <group> --help`, or `houston <group> <cmd> --help`
- Command reference: see `CLI_COMMANDS.md`

Common commands:

- `ticket new <type>` — create epics/stories/subtasks/bugs (supports `--interactive`).
- `ticket list [filters]` — filter by `--type`, `--status`, `--assignee`, `--label`, etc.
- `ticket assign|status|label|link|code ...` — update workflow and code links.
- `backlog add|plan|show` — manage ordering and sprint scope.
- `sprint new|add|list` — bootstrap sprints and scope tickets.
- `repo add|list` — track repos (enable automation via `houston auth login`).
- `check` — validate files against schemas and guardrails.
- `hooks install` — add a `Ticket: <ID>` trailer to commit messages.

## Development

```sh
npm install

# Fast iteration without building
npm run dev -- <args>

# Build / test / lint
npm run build
npm run test
npm run lint

# Regenerate JSON Schemas from TypeScript types
npm run schemas
```

- Requires Node.js 20+ (see `engines` in `package.json`).
- Source lives under `src/` (commands in `src/commands/*`, shared code in `src/lib`, `src/services`, `src/utils`).
- Compiled output is emitted to `dist/`.
- Tests mirror the structure in `test/` with fixtures in `test/fixtures`.

## Auth & Security

- `houston auth login github [--host github.com]` — stores a token securely (OS keychain when available; otherwise an encrypted store under `~/.config/houston/`).
- `houston auth status` | `houston auth logout` — manage stored credentials.
- When no token is present, Houston skips provider calls but still updates local metadata.
- Don’t commit secrets or conflicted schema artifacts. Use `HOUSTON_LOG_LEVEL=debug` only while troubleshooting.

## Troubleshooting

- Use `--format json` on list/info commands for precise output.
- Run `houston check` to surface schema or workflow issues in your workspace.
- If a command fails validation, the error will reference the offending file and schema rule.
