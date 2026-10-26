import { fail, fromZodError } from "@opensaas/core";
import type { Context } from "hono";
import type { z } from "zod";

/**
 * The shape of a validation result, as `zValidator` hands it to a hook.
 *
 * It deliberately does not mention the validated `data`: a hook that types it
 * would prevent the router from inferring the request types of the route
 * definition (§4.10).
 */
type ValidationResult = {
  success: boolean;
  error?: z.core.$ZodError;
};

/**
 * Build the hook that turns a failed validation into the JSON error envelope.
 *
 * The status is always 422: an invalid payload is a validation failure — never
 * a 400 and never a 500 — and the response body is the same envelope every
 * other error uses (§1.3).
 */
export const validationHook =
  (message: string) => (result: ValidationResult, c: Context) => {
    if (result.success || !result.error) return undefined;

    const error = fromZodError(result.error, message);
    return c.json(fail(error), 422);
  };
