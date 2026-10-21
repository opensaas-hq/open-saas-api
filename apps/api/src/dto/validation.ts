import { fail, fromZodError, statusFromError } from "@opensaas/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** The shape of a validation result, as `zValidator` hands it to a hook. */
type ValidationResult = {
  success: boolean;
  error?: z.core.$ZodError;
  data?: unknown;
};

/**
 * Build the hook that turns a failed validation into the JSON error envelope.
 *
 * The status comes from the typed error, so an invalid payload is always a
 * 422 — never a 400 and never a 500 — and the response body is the same
 * envelope every other error uses (§1.3).
 */
export const validationHook =
  (message: string) =>
  (result: ValidationResult, c: Context): Response | undefined => {
    if (result.success || !result.error) return undefined;

    const error = fromZodError(result.error, message);
    return c.json(fail(error), statusFromError(error) as ContentfulStatusCode);
  };
