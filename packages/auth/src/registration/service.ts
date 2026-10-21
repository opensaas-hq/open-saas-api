import { ConflictError, type Env, ValidationError } from "@opensaas/core";
import { createWaitlistEntry, withRawTransaction } from "@opensaas/database";
import { createAuth } from "../auth";
import {
  getDisposableDomains,
  validateAndNormalizeEmail,
} from "../email-policy";
import type { EmailSender } from "../ports/email";
import type { StrategyRegistry } from "./registry";
import type { RegistrationStatus } from "./types";

/** Input accepted by {@link registerUser}. No payment flag is ever trusted. */
export type RegisterUserInput = {
  email: string;
  password: string;
  name: string;
  inviteCode?: string;
  /** Display name for the organization created for the new owner. */
  organizationName?: string;
  /** Optional explicit slug; a unique value is derived when omitted. */
  organizationSlug?: string;
};

/** Dependencies for {@link registerUser}, injected so it stays testable. */
export type RegisterUserDependencies = {
  env: Env;
  registry: StrategyRegistry;
  /**
   * Outbound email port forwarded to Better Auth so the sign-up verification
   * email goes through the same injectable sender (§3.4). Optional; defaults to
   * the non-delivering sender.
   */
  emailSender?: EmailSender;
};

/** Result of a successful registration. */
export type RegisterUserResult = {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  email: string;
  status: RegistrationStatus;
};

/**
 * Derive a URL-safe organization slug from the email local part, suffixed with
 * a short random token so concurrent registrations never collide on the unique
 * slug index.
 */
const deriveSlug = (email: string): string => {
  const local = email.split("@")[0] ?? "org";
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const token = Math.random().toString(36).slice(2, 8);
  return `${base || "org"}-${token}`;
};

/** Better Auth surfaces a duplicate email with this stable code. */
const isDuplicateEmailError = (error: unknown): boolean => {
  const body = (error as { body?: { code?: string } })?.body;
  const message = (error as { message?: string })?.message ?? "";
  return (
    body?.code === "USER_ALREADY_EXISTS" || /already exists/i.test(message)
  );
};

/**
 * Register a user, persisting every row in a single transaction (§3.1).
 *
 * Steps, all inside one `withRawTransaction` so a mid-flow failure leaves
 * **zero** partial rows:
 *   1. normalize + validate the email (anti-abuse policy);
 *   2. resolve the mode's strategy and validate server-side (invite/payment);
 *   3. create the `user` + `account` (hashed password) through Better Auth;
 *   4. create the `organization` and its `owner` membership for the user;
 *   5. run the strategy's `onCommit` (e.g. consume the invite code once);
 *   6. persist a waitlist row when the mode grants the waitlist status.
 *
 * The plaintext password is never stored, returned or logged — Better Auth
 * hashes it. A duplicate email raises a typed 409, never a 500.
 */
export async function registerUser(
  input: RegisterUserInput,
  dependencies: RegisterUserDependencies,
): Promise<RegisterUserResult> {
  const { env, registry, emailSender } = dependencies;

  const email = validateAndNormalizeEmail(
    input.email,
    // The blocklist comes from the injected configuration, not from the
    // process-wide env, so the flow honours the config it was given (§4.7).
    getDisposableDomains(env.DISPOSABLE_EMAIL_DOMAINS),
  );
  const mode = env.REGISTRATION_MODE;
  const strategy = registry.require(mode);

  // Strategy validation runs first: an invite/payment refusal must not create
  // any rows. The invite pre-check is read-only; consumption is deferred to
  // `onCommit` so it shares the transaction below.
  const outcome = await strategy.validate({
    mode,
    email,
    inviteCode: input.inviteCode,
  });

  const organizationName = input.organizationName ?? `${email} workspace`;
  const organizationSlug = input.organizationSlug ?? deriveSlug(email);

  return await withRawTransaction(async (tx) => {
    // Bind Better Auth to the transaction so its user/account inserts roll back
    // together with our organization/member/waitlist rows.
    const txAuth = createAuth(env, tx, { emailSender });

    let userId: string;
    try {
      const signUp = await txAuth.api.signUpEmail({
        body: { email, password: input.password, name: input.name },
      });
      userId = signUp.user.id;
    } catch (error: unknown) {
      if (isDuplicateEmailError(error)) {
        throw new ConflictError(
          "An account with this email already exists",
          { field: "email" },
          "EMAIL_ALREADY_REGISTERED",
        );
      }
      throw error;
    }

    const organization = await txAuth.api.createOrganization({
      body: {
        name: organizationName,
        slug: organizationSlug,
        userId,
      },
    });

    if (!organization) {
      throw new ValidationError("Organization could not be created", {
        code: "ORGANIZATION_CREATION_FAILED",
      });
    }

    if (outcome.onCommit) {
      await outcome.onCommit(userId, tx);
    }

    if (outcome.status === "waitlist") {
      await createWaitlistEntry({ email, userId, tx });
    }

    return {
      userId,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      email,
      status: outcome.status,
    };
  });
}
