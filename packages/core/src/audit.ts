import { redact } from "./redact";

/**
 * A field-level change recorded in an audit event: the value before and after a
 * mutation. `before` is `undefined` for a field that was added, `after` is
 * `undefined` for a field that was removed.
 */
export type AuditFieldChange = {
  before: unknown;
  after: unknown;
};

/**
 * The diff carried by an {@link AuditEvent}: a map of changed field names to
 * their before/after values. Only changed fields appear.
 */
export type AuditChanges = Record<string, AuditFieldChange>;

/**
 * A single audit event: who did what, to which entity, within which tenant.
 *
 * The shape mirrors the `audit_log` table and repository introduced in
 * `packages/database` (§2.2), so an implementation can persist an event without
 * translation. `actorId` and `organizationId` are required — audit events are
 * always attributable to a user acting inside a tenant.
 *
 * This is a port type owned by `@opensaas/core`: core stays a leaf and contains
 * no persistence, only the contract and pure helpers. The database repository
 * implements it (§2.2) and `apps/api` services decide what gets audited (§4.4).
 */
export type AuditEvent = {
  /** Verb describing the mutation, e.g. `contact.created`, `contact.updated`. */
  action: string;
  /** Entity kind that was touched, e.g. `contact`, `branch`. */
  entityType: string;
  /** Identifier of the touched entity. */
  entityId: string;
  /** User who performed the mutation. */
  actorId: string;
  /** Tenant the mutation happened in. */
  organizationId: string;
  /** Field-level before/after diff, or `undefined` for non-entity actions. */
  changes?: AuditChanges;
  /** Free-form context that is not part of the entity diff. */
  metadata?: Record<string, unknown>;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
};

/**
 * The storage shape produced by {@link toAuditRecord}: an {@link AuditEvent}
 * with sensitive values redacted and a `createdAt` derived from `timestamp`.
 * This is what a repository inserts (see `packages/database` §2.2).
 */
export type AuditRecord = Omit<AuditEvent, "timestamp"> & {
  createdAt: string;
};

/**
 * Sink for audit events. Implementations persist, forward or drop the events.
 *
 * The interface is asynchronous so a real sink (database, SIEM, webhook) can be
 * plugged in without changing consumers;
 * {@link NoopAuditPort} and {@link RecordingAuditPort} resolve immediately.
 *
 * Promotion rule (roadmap §1.6, recorded in the §5.5 ADR): a dedicated
 * `packages/audit` workspace is only created when one of these appears —
 * retention/export jobs, multiple sinks (DB + SIEM/webhook), or a query API.
 * Until then, this port plus the database repository is the design.
 */
export interface AuditPort {
  /** Persist a single event. */
  record(event: AuditEvent): Promise<void>;
  /** Persist several events in one call (e.g. a bulk mutation). */
  recordMany(events: AuditEvent[]): Promise<void>;
}

/**
 * Compute a shallow (top-level) diff between two plain entities, returning only
 * the fields whose values changed. Keys present on only one side are reported
 * with `undefined` on the missing side.
 *
 * Field values are compared structurally (deep equality for arrays and plain
 * objects), so two independently-created but equal values — e.g. arrays and
 * JSON objects returned by a fresh `SELECT` — are not reported as changes. This
 * keeps the diff free of spurious entries on no-op writes.
 *
 * Non-objects and `null` are treated as empty entities.
 */
export const computeAuditDiff = (
  before: unknown,
  after: unknown,
): AuditChanges => {
  const beforeObj = asPlainObject(before);
  const afterObj = asPlainObject(after);

  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changes: AuditChanges = {};

  for (const key of keys) {
    const previous = beforeObj[key];
    const next = afterObj[key];

    if (!isDeepEqual(previous, next)) {
      changes[key] = { before: previous, after: next };
    }
  }

  return changes;
};

/**
 * Turn an {@link AuditEvent} into its storage shape, redacting sensitive values
 * from both `changes` and `metadata` using the shared rules from §1.4
 * (case-insensitive, recursive). This is the single place where redaction is
 * applied to audit data, so a sensitive key can never reach the store.
 */
export const toAuditRecord = (event: AuditEvent): AuditRecord => {
  const { timestamp, changes, metadata, ...rest } = event;

  return {
    ...rest,
    ...(changes === undefined
      ? {}
      : { changes: redact<AuditChanges>(changes) }),
    ...(metadata === undefined
      ? {}
      : { metadata: redact<Record<string, unknown>>(metadata) }),
    createdAt: timestamp,
  };
};

/** Default no-op port, used until a real sink is wired. */
export class NoopAuditPort implements AuditPort {
  async record(_event: AuditEvent): Promise<void> {}

  async recordMany(_events: AuditEvent[]): Promise<void> {}
}

/**
 * Test double that records every event in memory, so consumers can assert what
 * was emitted without a database. Injectable anywhere an {@link AuditPort} is
 * expected.
 */
export class RecordingAuditPort implements AuditPort {
  /** Events recorded so far, in emission order. */
  public readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async recordMany(events: AuditEvent[]): Promise<void> {
    this.events.push(...events);
  }

  /** Drop all recorded events. */
  clear(): void {
    this.events.length = 0;
  }
}

/** Narrow an unknown value to a string-keyed record, treating the rest as `{}`. */
const asPlainObject = (value: unknown): Record<string, unknown> =>
  isPlainObject(value) ? value : {};

/**
 * Structural equality for JSON-like values: scalars by `Object.is`, arrays
 * element-wise and plain objects key-wise. `Date` and other non-plain objects
 * fall back to `Object.is` (reference equality).
 */
const isDeepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => isDeepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => key in b && isDeepEqual(a[key], b[key]))
    );
  }
  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
