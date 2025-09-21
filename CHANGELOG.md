# Changelog

## Unreleased

- Adopt UUID-based ticket identifiers (`PREFIX-uuid`) everywhere and remove
  ULID support.
- Add `shortenTicketId` helper and display short IDs in CLI tables, logs, and
  summaries.
- Require canonical ticket IDs (or uniquely resolvable short IDs) when invoking
  CLI commands.
- Refresh fixtures, tests, and documentation for the UUID-only workflow.
