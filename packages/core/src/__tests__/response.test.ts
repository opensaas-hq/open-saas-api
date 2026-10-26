import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
import {
  type ApiResponse,
  type PaginationMeta,
  fail,
  fromZodError,
  ok,
  statusFromError,
} from "../response";

describe("@opensaas/core - Response envelope", () => {
  describe("typed as ApiResponse", () => {
    test("ok(...) and fail(...) results are assignable to ApiResponse", () => {
      const success: ApiResponse<{ id: string }> = ok({ id: "1" });
      const error: ApiResponse<never> = fail("NOT_FOUND", "missing");

      expect(success.success).toBe(true);
      expect(error.success).toBe(false);
    });
  });

  describe("ok", () => {
    test("wraps data in a success envelope", () => {
      expect(ok({ id: "1" })).toEqual({ success: true, data: { id: "1" } });
    });

    test("includes pagination only when provided", () => {
      const pagination: PaginationMeta = {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      };

      expect(ok([], pagination)).toEqual({
        success: true,
        data: [],
        pagination,
      });
      expect(ok([])).not.toHaveProperty("pagination");
    });
  });

  describe("fail", () => {
    test("builds an envelope from explicit values", () => {
      expect(fail("BAD_REQUEST", "nope", { field: "x" })).toEqual({
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "nope",
          details: { field: "x" },
        },
      });
    });

    test("derives code, message and details from an AppError", () => {
      const error = new ValidationError("bad input", { email: ["invalid"] });

      expect(fail(error)).toEqual({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "bad input",
          details: { email: ["invalid"] },
        },
      });
    });
  });

  describe("fromZodError", () => {
    test("maps a ZodError to a 422 ValidationError with field details", () => {
      const schema = z.object({ email: z.email() });
      const result = schema.safeParse({ email: "not-an-email" });
      if (result.success) throw new Error("expected validation to fail");

      const error = fromZodError(result.error);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe("VALIDATION_ERROR");
      const details = error.details as { fieldErrors: Record<string, unknown> };
      expect(details.fieldErrors).toHaveProperty("email");
    });

    test("uses the provided message and exposes flattened fieldErrors", () => {
      const schema = z.object({
        email: z.email(),
        age: z.number().min(18),
      });
      const result = schema.safeParse({ email: "bad", age: 10 });
      if (result.success) throw new Error("expected validation to fail");

      const error = fromZodError(result.error, "Invalid payload");
      const details = error.details as { fieldErrors: Record<string, unknown> };

      expect(error.message).toBe("Invalid payload");
      expect(Object.keys(details.fieldErrors)).toEqual(
        expect.arrayContaining(["email", "age"]),
      );
    });
  });

  describe("statusFromError", () => {
    test.each([
      [new NotFoundError(), 404],
      [new UnauthorizedError(), 401],
      [new ForbiddenError(), 403],
      [new BadRequestError(), 400],
      [new ValidationError(), 422],
      [new AppError("boom"), 500],
    ])("maps %o to %i", (error, status) => {
      expect(statusFromError(error)).toBe(status);
    });

    test("unknown errors map to 500", () => {
      expect(statusFromError(new Error("boom"))).toBe(500);
      expect(statusFromError("nope")).toBe(500);
    });
  });

  describe("unknown error envelope never leaks details", () => {
    test("a generic 500 has no details field", () => {
      const error = new Error("internal connection string leaked");
      const status = statusFromError(error);
      const body = fail(
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred",
      );

      expect(status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(body.error.message).toBe("An unexpected error occurred");
      expect(body.error).not.toHaveProperty("details");
      expect(JSON.stringify(body)).not.toContain("connection string");
    });
  });
});
