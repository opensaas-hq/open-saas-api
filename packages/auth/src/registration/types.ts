import type { Env } from "@opensaas/core";
import type { Transaction } from "@opensaas/database";

/** Canonical registration modes, shared with the config schema. */
export type RegistrationMode = Env["REGISTRATION_MODE"];

/**
 * Outcome of a successful registration strategy validation. `status` is the
 * account/waitlist state the strategy grants.
 */
export type RegistrationStatus = "active" | "waitlist";

/**
 * Everything a strategy needs to verify its constraint. Values here are
 * consumed server-side only; none of them is trusted merely because a client
 * sent it (§3.2).
 */
export type RegistrationContext = {
  mode: RegistrationMode;
  email: string;
  /** Organization the new user is registering into, when known. */
  organizationId?: string;
  /** Invite code supplied by the client, validated against the database. */
  inviteCode?: string;
};

/**
 * The verdict a strategy returns. A strategy either *permits* registration
 * (optionally assigning the waitlist status) or throws a typed domain error.
 * `onCommit` carries side effects that must run inside the registration
 * transaction (e.g. consuming an invite code once).
 */
export type RegistrationOutcome = {
  status: RegistrationStatus;
  /**
   * Side effect to run inside the registration transaction after the user
   * exists. Receives the new user id. Optional: modes without persistence
   * side effects (e.g. `public`) leave it undefined.
   */
  onCommit?: (userId: string, tx: Transaction) => Promise<void>;
};

/**
 * A registration strategy: one behavior per mode. Strategies are stateless and
 * registered by {@link StrategyRegistry}.
 */
export interface RegistrationStrategy {
  readonly mode: RegistrationMode;
  validate(context: RegistrationContext): Promise<RegistrationOutcome>;
}
