# Open SaaS API Documentation

> Audience: developers and coding agents working in this repository.
>
> Scope: the system **as implemented in this repository**. Where the code and an
> aspirational comment disagree, the code is the source of truth and the gap
> belongs in [Technical Debt](technical-debt.md#20-technical-debt-and-current-gaps).

This directory is the source of truth for the architecture and development
guide. The original single-file guide was split by concern; section numbers
(§1–§25) are kept for traceability.

## Documents

| Document | Contents |
| --- | --- |
| [Architecture overview](architecture/overview.md) | §1–§3: purpose, runtime context, repository layout, package graph |
| [Runtime](architecture/runtime.md) | §4–§5: boot, shutdown, request lifecycle, middleware order |
| [Configuration](architecture/configuration.md) | §6: validated environment, defaults, configuration gaps |
| [API and contracts](architecture/api.md) | §7, §14, §15: REST, GraphQL, OpenAPI snapshots, Swagger UI |
| [Authentication](architecture/authentication.md) | §8–§9: Better Auth, sessions, organizations, registration modes |
| [Multi-tenancy](architecture/multi-tenancy.md) | §10: application tenancy, RLS, RBAC, branch scoping, ADR-0001 |
| [Data and services](architecture/data-and-services.md) | §11–§13: schema, persistence, transactions, service layer |
| [Operations](architecture/operations.md) | §16, §19: logging, health, shutdown, build, deployment, CI/CD |
| [Security](architecture/security.md) | §17: trust boundaries, authorization, secrets, PII, residual risks |
| [Testing](architecture/testing.md) | §18: runner, database isolation, helpers, coverage, CI |
| [Development guide & conventions](development-guide.md) | §21–§22: extension playbooks, architectural invariants |
| [Technical debt](technical-debt.md) | §20: known gaps grouped by package, release blockers, tracked issues |
| [Roadmap](roadmap.md) | Phases 1–6, backlog and ongoing engineering work |
| [Reference](reference.md) | §23–§25: file index, glossary, suggested reading order |
| [Demo](examples/demo.ts) | Runnable end-to-end example against a live API |

## Where to start

- **New developer:** overview → runtime → multi-tenancy → API → authentication
  → data and services → operations → [development guide](development-guide.md).
- **Coding agent:** [invariants](development-guide.md#22-architectural-invariants-and-coding-rules)
  first, then the relevant playbook in
  [Extension Playbooks](development-guide.md#21-extension-playbooks), then the
  current gap in [Technical Debt](technical-debt.md).
- **Touching tenant data:** [multi-tenancy](architecture/multi-tenancy.md) and
  [data and services](architecture/data-and-services.md) before writing code.
- **Planning features:** [roadmap](roadmap.md), check [technical debt](technical-debt.md).

## Quick map by change

| Change | Read |
| --- | --- |
| Add an environment variable | [Configuration](architecture/configuration.md), [playbook §21.1](development-guide.md#211-add-a-configuration-variable) |
| Add a tenant-scoped table | [Multi-tenancy](architecture/multi-tenancy.md), [playbook §21.2](development-guide.md#212-add-a-tenant-scoped-table) |
| Add a REST endpoint | [API](architecture/api.md), [services §13](architecture/data-and-services.md#13-service-layer), [playbook §21.3](development-guide.md#213-add-a-rest-endpoint) |
| Add a role or permission | [Permission matrix §10.3](architecture/multi-tenancy.md#103-permission-matrix), [playbook §21.4](development-guide.md#214-add-a-permission-or-role) |
| Add a GraphQL field or mutation | [GraphQL §14](architecture/api.md#14-graphql-surface), [playbook §21.5](development-guide.md#215-add-a-graphql-field-or-mutation) |
| Add a registration mode | [Registration §9](architecture/authentication.md#9-registration-modes), [playbook §21.6](development-guide.md#216-add-a-registration-mode) |
| Change schema or RLS | [Persistence §12](architecture/data-and-services.md#12-persistence-transactions-and-resilience), [RLS §10](architecture/multi-tenancy.md#10-multi-tenancy-and-authorization), [playbook §21.9](development-guide.md#219-change-the-schema-or-rls-policy-safely) |
| Deploy or operate | [Operations](architecture/operations.md) |
| Add or change tests | [Testing](architecture/testing.md), [invariants §22.6](development-guide.md#226-testing) |
| Review security | [Security](architecture/security.md) |

## Conventions

- Section numbers are global across the split; a reference such as §10.2 keeps
  its meaning regardless of the file.
- Internal links are relative. When a section moves, update the links in this
  index and in the affected documents.
- Architecture describes the code as implemented. Planned work belongs in
  [Roadmap](roadmap.md); gaps belong in [Technical Debt](technical-debt.md),
  not in the present-tense architecture.
