import { describe, expect, test } from "bun:test";
import { createMembershipService } from "../services/membership.service";

/**
 * The membership cache (§4.3).
 *
 * The cache is the reason the tenant middleware does not read the `member`
 * table on every request. These tests pin the three properties the service
 * promises: the TTL bounds the staleness, a write invalidates the entry, and
 * an unknown or missing membership is never cached as a valid role.
 */
describe("Apps/API - Membership service cache (§4.3)", () => {
  test("a second lookup inside the TTL is served from the cache", async () => {
    let calls = 0;
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => {
        calls += 1;
        return "member";
      },
    });

    expect(await service.getRole({ userId: "u1", organizationId: "o1" })).toBe(
      "member",
    );
    expect(await service.getRole({ userId: "u1", organizationId: "o1" })).toBe(
      "member",
    );

    expect(calls).toBe(1);
  });

  test("the cached entry expires after the TTL", async () => {
    let calls = 0;
    let clock = 1_000;
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => clock,
      lookup: async () => {
        calls += 1;
        return "member";
      },
    });

    await service.getRole({ userId: "u1", organizationId: "o1" });

    clock += 29_000;
    await service.getRole({ userId: "u1", organizationId: "o1" });
    expect(calls).toBe(1);

    clock += 2_000;
    await service.getRole({ userId: "u1", organizationId: "o1" });
    expect(calls).toBe(2);
  });

  test("a role change invalidates the cached entry", async () => {
    let role = "member";
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => role,
      update: async ({ role: newRole }) => {
        role = newRole;
      },
    });

    expect(await service.getRole({ userId: "u1", organizationId: "o1" })).toBe(
      "member",
    );

    await service.setRole({
      userId: "u1",
      organizationId: "o1",
      role: "admin",
    });

    expect(await service.getRole({ userId: "u1", organizationId: "o1" })).toBe(
      "admin",
    );
  });

  test("an explicit invalidation forces the next lookup to read again", async () => {
    let calls = 0;
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => {
        calls += 1;
        return "member";
      },
    });

    await service.getRole({ userId: "u1", organizationId: "o1" });
    service.invalidate({ userId: "u1", organizationId: "o1" });
    await service.getRole({ userId: "u1", organizationId: "o1" });

    expect(calls).toBe(2);
  });

  test("a membership removal invalidates the cached entry", async () => {
    let member: string | undefined = "member";
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => member,
    });

    expect(await service.getRole({ userId: "u1", organizationId: "o1" })).toBe(
      "member",
    );

    member = undefined;
    await service.removeMembership({ userId: "u1", organizationId: "o1" });

    expect(
      await service.getRole({ userId: "u1", organizationId: "o1" }),
    ).toBeUndefined();
  });

  test("a missing membership is reported as such and not cached", async () => {
    let calls = 0;
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => {
        calls += 1;
        return undefined;
      },
    });

    expect(
      await service.getRole({ userId: "u1", organizationId: "o1" }),
    ).toBeUndefined();
    expect(
      await service.getRole({ userId: "u1", organizationId: "o1" }),
    ).toBeUndefined();

    expect(calls).toBe(2);
  });

  test("an unknown role is denied instead of being passed through", async () => {
    const service = createMembershipService({
      ttlSeconds: 30,
      now: () => 1_000,
      lookup: async () => "superuser",
    });

    expect(
      await service.getRole({ userId: "u1", organizationId: "o1" }),
    ).toBeUndefined();
  });

  test("a TTL of zero reads the membership on every request", async () => {
    let calls = 0;
    const service = createMembershipService({
      ttlSeconds: 0,
      now: () => 1_000,
      lookup: async () => {
        calls += 1;
        return "owner";
      },
    });

    await service.getRole({ userId: "u1", organizationId: "o1" });
    await service.getRole({ userId: "u1", organizationId: "o1" });

    expect(calls).toBe(2);
  });
});
