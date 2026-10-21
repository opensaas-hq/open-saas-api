export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_SERVER_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message = "Resource not found",
    details?: Record<string, unknown>,
  ) {
    super(message, 404, "NOT_FOUND", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Unauthorized access",
    details?: Record<string, unknown>,
  ) {
    super(message, 401, "UNAUTHORIZED", details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: Record<string, unknown>) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Validation failed",
    details?: Record<string, unknown>,
  ) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: Record<string, unknown>) {
    super(message, 403, "FORBIDDEN", details);
    this.name = "ForbiddenError";
  }
}

/**
 * 409 — the request conflicts with the current state of the resource, e.g.
 * registering an email that already exists. A distinct status from 422 lets
 * clients tell "invalid input" apart from "you cannot do that yet". The `code`
 * defaults to the generic `CONFLICT` but can be narrowed to a stable,
 * domain-specific value (e.g. `EMAIL_ALREADY_REGISTERED`).
 */
export class ConflictError extends AppError {
  constructor(
    message = "Conflict",
    details?: Record<string, unknown>,
    code = "CONFLICT",
  ) {
    super(message, 409, code, details);
    this.name = "ConflictError";
  }
}

/**
 * 503 — the service is temporarily unable to handle the request, e.g. a
 * dependency is down or a circuit breaker is open. Callers may retry later.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "Service temporarily unavailable",
    details?: Record<string, unknown>,
  ) {
    super(message, 503, "SERVICE_UNAVAILABLE", details);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * 500 — a tenant-scoped operation was attempted without tenant context. This
 * is a programming error, not a user error: the caller must supply an
 * `organizationId` so the row-level-security GUC is set. It never resolves to
 * an unscoped (permissive) query.
 */
export class TenantContextError extends AppError {
  constructor(
    message = "A tenant-scoped operation requires an organization context",
    details?: Record<string, unknown>,
  ) {
    super(message, 500, "TENANT_CONTEXT_REQUIRED", details);
    this.name = "TenantContextError";
  }
}

// Response envelope types live in ./response; re-exported here for convenience
// so existing `import { ApiResponse } from "@opensaas/core"` keeps working.
export type {
  ApiErrorResponse,
  ApiResponse,
  ApiSuccessResponse,
  PaginationMeta,
} from "./response";
