import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { apiSuccessResponseSchema, ok } from "@opensaas/core";
import {
  registerRequestSchema,
  registrationDtoSchema,
} from "../dto/registration";
import { validationHook } from "../dto/validation";
import {
  conflictResponse,
  internalErrorResponse,
  rateLimitResponse,
  validationResponse,
} from "../openapi/responses";
import { hashPayload } from "../services/idempotency.service";
import type { AppEnv } from "../types";

/**
 * The route definition of the registration.
 *
 * The request schema is declared once here: the runtime validation and the
 * generated OpenAPI document read the same Zod object, so the contract cannot
 * drift from the behaviour (§4.10).
 */
const registrationRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: { "application/json": { schema: registerRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The user was registered",
      content: {
        "application/json": {
          schema: apiSuccessResponseSchema(registrationDtoSchema),
        },
      },
    },
    409: conflictResponse,
    422: validationResponse,
    429: rateLimitResponse,
    500: internalErrorResponse,
  },
});

/**
 * Project-owned registration surface.
 *
 * It lives **outside** `/api/auth/*` on purpose: Better Auth owns that whole
 * prefix (§4.1), so a custom route below it would be shadowed by the
 * framework handler. The path is `/api/v1/registration` (§4.1, §4.10).
 *
 * The route is a pure HTTP adapter: it parses the request, calls the
 * registration service and serializes the envelope (§4.4).
 */
export const registrationRouter = new OpenAPIHono<AppEnv>();

registrationRouter.openapi(
  registrationRoute,
  async (c) => {
    const body = c.req.valid("json");
    const services = c.get("services");

    // The registration is anonymous: the scope of the key is the identity
    // being created, so the same key never replays the response of another
    // identity (§4.9).
    const result = await services.idempotency.execute({
      scope: `registration:${hashPayload(body.email)}`,
      endpoint: "POST /api/v1/registration",
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

    // The operation always answers 201: the replay returns the stored body
    // of that very response.
    return c.json(ok(result.body), 201);
  },
  validationHook("Invalid registration payload"),
);
