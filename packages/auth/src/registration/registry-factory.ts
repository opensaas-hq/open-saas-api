import {
  type PaymentVerificationPort,
  denyAllPayments,
} from "../ports/payment";
import { type StrategyMap, StrategyRegistry } from "./registry";
import {
  type InviteCodeValidator,
  createInviteCodeStrategy,
  rejectAllInviteCodes,
} from "./strategies/invite-code";
import { createPaidRequiredStrategy } from "./strategies/paid-required";
import { publicStrategy } from "./strategies/public";
import { waitingListStrategy } from "./strategies/waiting-list";

/** Injectable dependencies for the registration strategies. */
export type RegistrationDependencies = {
  inviteCodes?: InviteCodeValidator;
  payments?: PaymentVerificationPort;
};

/**
 * Build the strategy registry. Both ports default to deny-by-default (§3.2), so
 * a registry built without overrides refuses `invite_code` and `paid_required`
 * registrations — strictly safer than the previous client-trusted behavior.
 */
export const createStrategyRegistry = (
  dependencies: RegistrationDependencies = {},
): StrategyRegistry => {
  const inviteCodes = dependencies.inviteCodes ?? rejectAllInviteCodes;
  const payments = dependencies.payments ?? denyAllPayments;

  const map = {
    public: publicStrategy,
    waiting_list: waitingListStrategy,
    invite_code: createInviteCodeStrategy(inviteCodes),
    paid_required: createPaidRequiredStrategy(payments),
  } satisfies StrategyMap;

  return new StrategyRegistry(map);
};
