## Agent skills

### Issue tracker

Use GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. See `docs/agents/domain.md`.

## Development

Read `README.md` for setup and `docs/first-slice.md` for the current implementation scope. The full v1 spec includes work that has not shipped yet.

Run `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build` for changes to collaboration. Tests require PostgreSQL (`npm run db:up`). Test through public application operations and independent browser contexts; do not inspect database tables as assertions.

Treat `src/server/live.ts` as the persistence boundary: acknowledge text changes only after the database transaction commits. Prototype code belongs on `prototype/collaboration-model`, not in production imports.
