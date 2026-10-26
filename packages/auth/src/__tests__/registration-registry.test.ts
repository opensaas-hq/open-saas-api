import { describe, expect, test } from "bun:test";
import { ValidationError } from "@opensaas/core";
import { REGISTRATION_MODES } from "@opensaas/core";
import { createStrategyRegistry } from "../registration/registry-factory";

describe("@opensaas/auth - Strategy registry (§3.3)", () => {
  test("registers exactly one strategy per canonical mode", () => {
    const registry = createStrategyRegistry();
    expect(registry.modes().sort()).toEqual([...REGISTRATION_MODES].sort());
  });

  test("require() throws a typed error for an unregistered mode", () => {
    const registry = createStrategyRegistry();
    expect(() =>
      registry.require("bogus" as (typeof REGISTRATION_MODES)[number]),
    ).toThrow(ValidationError);
  });

  test("public mode grants an active account", async () => {
    const registry = createStrategyRegistry();
    const outcome = await registry
      .require("public")
      .validate({ mode: "public", email: "user@example.com" });
    expect(outcome.status).toBe("active");
  });

  test("waiting_list mode assigns the waitlist status", async () => {
    const registry = createStrategyRegistry();
    const outcome = await registry
      .require("waiting_list")
      .validate({ mode: "waiting_list", email: "user@example.com" });
    expect(outcome.status).toBe("waitlist");
  });

  test("each mode's strategy reports its own mode", () => {
    const registry = createStrategyRegistry();
    for (const mode of REGISTRATION_MODES) {
      expect(registry.require(mode).mode).toBe(mode);
    }
  });
});
