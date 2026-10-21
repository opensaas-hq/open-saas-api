import { zValidator } from "@hono/zod-validator";
import { ok } from "@opensaas/core";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { registerRequestSchema } from "../dto/registration";
import { validationHook } from "../dto/validation";
import { hashPayload } from "../services/idempotency.service";
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
    const services = c.get("services");

    // The registration is anonymous: the scope of the key is the identity
    // being created, so the same key never replays the response of another
    // identity (§4.9).
    const result = await services.idempotency.execute({
      scope: `registration:${hashPayload(body.email)}`,
      endpoint: "POST /api/registration",
      key: c.req.header("idempotency-key"),
      payload: body,
      operation: async () => ({
        status: 201,
        body: await services.registration.register({
          email: body.email,
          password: body.password,
          name: body.name,
          inviteCode: body.inviteCode,
        }),
      }),
    });

    if (result.replayed) {
      c.header("idempotent-replayed", "true");
    }

    return c.json(ok(result.body), result.status as ContentfulStatusCode);
  },
);
