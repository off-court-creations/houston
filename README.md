# `@archway/houston`

Git‑native ticketing and planning from the command line. Houston stores tickets, backlog, and sprints as YAML in git, validates them with schemas, and helps you ship with predictable, automatable workflows. With credentials configured, Houston also links branches and PRs.

## Quick Start

```sh
npm install
npm run dev -- help

# Create a new workspace (scaffold folders and schemas)
npm run dev -- workspace new my-workspace

# Create a new workspace on GitHub (and push)
npm run dev -- workspace new ./tracking \
  --create-remote my-org/tracking --host github.com --private --push

# Create and list tickets
npm run dev -- ticket new story --interactive
npm run dev -- ticket list --type story

# Validate the workspace
npm run dev -- check --format table
```

Tip: Once built (`npm run build`), you can run the compiled binary with `node dist/index.js <cmd>` or symlink with `npm link` to invoke `houston` directly.

## Shell Completions

Houston ships a small helper (`houston-complete`) and shell wrappers. Install them once for rich tab‑completion:

zsh

```
mkdir -p ~/.zsh/completions
cp hooks/completions/_houston ~/.zsh/completions/_houston
echo "fpath+=(~/.zsh/completions)" >> ~/.zshrc
autoload -Uz compinit && compinit
```

bash

```
mkdir -p ~/.local/share/bash-completion/completions
cp hooks/completions/houston.bash ~/.local/share/bash-completion/completions/houston
# Or: source ~/.local/share/bash-completion/completions/houston
```

Try it out

```
# Explore config subtree completions
houston config <TAB>                # suggests: set, show, --json
houston config set <TAB>            # suggests: default-workspace
houston config show <TAB>           # suggests: default-workspace

# Set and show default workspace used outside workspaces
houston config set default-workspace .
houston config show default-workspace
houston config show default-workspace --json
```

## Everyday Tasks

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

## VCS Automation

Houston acts like a careful teammate around your Version Control System:

- Pre‑pull: Before mutating commands, Houston runs `git pull --rebase` when you’re on a clean branch with an upstream. Skip with `--no-sync` or `HOUSTON_NO_SYNC=1`.
- Auto‑commit: After a command changes workspace files, Houston stages the tracking root and commits a simple message like `houston: update [tickets, backlog]` with a `Change-Types:` trailer.
- Auto‑push: If a remote/upstream exists, Houston pushes by default. Override with `--push`, `--no-push`, or workspace config.
- Read‑only commands (e.g., `workspace info`, `ticket list/show`) skip pre‑pull and auto‑commit.

Workspace new (interactive):

- When creating a GitHub remote, Houston can list owners from your PAT — “Me (<login>)” plus your orgs — so you can choose who owns the new repo.

Workspace config (`houston.config.yaml`):

```yaml
git:
  autoCommit: true          # default
  autoPush: auto            # push when remote/upstream exists
  autoPull: true            # pre-pull before mutating commands
  pullRebase: true
```

Environment:

- `HOUSTON_NO_SYNC=1` disables pre‑pull.
- `HOUSTON_GIT_AUTO=0` disables auto‑commit.

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

Common commands

- `ticket new <type>` — create epics/stories/subtasks/bugs (supports `--interactive`).
- `ticket list [filters]` — filter by `--type`, `--status`, `--assignee`, `--label`, etc.
- `ticket assign|status|label|link|code ...` — update workflow and code links.
- `backlog add|plan|show` — manage ordering and sprint scope.
- `sprint new|add|list` — bootstrap sprints and scope tickets.
- `repo add|list` — track repos (enable automation via `houston auth login`).
- `check` — validate files against schemas and guardrails.
- `hooks install` — add a `Ticket: <ID>` trailer to commit messages.

Workspace creation (with remotes)

- `workspace new ./tracking --remote git@github.com:owner/repo.git --push`
- `workspace new ./tracking --create-remote owner/repo --host github.com --private --push`

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

## Why Houston

- Git as the source of truth keeps planning data diffable, reviewable, and automatable.
- Predictable schemas and IDs make it easy to integrate with your tooling.
- Built for teams: auto‑pull, auto‑commit, and auto‑push reduce sync friction in shared workspaces.
