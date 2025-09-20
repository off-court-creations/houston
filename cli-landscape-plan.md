# Stardate CLI Landscape Commands — Implementation Plan

## Objectives
- Give operators quick, read-only insight into the current Stardate workspace without digging through YAML files manually.
- Surface ticket/backlog/sprint/repo state that already lives under `config.tracking.*` in a consistent, scriptable way.
- Keep output human-friendly by default while also supporting `--json` for automation, mirroring existing CLI conventions.
- Reuse existing validation/introspection logic wherever possible to avoid duplicate traversal code.

## Proposed Command Suite
- `workspace summary`
  - High-level snapshot: counts of tickets by type/status, active sprint(s), backlog size, repo count, schema version.
  - Optional flags: `--json`, `--include-empty` to show sections even when empty, `--since <date>` to highlight recently touched tickets (leveraging history files if feasible).
- `workspace tickets`
  - Lists ticket IDs with type, status, assignee, repo links, and sprint association where present.
  - Filters: `--type`, `--status`, `--assignee`, `--repo`, `--sprint`, `--limit`, `--json`.
- `workspace sprints`
  - Shows sprint shells with date ranges, state inference (`upcoming`, `active`, `completed`), scope membership counts, and backlog deltas.
- `workspace repos`
  - Enumerates configured repos (`repos/repos.yaml`) plus any discovered local clones tied to tickets (branch metadata from `code` command outputs).
- `workspace backlog`
  - Displays backlog and next-sprint queues with ticket metadata roll-ups.

The commands would live under a new `workspace` top-level command (`stardate workspace ...`) to keep the namespace tidy and predictable.

## Architecture & Data Flow
1. **Shared Workspace Inventory Service**
   - Create `src/services/workspace-inventory.ts` that exposes a single `collectWorkspaceInventory(config: CliConfig): WorkspaceInventory` entry point.
   - Refactor common collection logic from `workspace-validator.ts` (ticket/sprint/backlog harvesting) into this service to prevent divergence.
   - Cache expensive scans per process run while giving consumers a way to request fresh data (similar to `SchemaRegistry`).
2. **Domain Models**
   - Define lightweight types for tickets, sprints, backlog, repos, people to power the new commands (e.g. `TicketSummary`, `SprintSummary`, `RepoLink`, `BacklogState`).
   - Include derived metadata: ticket age, last history entry timestamp, sprint status classification (based on dates), repo branch counts.
3. **Output Layer**
   - Introduce a small formatter utility (e.g. `src/lib/printer.ts`) that can render either table/text output or JSON from the same data structures.
   - Align formatting style with existing commands (`describe`, `config`) and honor the global `--verbose` flag for additional detail.

## Implementation Milestones
1. **Scaffolding & Refactor**
   - Extract ticket/sprint/backlog collectors from `workspace-validator.ts` into `workspace-inventory.ts`.
   - Provide unit tests for the new service using existing fixtures (`test/fixtures/workspace`).
   - Update `workspace-validator.ts` to consume the shared service and ensure validation output remains unchanged (regression tests).
2. **Command Wiring**
   - Add `registerWorkspaceCommand(program: Command)` in `src/commands/workspace.ts` and hook it inside `src/index.ts`.
   - Implement the `summary`, `tickets`, `sprints`, `repos`, and `backlog` subcommands with Commander, leaning on the inventory service.
   - Support `--json` flag across subcommands by piping through the formatter utility.
3. **User Experience Polish**
   - Design text layouts (tables/lists) and fallback messaging for empty states (e.g. “No tickets found”).
   - Add filtering arguments, ensuring mutually exclusive combinations are validated with clear errors.
   - Surface config metadata (`config.tracking.*`) so users see exactly which workspace is being inspected.
4. **Testing & Tooling**
   - Extend Vitest integration suite with CLI smoke tests under `test/commands/workspace.test.ts`, using temporary workspaces like the existing CLI flow tests.
   - Add unit tests for formatter utilities and filtering helpers.
   - Update snapshot fixtures carefully if textual output is snapshot-tested.
5. **Documentation & Release Prep**
   - Document new commands in `README.md` “Available Commands” section and add examples.
   - Update `git-native-foss-jira-like-ticketing-execution-plan.md` if project roadmap needs to reflect the new feature set.
   - Ensure `npm run build`, `npm run schemas`, and `npm test` continue to pass, then prep release notes (`CHANGELOG` or equivalent).

## Testing Strategy
- **Unit Tests**: Cover inventory extraction edge cases (missing history, malformed YAML, empty backlog) using fixture copies.
- **Integration Tests**: Use `Vitest` CLI flows to run each subcommand against a temp workspace and validate stdout via regex/snapshots.
- **Performance Sanity**: Consider adding a benchmark guard (optional) to keep inventory collection under an acceptable threshold for medium-size workspaces.

## Open Questions / Follow-ups
- Should summary include merge request/PR status pulled from provider APIs (when tokens configured), or remain local-only for now?
- Do we need a global cache invalidation flag (`--no-cache`) if future commands mutate state mid-run?
- Is there appetite for `workspace people` / `workspace taxonomies` subcommands, or can that fold into summary/backlog outputs later?

Resolving these during implementation will keep the CLI responsive and aligned with Stardate’s schema-driven philosophy while providing the “dashboard” feel users are asking for.
