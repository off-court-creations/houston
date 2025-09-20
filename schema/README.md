# Schema Directory

Authoritative JSON Schemas describing every persisted structure in the tracking
repository. These schemas are consumed by the forthcoming `stardate` CLI and by CI to
validate pull requests.

## Available Schemas

- `ticket.base.schema.json` — Common fields shared by all ticket types.
- `ticket.epic.schema.json` — Epic-specific constraints (no priority, etc.).
- `ticket.story.schema.json` — Story rules and parent linkage checks.
- `ticket.subtask.schema.json` — Requires Story parent and `story_points`.
- `ticket.bug.schema.json` — Requires `story_points` + `time_tracking`.
- `sprint.schema.json` — Sprint metadata (`sprint.yaml`).
- `sprint.scope.schema.json` — Sprint scope manifest (`scope.yaml`).
- `backlog.schema.json` — Backlog and next-sprint candidates lists.
- `repos.schema.json` — Registered code repositories and PR policy.
- `component-routing.schema.json` — Component → repo routing defaults.
- `transitions.schema.json` — Allowed status transitions per ticket type.

## Validation Notes

Temporary manual validation example (AJV via npx):

```sh
npx ajv-cli validate -s schema/ticket.story.schema.json -d tickets/STORY/EXAMPLE/ticket.yaml
```

CI will later wire the same schemas into automated checks.
