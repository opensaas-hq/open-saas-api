import type { RegistrationStatus } from "@opensaas/auth";
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

/** The result of a registration, as the API returns it. */
export type RegistrationDto = {
  email: string;
  status: RegistrationStatus;
  message: string;
};
