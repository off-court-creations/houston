# Tickets Directory

Tickets are stored as versioned directories grouped by type:

- `EPIC/EPIC-<ULID>/`
- `STORY/ST-<ULID>/`
- `SUBTASK/SB-<ULID>/`
- `BUG/BG-<ULID>/`

Each ticket directory will contain `ticket.yaml`, `description.md`, and `history.ndjson` generated exclusively by the `stardate` CLI. Placeholder subdirectories exist to ensure the structure is tracked in Git.
