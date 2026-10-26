import {
  type StrategyRegistry,
  createDatabaseInviteCodeValidator,
  createStrategyRegistry,
  registerUser,
} from "@opensaas/auth";
import { type AuditPort, type Env, computeAuditDiff } from "@opensaas/core";
import type { Database } from "@opensaas/database";
import type { RegisterRequest, RegistrationDto } from "../dto/registration";

/**
 * Strategies are stateless, so one registry per process is enough. Invite codes
 * are validated against the database; payment verification stays
 * deny-by-default until a provider is integrated (§3.2).
 */
const registrationRegistry: StrategyRegistry = createStrategyRegistry({
  inviteCodes: createDatabaseInviteCodeValidator(),
});

/** The registration service: the owner of the registration flow (§4.4). */
export type RegistrationService = {
  /**
   * Register a user.
   *
   * The flow itself (anti-abuse policy, server-side strategy validation and
   * the transactional persistence of user, account, organization, owner
   * membership and waitlist row) belongs to `@opensaas/auth` (§3.1). The
   * service adds what belongs to the HTTP layer: the DTO mapping and the
   * audit event.
   */
  register: (input: RegisterRequest) => Promise<RegistrationDto>;
};

/** Dependencies of {@link createRegistrationService}. */
export type RegistrationServiceDeps = {
  /** Validated configuration: it carries the registration mode. */
  env: Env;
  /** Sink for the audit events of the mutations. */
  audit: AuditPort;
  /**
   * Handle the registration transaction runs on. Defaults to the
   * process-global proxy; the app factory injects its own handle (TD-23).
   */
  db?: Database;
};

/**
 * Build the registration service.
 */
export const createRegistrationService = (
  deps: RegistrationServiceDeps,
): RegistrationService => {
  const register: RegistrationService["register"] = async (input) => {
    const result = await registerUser(
      {
        email: input.email,
        password: input.password,
        name: input.name,
        inviteCode: input.inviteCode,
      },
      { env: deps.env, registry: registrationRegistry, db: deps.db },
    );

    // The audit event is emitted once the flow has committed: the
    // registration transaction belongs to the auth package, and an audit row
    // for an organization that was never created would violate the tenant
    // scope of the audit table.
    await deps.audit.record({
      action: "registration.completed",
      entityType: "user",
      entityId: result.userId,
      actorId: result.userId,
      organizationId: result.organizationId,
      changes: computeAuditDiff({}, { status: result.status }),
      timestamp: new Date().toISOString(),
    });

    return {
      email: result.email,
      status: result.status,
      message:
        result.status === "waitlist"
          ? "Registration received. You have been added to the waitlist."
          : "Registration successful.",
    };
  };

  return { register };
};
