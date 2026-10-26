import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type AuditEvent,
  type AuditPort,
  NoopAuditPort,
  RecordingAuditPort,
  computeAuditDiff,
  toAuditRecord,
} from "../audit";
import { REDACTED } from "../redact";

const baseEvent: AuditEvent = {
  action: "contact.updated",
  entityType: "contact",
  entityId: "contact-1",
  actorId: "user-1",
  organizationId: "org-1",
  timestamp: "2026-10-20T10:00:00.000Z",
};

describe("@opensaas/core - Audit", () => {
  describe("computeAuditDiff", () => {
    test("reports added, removed and updated fields only", () => {
      const changes = computeAuditDiff(
        { name: "Ada", status: "active", phone: "111" },
        { name: "Ada Lovelace", status: "active", email: "a@b.co" },
      );

      expect(changes).toEqual({
        name: { before: "Ada", after: "Ada Lovelace" },
        phone: { before: "111", after: undefined },
        email: { before: undefined, after: "a@b.co" },
      });
      // Unchanged fields never appear.
      expect(changes).not.toHaveProperty("status");
    });

    test("returns an empty diff when nothing changed", () => {
      expect(computeAuditDiff({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual({});
    });

    test("treats null and undefined as distinct for a present key", () => {
      const changes = computeAuditDiff({ phone: null }, { phone: undefined });

      expect(changes).toEqual({ phone: { before: null, after: undefined } });
    });

    test("handles non-object inputs as empty entities", () => {
      expect(computeAuditDiff(null, { a: 1 })).toEqual({
        a: { before: undefined, after: 1 },
      });
      expect(computeAuditDiff("nope", undefined)).toEqual({});
    });

    test("compares nested values structurally, not by reference", () => {
      const nested = { x: 1 };
      expect(computeAuditDiff({ cfg: nested }, { cfg: nested })).toEqual({});
      // Independently-created but equal values are not a change.
      expect(computeAuditDiff({ cfg: { x: 1 } }, { cfg: { x: 1 } })).toEqual(
        {},
      );
      expect(computeAuditDiff({ tags: [1, 2] }, { tags: [1, 2] })).toEqual({});
      // A real structural change is still reported.
      expect(computeAuditDiff({ tags: [1, 2] }, { tags: [1, 3] })).toEqual({
        tags: { before: [1, 2], after: [1, 3] },
      });
    });
  });

  describe("toAuditRecord", () => {
    test("derives createdAt from timestamp and drops timestamp", () => {
      const record = toAuditRecord(baseEvent);

      expect(record.createdAt).toBe(baseEvent.timestamp);
      expect(record).not.toHaveProperty("timestamp");
      expect(record.action).toBe("contact.updated");
    });

    test("redacts sensitive keys in changes, case-insensitively and nested", () => {
      const record = toAuditRecord({
        ...baseEvent,
        changes: {
          email: { before: "old@x.co", after: "new@x.co" },
          password: { before: "hunter2", after: "hunter3" },
          Authorization: { before: "Bearer a", after: "Bearer b" },
        },
      });

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("hunter2");
      expect(serialized).not.toContain("hunter3");
      expect(serialized).not.toContain("Bearer a");
      expect(serialized).not.toContain("Bearer b");
      expect(serialized).toContain("new@x.co");
    });

    test("redacts sensitive keys in metadata", () => {
      const record = toAuditRecord({
        ...baseEvent,
        metadata: { token: "jwt-secret", note: "visible" },
      });

      expect(record.metadata).toEqual({ token: REDACTED, note: "visible" });
    });

    test("redacts sensitive keys nested inside before/after values", () => {
      const record = toAuditRecord({
        ...baseEvent,
        changes: {
          auth: {
            before: { headers: { authorization: "Bearer old" } },
            after: { headers: { authorization: "Bearer new" } },
          },
        },
      });

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("Bearer old");
      expect(serialized).not.toContain("Bearer new");
      expect(serialized).toContain(REDACTED);
    });

    test("redacts sensitive keys nested behind arrays in metadata", () => {
      const record = toAuditRecord({
        ...baseEvent,
        metadata: {
          attempts: [{ token: "leak-1" }, { token: "leak-2" }],
          safe: "keep",
        },
      });

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("leak-1");
      expect(serialized).not.toContain("leak-2");
      expect(serialized).toContain("keep");
    });

    test("omits changes and metadata when not provided", () => {
      const record = toAuditRecord(baseEvent);

      expect(record).not.toHaveProperty("changes");
      expect(record).not.toHaveProperty("metadata");
    });
  });

  describe("NoopAuditPort", () => {
    test("record and recordMany resolve without throwing", async () => {
      const port = new NoopAuditPort();

      await expect(port.record(baseEvent)).resolves.toBeUndefined();
      await expect(port.recordMany([baseEvent])).resolves.toBeUndefined();
    });
  });

  describe("RecordingAuditPort", () => {
    test("records events in emission order and supports clear", async () => {
      const port = new RecordingAuditPort();

      await port.record(baseEvent);
      await port.recordMany([
        { ...baseEvent, entityId: "c-2" },
        { ...baseEvent, entityId: "c-3" },
      ]);

      expect(port.events.map((e) => e.entityId)).toEqual([
        "contact-1",
        "c-2",
        "c-3",
      ]);

      port.clear();
      expect(port.events).toHaveLength(0);
    });

    test("a consumer can inject the fake and assert emitted events (no DB)", async () => {
      const port: AuditPort = new RecordingAuditPort();

      const emit = async (entityId: string) => {
        await port.record({ ...baseEvent, entityId });
      };

      await emit("c-9");

      const fake = port as RecordingAuditPort;
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0]?.entityId).toBe("c-9");
      expect(fake.events[0]?.organizationId).toBe("org-1");
    });
  });

  // Acceptance criterion: core stays a leaf. Enforced by reading the source,
  // not by review, so a regression fails the suite.
  describe("dependency rule", () => {
    test("core sources import no other workspace package", async () => {
      const srcDir = join(import.meta.dir, "..");
      const entries = await readdir(srcDir, { recursive: true });
      // Only production sources count; tests may mention workspace specifiers.
      const sources = entries.filter(
        (name) =>
          name.endsWith(".ts") && !name.split(/[\\/]/).includes("__tests__"),
      );

      expect(sources.length).toBeGreaterThan(0);
      expect(sources).toContain("index.ts");

      for (const name of sources) {
        const raw = await readFile(join(srcDir, name), "utf8");
        // Strip block and line comments so prose mentioning a workspace
        // package does not trip the check.
        const contents = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const specifiers = [
          ...contents.matchAll(/(?:from|import)\s+["']([^"']+)["']/g),
          ...contents.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
          ...contents.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
        ].map((match) => match[1]);

        const workspaceImports = specifiers.filter((specifier) =>
          specifier?.startsWith("@opensaas/"),
        );

        expect(workspaceImports).toEqual([]);
      }
    });
  });
});
