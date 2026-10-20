import { z } from "zod";
import { AppError, ValidationError } from "./errors";

/**
 * Pagination metadata attached to list responses. Only present on endpoints
 * that return collections.
 */
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * Success branch of the response envelope: `success: true` discriminates it
 * from {@link ApiErrorResponse}. `pagination` is present only for collections.
 */
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  pagination?: PaginationMeta;
};

/**
 * Error branch of the response envelope: `success: false` discriminates it
 * from {@link ApiSuccessResponse}. `details` carries field-level information
 * (e.g. validation) and must never leak internals on 500-class errors.
 */
export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/**
 * The `{ success, data | error }` contract every endpoint returns. Produced by
 * {@link ok} / {@link fail}; consumed as the response type by handlers.
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Build a success envelope. This module is the single place that constructs
 * the `{ success, data | error }` shape — handlers return `ok(...)` and let
 * `app.onError` be the one serializer for failures. The result satisfies
 * {@link ApiResponse}.
 */
export const ok = <T>(
  data: T,
  pagination?: PaginationMeta,
): ApiSuccessResponse<T> =>
  pagination ? { success: true, data, pagination } : { success: true, data };

/**
 * Build an error envelope from a typed `AppError` (deriving code, message and
 * details) or from explicit values. The HTTP status is not part of the body;
 * use `statusFromError` for that.
 */
export function fail(error: AppError): ApiErrorResponse;
export function fail(
  code: string,
  message?: string,
  details?: unknown,
): ApiErrorResponse;
export function fail(
  codeOrError: string | AppError,
  message?: string,
  details?: unknown,
): ApiErrorResponse {
  if (codeOrError instanceof AppError) {
    return {
      success: false,
      error: {
        code: codeOrError.code,
        message: codeOrError.message,
        details: codeOrError.details,
      },
    };
  }

  return {
    success: false,
    error: {
      code: codeOrError,
      message: message ?? "",
      // Only attach details when present, so unknown errors never carry a
      // (possibly sensitive) details key.
      ...(details === undefined ? {} : { details }),
    },
  };
}

/**
 * Convert a raw Zod validation error into a `ValidationError` (422) carrying
 * field-level details, so validation failures never surface as a 500. Typed
 * against Zod's core error so it accepts errors from both `safeParse` and
 * middleware like `@hono/zod-validator`. Uses Zod's flattened view, so
 * `details.fieldErrors` maps each field name to its messages.
 */
export const fromZodError = (
  error: z.core.$ZodError,
  message = "Validation failed",
): ValidationError =>
  new ValidationError(
    message,
    z.flattenError(error) as unknown as Record<string, unknown>,
  );

/**
 * Map an error to its HTTP status code: the `AppError` status when available,
 * otherwise 500. Keeps the status decision in one place for `app.onError`.
 */
export const statusFromError = (error: unknown): number =>
  error instanceof AppError ? error.statusCode : 500;
