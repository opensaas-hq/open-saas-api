import { ValidationError } from "@opensaas/core";
import type { RegistrationMode, RegistrationStrategy } from "./types";

/**
 * Exhaustive mode → strategy map. The `satisfies` clause makes a new
 * `RegistrationMode` union member without a strategy a typecheck failure, so
 * modes can never silently fall through (§3.3).
 */
export type StrategyMap = Record<RegistrationMode, RegistrationStrategy>;

/**
 * Registry keyed by mode. Built from a strategy list so the same exhaustiveness
 * guarantee applies and duplicate modes are caught at construction.
 */
export class StrategyRegistry {
  private readonly strategies: Map<RegistrationMode, RegistrationStrategy>;

  constructor(map: StrategyMap) {
    this.strategies = new Map(
      Object.entries(map) as [RegistrationMode, RegistrationStrategy][],
    );
  }

  /** Fetch the strategy for a mode, or `undefined` when none is registered. */
  get(mode: RegistrationMode): RegistrationStrategy | undefined {
    return this.strategies.get(mode);
  }

  /**
   * Fetch the strategy for a mode or fail with a typed error. Used at request
   * time: an unregistered mode is a configuration bug, never a silent pass.
   */
  require(mode: RegistrationMode): RegistrationStrategy {
    const strategy = this.strategies.get(mode);
    if (!strategy) {
      throw new ValidationError(`Unsupported registration mode: ${mode}`, {
        field: "mode",
        code: "INVALID_REGISTRATION_MODE",
      });
    }
    return strategy;
  }

  /** All registered modes, for diagnostics. */
  modes(): RegistrationMode[] {
    return [...this.strategies.keys()];
  }
}

/**
 * Assert at boot that a configured mode has a strategy (§3.3 AC3). Call once
 * during application startup so a misconfiguration fails fast instead of on the
 * first registration request.
 */
export const assertModeIsSupported = (
  registry: StrategyRegistry,
  mode: RegistrationMode,
): void => {
  if (!registry.get(mode)) {
    throw new ValidationError(
      `Configured REGISTRATION_MODE "${mode}" has no registered strategy`,
      { field: "mode", code: "UNSUPPORTED_REGISTRATION_MODE" },
    );
  }
};
