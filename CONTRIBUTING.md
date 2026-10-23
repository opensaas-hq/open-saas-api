# Contributing

## Setup

1. Clone the repo
2. `bun install`
3. Copy `.env.example` to `.env` and configure
4. Start Postgres and run `bun --filter @opensaas/database db:migrate`
5. `bun run dev`

## Development Workflow

- Follow conventional commits
- Run `bun run lint && bun run typecheck` before committing
- Add tests for new functionality
- Keep routes thin (validate → service → response)

## Migrations

Use `db:generate` to create migrations, review SQL, then `db:migrate`. Never use `db:push` in production.

## Testing

- Unit tests: no DB dependencies
- Integration tests: use test database (`.env.test`)
- Never run tests against dev database

## Tenancy Rules

- Always pass `organizationId` to repository functions
- Use tenant middleware for protected routes
- RLS provides defense in depth
- Never trust client-provided tenant IDs
