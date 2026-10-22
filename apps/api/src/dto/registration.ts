import { z } from "zod";

/**
 * Request schema for registration.
 *
 * Deliberately has **no** payment field: a client can never assert that it has
 * paid (§3.2). Payment, when required, is verified server-side through the
 * `PaymentVerificationPort`.
 */
export const registerRequestSchema = z.object({
  // Trim first, then validate the email format (Zod 4: `z.email()` checks
  // before a chained `.trim()`, so pipe the trimmed string into it).
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(8),
  name: z.string().min(1),
  inviteCode: z.string().optional(),
});

/** A registration request, parsed. */
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * Zod schema of the result of a registration, as the API returns it.
 *
 * The schema is the single source of the wire format: the TypeScript type is
 * inferred from it, and the generated OpenAPI document describes the same
 * shape, so the three cannot drift (§4.10).
 */
export const registrationDtoSchema = z.object({
  email: z.string(),
  status: z.enum(["active", "waitlist"]),
  message: z.string(),
});

/** The result of a registration, as the API returns it. */
export type RegistrationDto = z.infer<typeof registrationDtoSchema>;
