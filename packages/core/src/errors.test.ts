import { describe, expect, test } from "bun:test";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

describe("@opensaas/core - Errors System", () => {
  describe("AppError (Base Class)", () => {
    test("should create a custom error with default properties", () => {
      const error = new AppError("Something went wrong");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.name).toBe("AppError");
      expect(error.message).toBe("Something went wrong");
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(error.details).toBeUndefined();
    });

    test("should create a custom error with custom status, code and details", () => {
      const details = { field: "email", reason: "invalid_format" };
      const error = new AppError("Custom error", 418, "TEAPOT_ERROR", details);

      expect(error.message).toBe("Custom error");
      expect(error.statusCode).toBe(418);
      expect(error.code).toBe("TEAPOT_ERROR");
      expect(error.details).toEqual(details);
    });
  });

  describe("NotFoundError (404)", () => {
    test("should have default message, 404 status, and NOT_FOUND code", () => {
      const error = new NotFoundError();

      expect(error.message).toBe("Resource not found");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    });

    test("should accept custom message and details", () => {
      const error = new NotFoundError("User not found", { userId: "123" });

      expect(error.message).toBe("User not found");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.details).toEqual({ userId: "123" });
    });
  });

  describe("UnauthorizedError (401)", () => {
    test("should have default message, 401 status, and UNAUTHORIZED code", () => {
      const error = new UnauthorizedError();

      expect(error.message).toBe("Unauthorized access");
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
    });

    test("should accept custom message", () => {
      const error = new UnauthorizedError("Token expired");

      expect(error.message).toBe("Token expired");
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("BadRequestError (400)", () => {
    test("should have default message, 400 status, and BAD_REQUEST code", () => {
      const error = new BadRequestError();

      expect(error.message).toBe("Bad request");
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
    });

    test("should accept custom message and details", () => {
      const error = new BadRequestError("Invalid payload");

      expect(error.message).toBe("Invalid payload");
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
    });
  });

  describe("ValidationError (422)", () => {
    test("should have default message, 422 status, and VALIDATION_ERROR code", () => {
      const error = new ValidationError();

      expect(error.message).toBe("Validation failed");
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe("VALIDATION_ERROR");
    });

    test("should accept validation errors details", () => {
      const validationDetails = {
        errors: [{ path: "age", message: "Required" }],
      };
      const error = new ValidationError("Validation error", validationDetails);

      expect(error.message).toBe("Validation error");
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.details).toEqual(validationDetails);
    });
  });
});
