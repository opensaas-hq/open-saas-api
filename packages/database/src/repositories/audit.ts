import type { AuditEvent, AuditPort } from "@opensaas/core";
import { toAuditRecord } from "@opensaas/core";
import { and, asc, eq } from "drizzle-orm";
import { type Transaction, db } from "../client";
import { auditLog } from "../schema";

/**
 * Database-backed {@link AuditPort}. Persists each event as a row in
 * `audit_log`, applying the shared redaction + storage-shape helper
 * (`toAuditRecord`) from `@opensaas/core`, so sensitive values never reach the
 * store.
 *
 * Note: this deliberately imports `@opensaas/core`, which makes
 * `@opensaas/database` an importer of a workspace package. The roadmap (§2.2)
 * requires this repository to implement `AuditPort` as the single audit
 * contract; see the dependency-graph note tracked in `technical-debt.md`.
 */
export class DatabaseAuditRepository implements AuditPort {
  constructor(private readonly executor: Transaction | typeof db = db) {}

  async record(event: AuditEvent): Promise<void> {
    await this.executor.insert(auditLog).values(toAuditValues(event));
  }

  async recordMany(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.executor
      .insert(auditLog)
      .values(events.map((event) => toAuditValues(event)));
  }
}

/** Options for {@link listAuditRows}: the tenant is required. */
export type ListAuditRowsOptions = {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  tx?: Transaction;
};

/**
 * List audit rows for one organization, optionally narrowed to a single entity.
 * `organizationId` is required and always applied in the `WHERE`.
 */
export async function listAuditRows(options: ListAuditRowsOptions) {
  const executor = options.tx ?? db;
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));

  const conditions = [eq(auditLog.organizationId, options.organizationId)];

  if (options.entityType) {
    conditions.push(eq(auditLog.entityType, options.entityType));
  }

  if (options.entityId) {
    conditions.push(eq(auditLog.entityId, options.entityId));
  }

  return await executor
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(asc(auditLog.createdAt))
    .limit(limit);
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
