import type { RegistrationOutcome, RegistrationStrategy } from "../types";

/**
 * `public` mode: registration is open, the account is active immediately.
 */
export const publicStrategy: RegistrationStrategy = {
  mode: "public",
  async validate(): Promise<RegistrationOutcome> {
    return { status: "active" };
  },
};
