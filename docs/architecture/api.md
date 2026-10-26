# API Surface and Contracts

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 7. HTTP API Surface and Conventions

### 7.1 Endpoint inventory

| Method | Path | Auth / tenant | Permission | Notes |
| --- | --- | --- | --- | --- |
| `ALL` | `/api/auth/*` | Framework-owned | Better Auth | Sign-up, sign-in, sign-out, session, organization plugin endpoints |
| `GET` | `/healthz` | None | None | Liveness; touches no dependency |
| `GET` | `/readyz` | None | None | Readiness; DB probe, breaker, draining |
| `GET` | `/api/health` | None | None | Deprecated alias of readiness |
| `GET` | `/api/v1/openapi.json` | None | None | Live OpenAPI 3.1 document |
| `GET` | `/api/v1/docs` | None | None | Swagger UI page |
| `POST` | `/api/v1/registration` | Anonymous | None | Project-owned registration; optional idempotency key |
| `GET` | `/api/v1/contacts` | Session + tenant | Membership only (all roles may read) | Paginated/filterable/searchable list; ETag |
| `GET` | `/api/v1/contacts/{id}` | Session + tenant | `contacts:read` | Cross-tenant id → 404 |
| `POST` | `/api/v1/contacts` | Session + tenant | Membership only (all roles may write) | Optional `Idempotency-Key` |
| `PATCH` | `/api/v1/contacts/{id}` | Session + tenant | `contacts:write` | Partial update |
| `DELETE` | `/api/v1/contacts/{id}` | Session + tenant | `contacts:delete` | Hard delete + audit |
| `POST` | `/api/v1/contacts/bulk` | Session + tenant | `contacts:bulk` | Transactional batch, optional idempotency key |
| `GET` | `/api/v1/branches` | Session + tenant | `branches:read` | ETag |
| `POST` | `/api/v1/branches` | Session + tenant | `branches:write` | No idempotency wrapper |
| `PATCH` | `/api/v1/branches/{id}` | Session + tenant | `branches:write` | Rename only |
| `DELETE` | `/api/v1/branches/{id}` | Session + tenant | `branches:write` | Contacts referencing it get `branch_id = NULL` |
| `POST` | `/graphql` | Session + tenant | Per resolver | GraphQL Yoga; no playground |
| `GET`/`POST` | `/graphql` | Session + tenant | Per resolver | GET supported by Yoga/Hono route |

Legacy aliases (deprecated with headers, same handlers):

| Legacy path | Successor |
| --- | --- |
| `/api/contacts` | `/api/v1/contacts` |
| `/api/branches` | `/api/v1/branches` |
| `/api/registration` | `/api/v1/registration` |
| `/api/health` | `/readyz` |

`Sunset` is hard-coded to `Wed, 31 Mar 2027 23:59:59 GMT`.

### 7.2 Response envelope

Every product/health/error response uses:

```json
{ "success": true, "data": { } }
```

or, for collections:

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

or:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid contact data",
    "details": { "fieldErrors": { "name": ["Name is required"] } }
  }
}
```

Rules:

- The HTTP status is not repeated inside the body.
- Unknown 500 errors are masked as
  `{"code":"INTERNAL_SERVER_ERROR","message":"An unexpected error occurred"}`.
- `Retry-After` accompanies 429.
- `idempotent-replayed: true` accompanies a replayed idempotent response.
- `ETag` may accompany list responses; `If-None-Match` can produce 304.

### 7.3 Error classes

`packages/core/src/errors.ts` defines:

| Class | Status | Code |
| --- | --- | --- |
| `AppError` | configurable (500 default) | configurable |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `BadRequestError` | 400 | `BAD_REQUEST` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `ConflictError` | 409 | `CONFLICT` or domain-specific |
| `TooManyRequestsError` | 429 | `TOO_MANY_REQUESTS` |
| `PayloadTooLargeError` | 413 | `PAYLOAD_TOO_LARGE` |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` |
| `TenantContextError` | 500 | `TENANT_CONTEXT_REQUIRED` |

Domain-specific conflict codes include `EMAIL_ALREADY_REGISTERED` and
`INVITE_CODE_ALREADY_USED`.

### 7.4 Contacts API details

**List** `GET /api/v1/contacts`:

- Query: `page` ≥ 1 (default 1), `limit` 1–100 (default 20), optional `status`
  (`active|lead|churned`), optional `branchId` UUID, optional `search`.
- Search is a case-insensitive contains match on `name`, `email`, and `phone`.
- User-supplied `%`, `_`, and `\` are escaped; queries use
  `ILIKE ... ESCAPE '\'`.
- Response includes pagination metadata.
- `ETag` middleware is mounted on the collection.

**Read** `GET /api/v1/contacts/{id}`:

- Path id must be a UUID.
- Missing or cross-tenant id → 404.

**Create** `POST /api/v1/contacts`:

- Body: `name` required; `phone`, `email`, `branchId`, `status`, `optIn`,
  `metadata` optional. An empty `email` string is accepted and stored as `null`.
- Defaults: `status=active`, `optIn=true`, `metadata={}`.
- `branchId` falls back to the request tenant branch (`x-branch-id`/query).
- Referenced branch must belong to the tenant.
- Optional `Idempotency-Key` header is supported.
- Audit event: `contact.created`.

**Update** `PATCH /api/v1/contacts/{id}`:

- At least one field required.
- Only supplied fields are written.
- Nullable fields (`phone`, `email`, `branchId`) accept explicit `null`.
- Audit event: `contact.updated`, with a before/after diff.
- Not idempotency-wrapped.

**Delete** `DELETE /api/v1/contacts/{id}`:

- Hard delete.
- Audit event: `contact.deleted`, with previous state.
- Not idempotency-wrapped; a retry after success returns 404.

**Bulk create** `POST /api/v1/contacts/bulk`:

- Body: `{ "contacts": [...] }`, 1..`BULK_MAX_CONTACTS`.
- Entire batch runs inside one tenant transaction.
- Audit rows are written inside the same transaction.
- Optional `Idempotency-Key`.
- Response: `{ count, contacts }`.

**Metadata limits**:

- Maximum depth: 3.
- Maximum serialized size: 8192 bytes.
- Must be a JSON object (record), not an array or scalar at the top level.

### 7.5 Branches API details

- Branch body is `{ "name": string }`, 1–200 characters.
- List includes ETag and returns all branches of the tenant ordered by
  `createdAt` ascending.
- Create/update/delete are audited.
- Branch mutations are not covered by the idempotency service.
- Deleting a branch does not delete its contacts; the foreign key sets
  `contacts.branch_id` to `NULL`.

### 7.6 Registration API details

`POST /api/v1/registration` accepts:

```json
{
  "email": "user@example.com",
  "password": "at-least-8-characters",
  "name": "User Name",
  "inviteCode": "optional"
}
```

- Anonymous; no session/tenant required.
- The route supports `Idempotency-Key` at runtime, but this header is not
  declared in the route's OpenAPI request schema (contract gap).
- Idempotency scope is `registration:<hashPayload(email)>`; `hashPayload` is the
  SHA-256 of the canonical JSON form of the raw email, before normalization. The
  same key cannot replay another identity's response.
- Response is 201 with `{ email, status, message }`.
- Duplicate email → 409 `EMAIL_ALREADY_REGISTERED`.

### 7.7 Rate limiting and size limits

- **Auth limiter** (Better Auth): per route class, configured by
  `AUTH_RATE_LIMIT_*`.
- **Write limiter** (application): per method + client IP, all write methods,
  including auth routes because it is mounted before the auth handler.
- **Body limit**: global, before route parsing.
- **Bulk limit**: validation-level maximum on contact batch size.
- **GraphQL limits**: query depth and field cost before execution.

All rate-limit state is process-local. Multi-instance deployments do not share
counters.

---

## 14. GraphQL Surface

### 14.1 Endpoint and context

- Path: `/graphql`, methods `GET` and `POST`.
- Server: GraphQL Yoga.
- GraphiQL disabled.
- Access logging disabled in Yoga; the shared HTTP pipeline logs the request.
- Mounted behind `tenantContextMiddleware`, so every operation requires a
  session and an active organization/membership.
- Context: `{ env, logger, services, user, tenant }`.
- Resolvers cannot access the database handle or repositories directly; they
  receive services only.

### 14.2 Schema

Types:

- `Organization { id, name, slug, createdAt }`
- `Branch { id, name, createdAt }`
- `Contact { id, name, phone, email, branchId, status, optIn, metadata,
  createdAt, updatedAt }`
- `ContactStatus`: `ACTIVE | LEAD | CHURNED`
- `PageInfo`, `ContactPage`
- `DeleteContactPayload`, `DeleteBranchPayload`, `ImportContactsPayload`
- Custom `JSON` scalar for metadata

Queries:

- `organization`
- `contact(id)`
- `contacts(page, limit, filter)`
- `branch(id)`
- `branches`

Mutations:

- `createContact(input)`
- `updateContact(id, input)`
- `deleteContact(id)`
- `importContacts(contacts, branchId)`
- `createBranch(input)`
- `updateBranch(id, input)`
- `deleteBranch(id)`

Auth operations are intentionally absent. Better Auth remains REST-only.

### 14.3 Validation and authorization

- Every argument is parsed with the **same Zod schema** as the corresponding REST
  route where one exists.
- GraphQL status values are translated `ACTIVE → active`, etc.
- Mutations call `authorize(context, permission)` with the shared permission
  matrix.
- Queries rely on tenant membership; they do not call per-resolver read guards.
- Tenant id always comes from `context.tenant`, never from arguments.
- Cross-tenant ids become `NOT_FOUND`.

### 14.4 Errors

`run()` wraps each resolver:

- `AppError` → GraphQLError with `extensions.code`,
  `extensions.statusCode`, and `extensions.details`.
- `GraphQLError` → passed through.
- Unknown error → logged and masked as `INTERNAL_SERVER_ERROR`, status 500.

GraphQL always answers HTTP 200 for execution errors, with the error in the
`errors` array; REST uses the HTTP status. The `extensions.statusCode` is the
bridge between the two.

### 14.5 Safety controls

- Introspection disabled by default in production; controlled by
  `GRAPHQL_INTROSPECTION_ENABLED`, otherwise `NODE_ENV !== "production"`.
- `GRAPHQL_MAX_DEPTH` limits selection nesting.
- `GRAPHQL_MAX_COMPLEXITY` limits field count with fragments expanded.
- Introspection documents bypass depth/cost checks but are rejected by
  `NoSchemaIntrospectionCustomRule` when introspection is off.
- Fragment cycles are left to standard GraphQL validation.
- GET requests are supported; query-cost limits apply to both methods.
- GraphQL length/alias abuse is only bounded by depth/cost, not by a separate
  body-size limit specific to GraphQL (the global body limit applies).

### 14.6 REST/GraphQL parity differences

| Concern | REST | GraphQL |
| --- | --- | --- |
| Status vocabulary | lowercase | enum uppercase |
| Pagination | query params | `page`/`limit` args |
| Idempotency-Key | supported on create/bulk | not supported |
| ETag/304 | list endpoints | not implemented |
| Error transport | HTTP status + envelope | HTTP 200 + `errors[].extensions` |
| Introspection/docs | OpenAPI/Swagger | GraphQL introspection flag |
| Registration/auth/org management | partially REST | absent |
| Rate limiting | write limiter by IP | same HTTP pipeline limiter |
| Audit | same services | same services |

---

## 15. OpenAPI and Contract Snapshots

### 15.1 Generation model

- Every product route is declared with `createRoute` from
  `@hono/zod-openapi`.
- The same Zod object validates the request at runtime and appears in the
  generated document.
- The document is generated from the **mounted app registry**, not from a
  static file.
- Live endpoints:
  - `GET /api/v1/openapi.json` → OpenAPI 3.1 JSON
  - `GET /api/v1/docs` → Swagger UI
- Document metadata:
  - title `Open SaaS API`
  - version `1.0.0`
  - tags `Contacts`, `Branches`, `Registration`
  - server `/`

### 15.2 What is documented

- Only `/api/v1/*` product routes.
- Contacts: list, read, create, update, delete, bulk.
- Branches: list, create, update, delete.
- Registration: create.
- Shared error response schemas.
- Pagination on the contacts list.

### 15.3 What is not documented

- `/api/auth/*` (owned by Better Auth; its own discovery surface applies).
- `/graphql`.
- `/healthz`, `/readyz`, `/api/health`.
- Legacy aliases (`/api/contacts`, etc.). They are mounted on plain Hono
  applications so they do not enter the OpenAPI registry.
- The `Idempotency-Key` header on registration (the handler reads it, but the
  route declaration does not include it).
- Some possible failures (for example 403/429 on routes that can produce them
  through shared middleware) are not always listed per route.

### 15.4 Snapshots and drift checks

Committed artifacts:

- `apps/api/openapi.json`
- `apps/api/graphql.schema.graphql`

Scripts:

- `openapi:generate` writes the OpenAPI snapshot.
- `openapi:check` compares the current app registry against the snapshot.
- `graphql:generate` writes the SDL snapshot.
- `graphql:check` compares the executable schema against the snapshot.

Both checks run in CI before tests. A route/schema change without regenerating
the snapshot fails the pipeline. The snapshots are the reviewable contract;
the live endpoints are the runtime contract.

### 15.5 Swagger UI

- Version: Swagger UI `5.17.14`.
- Loaded from jsDelivr.
- The docs route relaxes CSP only for the CDN script/style/image sources.
- `persistAuthorization: true` stores the bearer token in browser storage.
- The API itself does not serve the Swagger bundle; an air-gapped deployment
  cannot render the docs page without changing this.

---

## Related

- [Overview](overview.md)
- [Authentication](authentication.md)
- [Multi-tenancy](multi-tenancy.md)
- [Data and services](data-and-services.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
