import { describe, expect, test } from "bun:test";
import { TenantContextError } from "@opensaas/core";
import { runInTenantContext, withTransaction } from "../client";

/**
 * §2.5.2 — a tenant-scoped operation without an organization is a programming
 * error. It must throw a typed `TenantContextError` before any SQL runs, never
 * fall back to an unscoped (permissive) query.
 *
 * These are pure guards: they reject before opening a connection, so no
 * database is required.
 */
describe("@opensaas/database - tenant context guards (§2.5.2)", () => {
  test("withTransaction rejects a missing organizationId with a typed error", async () => {
    await expect(
      withTransaction({
        // @ts-expect-error - organizationId is required at the type level.
        organizationId: undefined,
        callback: async () => "unreachable",
      }),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  test("withTransaction rejects a blank organizationId", async () => {
    await expect(
      withTransaction({
        organizationId: "   ",
        callback: async () => "unreachable",
      }),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  test("runInTenantContext rejects a missing organizationId", async () => {
    await expect(
      runInTenantContext({
        organizationId: "",
        run: async () => "unreachable",
      }),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  test("the tenant error carries a stable code and field", async () => {
    try {
      await runInTenantContext({
        organizationId: "",
        run: async () => "unreachable",
      });
      throw new Error("expected runInTenantContext to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(TenantContextError);
      const tenantError = error as TenantContextError;
      expect(tenantError.code).toBe("TENANT_CONTEXT_REQUIRED");
      expect(tenantError.details?.field).toBe("organizationId");
    }
  });
});
