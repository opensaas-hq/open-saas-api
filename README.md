# open-saas-api

Production-oriented multi-tenant SaaS API built with Bun, Hono, Drizzle ORM, and Better Auth.

## Features

- **Multi-tenancy**: Tenant-scoped queries with membership verification and Postgres RLS (defense in depth)
- **Auth**: Email/password auth, organizations, roles/permissions via Better Auth
- **REST API**: Versioned under `/api/v1` with OpenAPI 3.1 and Swagger UI at `/api/v1/docs`
- **GraphQL**: CRM schema at `/graphql` with depth/complexity limits
- **Validation**: Zod schemas at every boundary
- **Type-safe**: End-to-end TypeScript with strict mode

## Quickstart (Docker)

```bash
cp .env.example .env
# Edit .env with your secrets
docker compose up --build
```

API available at http://localhost:3000

- Health: `GET /healthz`
- Ready: `GET /readyz`
- OpenAPI: `GET /api/v1/openapi.json`
- Swagger UI: `GET /api/v1/docs`
- GraphQL: `POST /graphql`

## Local Development

```bash
bun install
cp .env.example .env
# Start Postgres and run migrations
bun --filter @opensaas/database db:migrate
bun run dev
```

> **Migrations:** Always use `bun --filter @opensaas/database db:migrate`. `db:push` is local-dev-only and must not be used in production/CI.

## Environment Variables

See [.env.example](.env.example) for all configuration options.

## Testing

```bash
bun test              # All tests
bun run test:unit     # Unit tests (no DB required)
bun run test:integration  # Integration tests
```

## API Versioning

- Current version: v1 at `/api/v1/*`
- Legacy routes under `/api/*` are deprecated with `Deprecation`, `Sunset`, and `Link` headers

## License

MIT
