import type { AuditEvent, AuditPort } from "@opensaas/core";
import { TenantContextError, toAuditRecord } from "@opensaas/core";
import { and, asc, eq } from "drizzle-orm";
import { type Database, type Transaction, runInTenantContext } from "../client";
import { auditLog } from "../schema";

/**
 * Database-backed {@link AuditPort}. Persists each event as a row in
 * `audit_log`, applying the shared redaction + storage-shape helper
 * (`toAuditRecord`) from `@opensaas/core`, so sensitive values never reach the
 * store.
 *
 * `audit_log` is RLS-protected (§2.5), so writes carry the tenant GUC. When an
 * executor is injected (a surrounding transaction), the caller already set the
 * GUC; otherwise the repository derives the tenant from each event.
 *
 * Note: this deliberately imports `@opensaas/core`, which makes
 * `@opensaas/database` an importer of a workspace package. The roadmap (§2.2)
 * requires this repository to implement `AuditPort` as the single audit
 * contract; see the dependency-graph note tracked in `technical-debt.md`.
 */
export class DatabaseAuditRepository implements AuditPort {
  constructor(
    private readonly executor: Transaction | undefined = undefined,
    private readonly db: Database | undefined = undefined,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    if (this.executor) {
      await this.executor.insert(auditLog).values(toAuditValues(event));
      return;
    }
    await runInTenantContext({
      organizationId: event.organizationId,
      db: this.db,
      run: async (tx) => {
        await tx.insert(auditLog).values(toAuditValues(event));
      },
    });
  }

  async recordMany(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;

    if (this.executor) {
      await this.executor
        .insert(auditLog)
        .values(events.map((event) => toAuditValues(event)));
      return;
    }

    // All events in one call are written under a single tenant transaction, so
    // they must share one organization.
    const [first, ...rest] = events;
    const organizationId = first?.organizationId;
    if (
      !organizationId ||
      rest.some((e) => e.organizationId !== organizationId)
    ) {
      throw new TenantContextError(
        "recordMany requires every event to share one organizationId",
        { field: "organizationId" },
      );
    }

    await runInTenantContext({
      organizationId,
      db: this.db,
      run: async (tx) => {
        await tx
          .insert(auditLog)
          .values(events.map((event) => toAuditValues(event)));
      },
    });
  }
}

/** Options for {@link listAuditRows}: the tenant is required. */
export type ListAuditRowsOptions = {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/**
 * List audit rows for one organization, optionally narrowed to a single entity.
 * `organizationId` is required and always applied in the `WHERE`; the query runs
 * with the tenant GUC set (§2.5.2).
 */
export async function listAuditRows(options: ListAuditRowsOptions) {
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));

  const conditions = [eq(auditLog.organizationId, options.organizationId)];

  if (options.entityType) {
    conditions.push(eq(auditLog.entityType, options.entityType));
  }

  if (options.entityId) {
    conditions.push(eq(auditLog.entityId, options.entityId));
  }

  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) =>
      await tx
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(asc(auditLog.createdAt))
        .limit(limit),
  });
}

/** Map an event to its (redacted) insert values. */
const toAuditValues = (event: AuditEvent) => {
  const record = toAuditRecord(event);

  return {
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    actorId: record.actorId,
    organizationId: record.organizationId,
    changes: record.changes ?? null,
    metadata: record.metadata ?? null,
    createdAt: new Date(record.createdAt),
  };
};
