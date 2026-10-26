import { apiErrorResponseSchema } from "@opensaas/core";

/**
 * The documented failures of the API (§4.10).
 *
 * Every endpoint answers with the same error envelope (`{ success: false,
 * error }`), so the failure responses are declared once here and reused by
 * the route definitions. The generated OpenAPI document therefore describes
 * the failures the API actually produces.
 */

/** The caller is not authenticated (401). */
export const unauthorizedResponse = {
  description: "Authentication required to access this resource",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The caller is authenticated but not allowed (403). */
export const forbiddenResponse = {
  description: "The current role is not allowed to perform this operation",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The resource does not exist, or belongs to another tenant (404). */
export const notFoundResponse = {
  description: "The resource does not exist",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The payload does not match the schema (422). */
export const validationResponse = {
  description: "The request payload is invalid",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The request conflicts with the current state (409). */
export const conflictResponse = {
  description: "The request conflicts with the current state",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The write rate limit is exhausted (429). */
export const rateLimitResponse = {
  description: "Too many write requests",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** The payload is larger than the configured limit (413). */
export const payloadTooLargeResponse = {
  description: "The request payload is too large",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};

/** An unexpected failure (500). */
export const internalErrorResponse = {
  description: "An unexpected error occurred",
  content: { "application/json": { schema: apiErrorResponseSchema } },
};
