import { createStrategyRegistry } from "./registration/registry-factory";
import type { RegistrationContext } from "./registration/types";

/**
 * @deprecated Behavioral shim for the pre-§3.3 switch. It delegates to the
 * default strategy registry (deny-by-default ports) so callers migrate to the
 * registry incrementally; the register route moves onto the registry in §3.2.
 * Prefer `createStrategyRegistry` + `strategy.validate(context)` directly.
 */
export type LegacyRegistrationContext = RegistrationContext & {
  hasPaid?: boolean;
};

/**
 * @deprecated Delegates to the default registry. Invite/payment modes are
 * deny-by-default, so callers that used to pass a client-trusted `hasPaid`
 * flag or any non-empty invite code will now be refused — this is the intended
 * §3.2 hardening.
 */
export async function validateRegistrationAccess(
  context: LegacyRegistrationContext,
): Promise<{ status: "active" | "waitlist" }> {
  const registry = createStrategyRegistry();
  const strategy = registry.require(context.mode);
  const outcome = await strategy.validate(context);
  return { status: outcome.status };
}
