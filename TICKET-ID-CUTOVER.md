# Ticket ID Cutover Plan (UUID Only)

This document specifies a clean cutover to UUID-based ticket identifiers with no backward compatibility for legacy ID formats. After this change, the only accepted and generated format is `PREFIX-uuid`.

- Canonical ID: `EPIC|ST|SB|BG-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (UUID v4)
- Short display: `PREFIX-xxxxxxxx` (first 8 hex characters of the UUID)
- No ULID support and no legacy acceptance anywhere in the codebase or schemas

## Objectives

- Enforce a single, strict ticket ID format across code, schemas, and data.
- Show short IDs in human-facing output while storing canonical IDs everywhere.
- Provide a one-shot migration tool to rewrite existing workspaces to the new format.
- Remove legacy logic and tests for old formats.

## Scope

- Affects all ticket IDs, parent references, sprint scopes, backlog files, code link branches, logs, and CLI inputs.
- Applies to all commands that accept `ticketId` arguments and to all validations.

## ID Specification

- Prefixes remain: `EPIC`, `ST`, `SB`, `BG`.
- ID format: `PREFIX-UUID` (lowercase hex with hyphens), e.g. `ST-550e8400-e29b-41d4-a716-446655440000`.
- Short display format: `PREFIX-550e8400` (first UUID segment, 8 hex). Displayed in lists and logs by default.

## Schema Changes (UUID-only)

Update JSON Schemas to strictly enforce UUID-only IDs and branch patterns.

- File: `schema/ticket.base.schema.json`
  - `properties.id.pattern`
  - `properties.parent_id.anyOf[1].pattern`
  - `$defs.codeRepositoryLink.properties.branch.pattern`

Proposed updates:

```diff
- "pattern": "^(EPIC|ST|SB|BG)-[A-Za-z0-9]{10,}$"
+ "pattern": "^(EPIC|ST|SB|BG)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
```

```diff
- "pattern": "^(EPIC|ST)-[A-Za-z0-9]{10,}$"
+ "pattern": "^(EPIC|ST)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
```

```diff
- "pattern": "^(epic|feat|task|fix)/(EPIC|ST|SB|BG)-[A-Za-z0-9]{10,}--[a-z0-9\-]{1,32}$"
+ "pattern": "^(epic|feat|task|fix)/(EPIC|ST|SB|BG)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})--[a-z0-9\-]{1,32}$"
```

Notes:
- Use lowercase hex in regex; generation will standardize on lowercase via `crypto.randomUUID()`.
- This is a breaking schema change and will invalidate existing workspaces until migrated.

## Code Changes

### Core helpers (`src/lib/id.ts`)
- `generateTicketId(type)`: switch to `crypto.randomUUID()` and return `${PREFIX}-${uuid}`.
- `getTicketTypeFromId(id)`: validate strictly for UUID IDs; return undefined for non-matching strings.
- Add `shortenTicketId(id)`: returns `PREFIX-xxxxxxxx` derived from the first UUID block.
- Remove all ULID references.

### Path resolution and stores
- `src/services/path-resolver.ts`: unchanged logic; directories continue to use canonical IDs in their names.
- `src/services/ticket-store.ts`: unchanged read/write interfaces; relies on canonical IDs provided by callers.

### CLI input handling (strict)
- Commands taking `<ticketId>` must accept only canonical UUID-based IDs.
  - `src/commands/describe.ts`
  - `src/commands/code.ts`
  - `src/commands/link.ts`
  - `src/commands/assign.ts`
  - `src/commands/status.ts`
  - `src/commands/bug.ts`
- Optional enhancement (still UUID-only): support short UUID input (first 8 hex) only if uniquely resolvable in current workspace. Otherwise, users must pass full canonical ID.

### Display formatting (short ID)
- Show short IDs in human-facing output (tables, summaries, logs) while preserving canonical IDs in files/branches.
  - `src/commands/ticket.ts` (list table ID column): use `shortenTicketId(row.id)`.
  - `src/commands/workspace.ts` ticket line rendering: use `shortenTicketId(ticket.id)`.
  - `src/commands/code.ts`, `src/commands/link.ts`, `src/commands/describe.ts`: prefer `shortenTicketId()` in log messages.

### Branch naming
- Keep canonical ID in generated branch names:
  - `src/commands/code.ts` `generateBranchName()` returns e.g. `feat/ST-<uuid>--slug`.
- Migration tool (below) will update stored branch values to match the new canonical IDs.

### Sorting semantics
- ULIDs were lexicographically sortable by time; UUIDs (v4) are not.
- Update default sort in list views to be more meaningful:
  - `src/commands/ticket.ts` default sort → `updated` (or `createdAt` when present) with `id` tiebreaker.
  - `src/services/workspace-analytics.ts` internal sorting: prefer `createdAt`/`updatedAt` over `id` ordering.

## Migration Tool (One-Shot, Destructive)

Add a new command `houston migrate ids` to rewrite a workspace to UUID IDs. No legacy references remain after migration.

### Responsibilities
- Generate a new UUID ID per ticket and move directories accordingly.
- Update `ticket.yaml` `id` field.
- Update all references across the workspace:
  - `parent_id` fields
  - `backlog/backlog.yaml`
  - `backlog/next-sprint-candidates.yaml`
  - `sprints/**/scope.yaml` lists (`epics`, `stories`, `subtasks`, `bugs`)
  - `code.repos[].branch` strings that embed the ticket ID
- Optionally (flagged) attempt remote provider branch renames; otherwise only local metadata is updated.

### UX and Safety
- Default mode is a required `--execute` flag. Without it, the command errors with instructions; there is no dry-run output of legacy IDs to avoid encouraging old references.
- A `--backup <dir>` option can copy the pre-migration workspace for rollback at the filesystem level.
- Fails fast on errors and prints a concise summary of changes performed.

### Algorithm (high level)
1. Load inventory and index tickets by existing canonical ID.
2. For each ticket:
   - Generate new UUID ID with preserved prefix.
   - Move `tickets/<TYPE>/<oldId>/` → `tickets/<TYPE>/<newId>/`.
   - Rewrite `ticket.yaml` `id` to `newId`.
3. Rewrite references across all known files and fields.
4. Update `code.repos[].branch` to replace `/<oldId>--` with `/<newId>--`.
5. If `--provider` specified, attempt remote branch renames via provider(s); continue on best-effort.
6. Rebuild inventory and run `validate` to ensure zero dangling references.

### Non-Goals
- No persistence of any mapping from old IDs to new IDs.
- No acceptance of old IDs post-migration.

## Tests and Fixtures

- Update fixtures to use UUID IDs throughout:
  - `test/fixtures/workspace/**`
  - `test/lib/id.test.ts` to assert UUID prefixes and generation patterns.
  - Update CLI help/example strings embedded in command files.
- Add new tests for:
  - `shortenTicketId()` behavior
  - Strict `getTicketTypeFromId()` (reject non-UUID IDs)
  - Migration command modifies all relevant files and preserves consistency

## Breaking Changes

- Any existing workspace with ULID-based IDs becomes invalid until migrated.
- All CLI commands now reject legacy IDs.
- Branch names stored in tickets must embed the new canonical IDs.
- Sorting behavior changes where previously dependent on lexicographic ID ordering.

## Rollout Plan

1. Implement schema and code changes behind a feature branch.
2. Update tests and fixtures to UUID-only.
3. Implement `houston migrate ids`.
4. Run end-to-end validation on a sample repo and confirm no lingering references.
5. Merge and release a new major version.
6. Document migration in README and CHANGELOG with clear instructions.

## Risks and Mitigations

- Risk: Missed references cause validation failures.
  - Mitigation: Centralized inventory rewrite + post-migration `validate` run; CI check.
- Risk: Remote branch rename complications.
  - Mitigation: Make remote renames optional; document manual steps if needed.
- Risk: User confusion over short vs full ID.
  - Mitigation: Always display short IDs in UI; document that full ID is required in commands unless short is uniquely resolvable.

## Acceptance Criteria

- Schemas reject any non-UUID ticket IDs and branches.
- New tickets are generated with `PREFIX-uuid` IDs.
- All list and log outputs display `PREFIX-xxxxxxxx` short IDs.
- CLI only accepts UUID IDs (optionally uniquely-resolvable short UUIDs).
- Migration tool updates IDs and references, and `validate` passes after migration.

## Implementation Checklist

- [ ] Update `schema/ticket.base.schema.json` patterns (id, parent_id, branch)
- [ ] Update `src/lib/id.ts` to use UUID and add `shortenTicketId`
- [ ] Remove ULID logic and tests
- [ ] Switch list/log outputs to short IDs
- [ ] Adjust default sorting (updated/createdAt-first)
- [ ] Implement `houston migrate ids`
- [ ] Update tests and fixtures to UUID-only
- [ ] Update README/CHANGELOG

---

Contact: maintainers of the `houston` CLI. This plan is intentionally breaking and does not preserve any legacy compatibility.
