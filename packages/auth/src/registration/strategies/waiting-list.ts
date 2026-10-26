import type { RegistrationOutcome, RegistrationStrategy } from "../types";

/**
 * `waiting_list` mode: the account is created but placed on the waitlist.
 *
 * The strategy only *decides* the status; the actual persisted waitlist row is
 * written by the registration flow (§3.1) so it lands in the same transaction
 * as the user.
 */
export const waitingListStrategy: RegistrationStrategy = {
  mode: "waiting_list",
  async validate(): Promise<RegistrationOutcome> {
    return { status: "waitlist" };
  },
};
