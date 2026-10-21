import { zValidator } from "@hono/zod-validator";
import { ok } from "@opensaas/core";
import { Hono } from "hono";
import { registerRequestSchema } from "../dto/registration";
import { validationHook } from "../dto/validation";
import type { AppEnv } from "../types";

/**
 * Project-owned registration surface.
 *
 * It lives **outside** `/api/auth/*` on purpose: Better Auth owns that whole
 * prefix (§4.1), so a custom route below it would be shadowed by the
 * framework handler. The path is `/api/registration` (§4.1, path decision).
 *
 * The route is a pure HTTP adapter: it parses the request, calls the
 * registration service and serializes the envelope (§4.4).
 */
export const registrationRouter = new Hono<AppEnv>();

registrationRouter.post(
  "/",
  zValidator(
    "json",
    registerRequestSchema,
    validationHook("Invalid registration payload"),
  ),
  async (c) => {
    const body = c.req.valid("json");

    const result = await c.get("services").registration.register({
      email: body.email,
      password: body.password,
      name: body.name,
      inviteCode: body.inviteCode,
    });

    return c.json(ok(result), 201);
  },
);
