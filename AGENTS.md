# Repository Guidelines

Houston is a git‑native ticketing CLI. This repo is the source of truth: tickets, backlog, and sprints live as YAML committed to git. Commands read and write those files with strict schema validation to keep planning data, branches, and workflow state in sync. When credentials are configured, Houston also handles provider‑aware branch/PR automation. The predictable file layout and emitted JSON Schemas make it easy for both humans and agents to integrate and automate from the command line.

## Project Structure & Module Organization
- `src/` hosts the Commander CLI; `index.ts` wires subcommands in `src/commands/*`, and shared helpers live in `src/lib`, `src/services`, and `src/utils`.
- Tracking data, seed tickets, and taxonomy YAMLs sit in `people/`, `repos/`, `tickets/`, `backlog/`, and `sprints/` for both runtime use and fixtures.
- Validation sources live in `schema/`, refreshed by `scripts/emit-schemas.mjs`.
- Tests mirror implementation folders under `test/` with reusable data in `test/fixtures`.

## Build, Test, and Development Commands
- `npm run dev -- <args>` launches the CLI with `tsx` for rapid iteration without re-compiling.
- `npm run build` compiles TypeScript via `tsc` into `dist/`; run before publishing or validating the binary.
- `npm run schemas` rewrites every `*.schema.json` from the canonical TypeScript types when you touch validation layers.
- `npm run test` and `npm run test:watch` execute the Vitest suite.
- `npm run lint` runs ESLint with the project rules; hook this into your editor for faster feedback.

## Coding Style & Naming Conventions
Follow the two-space indentation and strict TypeScript config in `tsconfig.json`. Modules are ES modules with named exports; reserve default exports for entry points. Use `camelCase` for functions and variables, `PascalCase` for types/classes, and kebab-case filenames (`src/commands/ticket.ts`). Run `npm run lint` before raising a PR and let ESLint auto-fix formatting where possible.

## Testing Guidelines
Vitest is the single runner (`vitest.config.ts`). Co-locate suites under `test/<area>` to mirror implementation folders and keep shared data in `test/fixtures`. Name files with `.test.ts`, align describe blocks with the command syntax, and cover command flows or schema edges when you touch them. Ensure `npm run test` passes locally before pushing.

## Security & Configuration Tips
Do not commit credentials or conflicted schema artefacts. Use `houston auth login <provider>` to configure tokens locally; secrets stay in the OS keychain or Houston’s encrypted store and must never land in git. Set `HOUSTON_LOG_LEVEL=debug` only while troubleshooting and clear it before committing.
