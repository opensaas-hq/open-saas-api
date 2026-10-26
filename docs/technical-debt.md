# Technical Debt

> Part of the [Open SaaS API documentation](README.md). For planned work see [Roadmap](roadmap.md).

## 20. Technical Debt and Current Gaps

Debt is grouped by the package or app that owns the fix. IDs are stable
references used by code comments and other documents; the ordering follows
package ownership, not severity.

Priority levels:

- **Critical:** blocks any production-like deployment.
- **High:** must be fixed before production traffic.
- **Medium:** must be fixed before scaling or before the related feature ships.
- **Low:** opportunistic cleanup with limited operational impact.

### 20.1 Release blockers

These items block a production-like deployment. They are listed here as a
cross-package view; their full entries appear under the owning package. This
table is a derived index, not a second source of truth.

| Owner | Gap | Impact |
| --- | --- | --- |
| [`apps/api`](#202-appsapi) | `@opensaas/api` has no `start` script, but Docker CMD uses it | Container exits immediately |
| [Repository / infrastructure](#207-repository-infrastructure-ci-and-docs) | Dockerfile copies `commitlint.config.cjs`; repo has `.mjs` | Docker build fails before runtime |
| [Repository / infrastructure](#207-repository-infrastructure-ci-and-docs) | Compose seed runs missing `scripts/seed.ts` | `seed` profile fails |
| [Repository / infrastructure](#207-repository-infrastructure-ci-and-docs) | Compose passes `CORS_ORIGINS`, config reads `TRUSTED_ORIGINS` | Browser origins not allowed as intended |
| [Repository / infrastructure](#207-repository-infrastructure-ci-and-docs) | `.env.example` duplicates and contradicts variables | Misconfiguration, ignored knobs |
| [Repository / infrastructure](#207-repository-infrastructure-ci-and-docs) | Docker build stage unused; runtime copies source | Image not reproducible from a built artifact |

### 20.2 apps/api

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-01 | `@opensaas/api` has no `start` script, but Docker CMD uses it | Container exits immediately | Critical | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-02 | No REST organization/member/invitation management beyond Better Auth | Product cannot manage teams through its own versioned API | High | [Backlog](roadmap.md#backlog) |
| TD-03 | No audit query/export API | Audit data is write-only to clients/operators via SQL | Medium | [Backlog](roadmap.md#backlog) |
| TD-04 | No GDPR export/delete or consent endpoints | Privacy compliance gap | High | [Backlog](roadmap.md#backlog) |
| TD-05 | No contact import/export beyond bulk create | Operational gap | Medium | [Backlog](roadmap.md#backlog) |
| TD-06 | No background jobs/queue | Cleanup and messaging must be request-driven | High | [Phase 5](roadmap.md#phase-5-event-bus-customer-webhooks-notifications-and-automations) |
| TD-07 | Rate limiting is per-process and per-method+IP | Multi-instance limits are weaker | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-08 | Membership cache is per-process | Role changes are stale per instance | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-09 | No metrics, tracing, or error tracking | Poor production diagnosability | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-10 | No load shedding/queueing beyond rate limits | Overload behavior is undefined | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-11 | CORS missing `Idempotency-Key` and `If-None-Match` | Browser clients cannot use those features | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-12 | CORS does not expose `ETag`/`idempotent-replayed` | Cross-origin clients cannot read them | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-13 | No request replay protection except idempotency keys | Replay risk on cookie-auth writes | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-14 | Swagger UI loads assets from a CDN | Supply-chain/air-gap concern | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-15 | `persistAuthorization` stores bearer tokens in browser storage | Token exposure on shared hosts | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-16 | Registration `Idempotency-Key` not declared in OpenAPI | Contract incomplete | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-17 | GraphQL is not in OpenAPI and has no separate published contract | Discovery gap | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-18 | Health routes undocumented in OpenAPI | Ops contract undocumented | Low | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-19 | GraphQL lacks idempotency and ETag parity | Client inconsistency | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-20 | Legacy aliases partly duplicate router construction | Duplicate construction, subtle drift risk | Low | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |

### 20.3 packages/core

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-21 | Email/phone/name are not redacted from error logs | Potential PII leakage | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |

### 20.4 packages/auth

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-22 | Email verification policy is undecided; verification is not enforced and the default sender is a no-op | Verification cannot be enabled safely until policy and delivery are resolved | Medium | [Phase 3](roadmap.md#phase-3-session-management-and-telemetry); enforcement in [Phase 4](roadmap.md#phase-4-transactional-channels-waha-email-and-routing) |
| TD-23 | Default email sender discards messages | Verification/reset never delivered by default | High | [Phase 4](roadmap.md#phase-4-transactional-channels-waha-email-and-routing) |
| TD-24 | Default payment verifier denies all | `paid_required` mode cannot admit anyone | High | [Backlog](roadmap.md#backlog) |
| TD-25 | No configured real payment provider; the registry accepts a port but the API hard-wires deny-all | Paid registration needs code changes | High | [Backlog](roadmap.md#backlog) |
| TD-26 | No MFA/SSO/API-key management UI | Enterprise auth gap | Medium | [Backlog](roadmap.md#backlog) |
| TD-27 | No organization transfer/ownership workflow; deletion exists only through Better Auth | Lifecycle gap in the product API | Medium | [Backlog](roadmap.md#backlog) |
| TD-28 | Trusted proxy headers are accepted unconditionally | IP spoofing if directly exposed | High | [Phase 3](roadmap.md#phase-3-session-management-and-telemetry) |
| TD-29 | No CSRF tokens beyond origin checks | Reliance on origin policy/content type | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-30 | No anti-abuse beyond IP rate limits | Registration abuse risk | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |

### 20.5 packages/database

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-31 | `member` lacks unique `(organization_id,user_id)` | Duplicate memberships possible | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-32 | Single-row contact/branch mutations audit after commit | Lost audit event on crash | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-33 | `audit_log` has no foreign keys to tenants or users | Orphan audit rows after deletes | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-34 | `contacts.branch_id` is not a composite tenant FK | DB permits cross-tenant references | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-35 | Transaction GUC not verified on injected `tx` | Caller must set it correctly | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-36 | `registration_code` has no check constraints | Invalid use counts possible outside service | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-37 | `waitlist_entry`/`registration_code` redundant indexes | Minor write/storage overhead | Low | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-38 | `audit_log` append-only by convention | Privileged writes can alter history | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-39 | Idempotency stores response bodies verbatim | PII retained for TTL | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-40 | Idempotency claim/complete is not atomic with the operation | Crash can leave a stuck in-flight key | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-41 | Idempotency cleanup only runs on keyed requests | Expired rows can persist | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-42 | Registration idempotency scope hashes raw email before normalization | Case/alias variants use different scopes | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-43 | No database-enforced uniqueness for branch names | Duplicate names allowed | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-44 | No optimistic concurrency/version column | Lost updates possible on concurrent PATCH | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-45 | `executeResilient` is not wired into ordinary repository calls | Transient DB errors surface directly | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-46 | Request traffic does not feed the circuit breaker | Breaker state does not reflect real failures | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-47 | RLS bootstrap is not part of migrations/deploy | RLS may be absent despite `RLS_ENABLED=true` | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-48 | RLS covers only three tables | New tenant tables need manual policy work | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-49 | Better Auth tables are outside RLS | App-layer bug is not contained | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |

### 20.6 Future packages

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-50 | `automation`, `billing`, `crm`, `messaging`, `pipeline`, `webhooks` are empty directories | Roadmap placeholders, no implementation | Low | [Backlog](roadmap.md#backlog) |

### 20.7 Repository, infrastructure, CI and docs

| ID | Gap | Impact | Priority | Roadmap |
| --- | --- | --- | --- | --- |
| TD-51 | Dockerfile copies `commitlint.config.cjs`; repo has `.mjs` | Docker build fails before runtime | Critical | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-52 | Compose seed runs missing `scripts/seed.ts` | `seed` profile fails | Critical | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-53 | Compose passes `CORS_ORIGINS`, config reads `TRUSTED_ORIGINS` | Browser origins not allowed as intended | High | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-54 | `.env.example` duplicates and contradicts variables | Misconfiguration, ignored knobs | High | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-55 | Docker build stage unused; runtime copies source | Image not reproducible from a built artifact | High | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-56 | No retention/rotation for logs/sessions/audit/idempotency | Unbounded data growth | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-57 | No backups/restore procedure in repo | Operational risk | High | [Phase 6](roadmap.md#phase-6-open-core-release-automation-and-self-hosting) |
| TD-58 | No multi-instance coordination | Sticky/independent state | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-59 | No secret rotation or secret manager | Operational secret risk | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-60 | `.env.example` documents ignored `DB_CIRCUIT_BREAKER_*` names | Knobs appear effective but are not | Medium | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-61 | No `start`/production migration script documented in README | Deployment gap | High | [Phase 1](roadmap.md#phase-1-release-readiness-and-reproducible-deployment) |
| TD-62 | No OpenAPI/GraphQL snapshot check in CD | Contract drift can ship if CI is skipped | Medium | [Phase 6](roadmap.md#phase-6-open-core-release-automation-and-self-hosting) |
| TD-63 | No coverage thresholds | Regressions can pass | Medium | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
| TD-64 | Main CI DB URL mismatch risk | Integration suites may not run reliably | High | [Phase 2](roadmap.md#phase-2-security-data-integrity-and-ci-hardening) |
