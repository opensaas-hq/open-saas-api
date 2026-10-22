# open-saas-api

Modular multi-tenant SaaS automation engine built with Bun, Hono, and Drizzle.

## API

The product API is versioned: every product route lives under `/api/v1`
(health probes stay unprefixed).

| Resource  | Versioned surface      | Deprecated alias      |
| --------- | ---------------------- | --------------------- |
| Contacts  | `/api/v1/contacts`     | `/api/contacts`       |
| Branches  | `/api/v1/branches`     | `/api/branches`       |
| Users     | `/api/v1/registration` | `/api/registration`   |
| Readiness | `/readyz`              | `/api/health`         |

- Contract (OpenAPI 3.1): `/api/v1/openapi.json`
- Interactive reference (Swagger UI): `/api/v1/docs`
- Liveness / readiness: `/healthz`, `/readyz`

Run the API with `bun run dev` and open
`http://localhost:3000/api/v1/docs` (the port is `PORT`, default `3000`).

### Versioning and deprecation policy

- Every product route is published under `/api/v1`. A breaking change ships
  under a new prefix (`/api/v2`) and `/api/v1` keeps working.
- The historical unprefixed paths are deprecated aliases of the versioned
  routes. They answer exactly like their successors and announce their own end
  on **every** response:
  - `Deprecation: true` (RFC 8594)
  - `Sunset: Wed, 31 Mar 2027 23:59:59 GMT` — after this date the aliases are
    removed
  - `Link: </api/v1/contacts>; rel="successor-version"` (RFC 8288)
- The OpenAPI document is generated from the same Zod schemas the API validates
  and serializes. CI regenerates it and fails when the committed snapshot
  drifts from the routes (`bun run --filter @opensaas/api openapi:check`).
