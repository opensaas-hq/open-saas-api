# Roadmap

## Current State

The project is functional and pre-release. The implemented baseline includes the
monorepo, Better Auth authentication, organizations and memberships, the
multi-tenant REST API, RLS, contacts and branches CRUD, GraphQL, OpenAPI and
GraphQL contract snapshots, idempotency, audit events, session telemetry, an
end-to-end test, and the baseline CI pipeline.

The next milestone is a reproducible deployment. Known gaps and release blockers
are tracked in [Technical Debt](technical-debt.md).

## Priorities

| Phase | Status | Priority | Effort | Scope |
| --- | --- | --- | --- | --- |
| Phase 1 | Planned | Critical | Medium | Release readiness and reproducible deployment |
| Phase 2 | Partial | High | High | Security, data integrity and CI hardening |
| Phase 3 | Partial | High | Medium | Session management and telemetry |
| Phase 4 | Planned | High | High | WAHA, email and transactional routing |
| Phase 5 | Planned | Medium-High | High | Event bus, customer webhooks, notifications and automations |
| Phase 6 | Partial | Medium-High | Medium-High | Open-core, release automation and self-hosting |
| Backlog | Not scheduled | Medium | Variable | Product gaps outside the current sequence |
| Ongoing Engineering | Ongoing | Medium | Variable | Dependency policy, configuration and targeted middleware work |

## Phase 1: Release Readiness and Reproducible Deployment

**Objective:** Make the existing system deployable from a clean checkout and a
reproducible container image.

**Status:** Planned. Tracks TD-01, TD-51, TD-52, TD-53, TD-54, TD-55, TD-60 and
TD-61.

### Tasks

- [ ] Add the missing `start` script to `@opensaas/api` and verify the Docker CMD.
- [ ] Fix the Dockerfile to copy `commitlint.config.mjs` instead of the nonexistent `.cjs` file.
- [ ] Make the Compose seed profile runnable, or remove the broken profile.
- [ ] Align Compose with the configured CORS variable name.
- [ ] Remove duplicate and ignored variables from `.env.example`.
- [ ] Make the runtime image use the build stage output instead of copied source.
- [ ] Document production start, migrations and RLS bootstrap in the README.
- [ ] Add a deployment smoke test for `/healthz` and `/readyz`.

### Acceptance criteria

- `docker compose up` starts the API and database from a clean checkout.
- `bun run --filter @opensaas/api start` serves the API.
- The image is built from the build stage, not from source copied at runtime.
- No documented environment variable is silently ignored.
- A deployment smoke test reaches `/healthz` and `/readyz`.

## Phase 2: Security, Data Integrity and CI Hardening

**Objective:** Harden the application, data layer and delivery pipeline before
production traffic, building on the existing CI baseline.

**Status:** Partial. The CI already runs Biome, TypeScript, OpenAPI/GraphQL drift
checks, migrations, tests and the RLS proof suite. Release-path contract checks
are tracked in Phase 6.

### 2.1 CI, dependencies and supply chain

- [ ] Choose one primary SAST engine (CodeQL or Semgrep) and document the policy.
- [ ] Add Zizmor for GitHub Actions workflow security.
- [ ] Add Knip for dead code and unused dependency detection.
- [ ] Add Trivy for dependency and container image scanning.
- [ ] Add coverage reporting with a defined threshold (Codecov or SonarQube).
- [ ] Add a security gate that blocks critical and high findings.
- [ ] Fix the main CI database URL mismatch so integration suites run reliably.

**Acceptance criteria**

- Security checks run on every pull request.
- Critical and high findings block merges according to the agreed policy.
- Coverage thresholds are enforced.
- Integration suites use the intended database URL.

### 2.2 Application security and contracts

- [ ] Fix CORS request and exposed-header gaps.
- [ ] Redact email, phone and name from error logs.
- [ ] Add replay protection and CSRF hardening.
- [ ] Add anti-abuse controls beyond per-IP rate limits.
- [ ] Remove the Swagger UI CDN dependency.
- [ ] Stop persisting bearer tokens in browser storage by default.
- [ ] Complete OpenAPI and GraphQL contracts, including idempotency and health routes.
- [ ] Remove duplicate legacy router aliases.

**Acceptance criteria**

- Cookie-authenticated writes have replay and CSRF protection.
- Logs do not contain email, phone or name fields.
- Browser clients can use idempotency and ETag features cross-origin.
- Published contracts describe the supported REST and GraphQL surfaces.

### 2.3 Data integrity, RLS and resilience

Audit atomicity, idempotency and optimistic concurrency are prerequisites for
event-driven work; Phase 5 builds on them.

- [ ] Enforce membership uniqueness and tenant-safe composite foreign keys.
- [ ] Add database constraints for registration codes and branch names.
- [ ] Verify the tenant GUC on injected transactions.
- [ ] Move single-row audit writes into the same transaction as the mutation.
- [ ] Add audit foreign keys and make append-only enforcement explicit.
- [ ] Make idempotency claim/complete atomic and run cleanup independently of traffic.
- [ ] Normalize the registration idempotency scope and minimize retained response data.
- [ ] Add optimistic concurrency/versioning for mutable business records.
- [ ] Wire resilient DB execution and the circuit breaker into request traffic.
- [ ] Add an explicit RLS bootstrap step to the deploy path and extend policies to remaining tenant tables.
- [ ] Remove redundant indexes.

**Acceptance criteria**

- Tenant-scoped writes cannot reference another tenant's rows.
- RLS is present wherever `RLS_ENABLED=true`, including Better Auth tables.
- The RLS proof suite remains a required check.
- Audit events are not lost when a mutation commits.
- Idempotency keys cannot remain stuck in-flight after a crash.
- Concurrent updates cannot silently overwrite each other.

### 2.4 Operational readiness

- [ ] Add baseline metrics, tracing or error tracking.
- [ ] Make rate limiting and membership caches safe across instances.
- [ ] Define load shedding and queueing behavior beyond rate limits.
- [ ] Define retention and rotation for logs, sessions, audit and idempotency data.
- [ ] Add secret rotation guidance and production secret handling.
- [ ] Document multi-instance coordination requirements.

**Acceptance criteria**

- Production failures are diagnosable from metrics, traces or error reports.
- Rate limits and role changes behave consistently across instances.
- Retention policies bound storage growth.
- Secrets have a documented rotation path.

## Phase 3: Session Management and Telemetry

**Objective:** Complete the session lifecycle around the telemetry already
captured by Better Auth.

**Status:** Partial. Session telemetry, IP extraction and user-agent heuristics
already exist.

### Tasks

- [ ] Define an ADR for organization-scoped session listing and revocation.
- [ ] Expose active sessions per organization through the product API.
- [ ] Support revoking a session or all sessions for a user.
- [ ] Add login audit events and a traceable session history.
- [ ] Strengthen device fingerprinting and proxy/Cloudflare handling.
- [ ] Decide whether email verification is required before sign-in; enforce it
  only after Phase 4 provides reliable delivery.

### Acceptance criteria

- Session metadata is reliable across direct connections and trusted proxies.
- Owners and admins can list and revoke organization-scoped sessions.
- Login and revocation events are auditable.
- Trusted proxy headers are accepted only from configured proxies.
- The email verification enforcement policy is recorded as an ADR.

## Phase 4: Transactional Channels: WAHA, Email and Routing

**Objective:** Add outbound transactional messaging through interchangeable
providers with deterministic routing.

**Status:** Planned. The email port exists, but the default sender does not
deliver and no real provider is configured.

### Tasks

- [ ] Add a WAHA client for text messages, templates, session status and inbound WhatsApp webhooks.
- [ ] Add a real transactional email provider adapter (Resend, SendGrid or SMTP).
- [ ] Define an ADR for system-level WAHA/WhatsApp/email ownership versus tenant-level overrides.
- [ ] Support multiple channels with round-robin, fallback and one-to-one routing.
- [ ] Route by event type, distinguishing transactional messages from reminders.
- [ ] Require email verification when configured, after delivery is reliable.

Customer-facing webhooks are intentionally out of scope here; they are tracked in
Phase 5.

### Acceptance criteria

- Providers are replaceable without changing business services.
- Routing is configurable and has a tested fallback path.
- Transactional events reach the correct channel.
- Verification and reset messages are delivered, and verification enforcement
  is configurable.
- The default configuration either delivers mail or fails clearly at boot when
  delivery is required.

## Phase 5: Event Bus, Customer Webhooks, Notifications and Automations

**Objective:** Build a typed asynchronous event layer for internal notifications,
customer webhooks and automation workflows.

**Status:** Planned.

### Tasks

- [ ] Define typed internal events and their schemas.
- [ ] Add an event queue with retries, backoff and dead-letter handling.
- [ ] Add customer webhooks with signing, delivery attempts and replay protection.
- [ ] Decouple security notifications and welcome messages from request paths.
- [ ] Add a Zapier/GoHighLevel-style trigger and action engine.

Data-integrity prerequisites (audit atomicity, idempotency and optimistic
concurrency) live in Phase 2 so they are not blocked on the event layer.

### Acceptance criteria

- Events are typed, auditable and retryable.
- Customer webhooks are signed and observable.
- Notifications no longer depend on request-driven work.
- Automations are configurable and tested.
- Failed deliveries have a visible dead-letter path.

## Phase 6: Open-Core, Release Automation and Self-Hosting

**Objective:** Package the project for repeatable releases and self-hosted
deployment.

**Status:** Partial. `release-it` is configured; reproducible packaging and
self-hosting documentation are not complete.

### Tasks

- [ ] Define the open-core boundary, license model and distribution policy.
- [ ] Verify versioning and release automation end to end with `release-it`.
- [ ] Produce reproducible release artifacts.
- [ ] Run OpenAPI/GraphQL contract drift checks in the release pipeline.
- [ ] Promote the Phase 1 Compose stack to a supported self-hosting profile with seed, backups and upgrades.
- [ ] Document installation, configuration, upgrades, backups and restore.
- [ ] Add self-hosted hardening guidance.

### Acceptance criteria

- The release pipeline produces a versioned, reproducible artifact.
- Contract snapshots cannot drift in the release path.
- The self-hosting Compose profile and guide are tested end to end.
- The open-core boundary is documented before any package is published.

## Backlog

These are known product gaps without a committed phase. Promote them into a phase
when they become a release requirement.

- REST organization, member and invitation management.
- Audit query and export API.
- GDPR export, delete and consent endpoints.
- Contact import and export beyond bulk create.
- Real payment providers and a configurable payment verifier.
- MFA, SSO and API-key management.
- Organization transfer and ownership workflows.
- Empty future packages: `automation`, `billing`, `crm`, `messaging`, `pipeline`
  and `webhooks`.

## Ongoing Engineering

- Define a dependency-update policy (Renovate or Dependabot) instead of a
  one-time "latest versions" task.
- Centralize dependencies only when they are shared by multiple packages.
- Add Hono middleware only when it has a concrete requirement and a test.
- Allow runtime configuration changes through the API only after the security
  and audit model is defined.
- Keep dead-code and technical-debt reduction linked to
  [Technical Debt](technical-debt.md), not as an open-ended roadmap item.

## Decisions and ADRs

The following decisions must be recorded before the related phase is
implemented:

- Channel ownership: system-level WAHA/WhatsApp/email versus tenant overrides.
- Organization-scoped session listing and revocation.
- Email verification enforcement policy.
- Customer webhook signing, retry and replay policy.
- Open-core boundary and license model.

## Tracking

- **Technical debt:** [docs/technical-debt.md](technical-debt.md)
- **Development guide:** [docs/development-guide.md](development-guide.md)
- **Architecture:** [docs/README.md](README.md)
