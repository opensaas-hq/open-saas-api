import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthInstance } from "@opensaas/auth";
import {
  AppError,
  type Env,
  type Logger,
  NotFoundError,
  TooManyRequestsError,
  fail,
  statusFromError,
} from "@opensaas/core";
import type { Database } from "@opensaas/database";
import {
  DatabaseAuditRepository,
  getBreaker,
  probeDatabase,
} from "@opensaas/database";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createGraphqlContext } from "./graphql/context";
import { createGraphqlEndpoint } from "./graphql/yoga";
import { type Lifecycle, createLifecycle } from "./lifecycle";
import { createPipeline } from "./middleware/pipeline";
import { tenantContextMiddleware } from "./middleware/tenant";
import { buildOpenApiDocument } from "./openapi/document";
import { createLegacyDeprecationMiddleware } from "./openapi/legacy";
import {
  swaggerUiContentSecurityPolicy,
  swaggerUiHtml,
} from "./openapi/swagger";
import { createBranchesRouter } from "./routes/branches";
import { createContactsRouter } from "./routes/contacts";
import { type BreakerProbe, createHealthRouter } from "./routes/health";
import { registrationRouter } from "./routes/registration";
import { createBranchesService } from "./services/branches.service";
import { createContactsService } from "./services/contacts.service";
import { createIdempotencyService } from "./services/idempotency.service";
import { createMembershipService } from "./services/membership.service";
import { createOrganizationsService } from "./services/organizations.service";
import { createRegistrationService } from "./services/registration.service";
import type { AppEnv } from "./types";

/**
 * Dependencies of the HTTP surface (§4.7).
 *
 * Everything the app needs is injected: no module-level singletons are read
 * at request time, so a test can build an app bound to a specific
 * configuration and database handle.
 */
export type AppDependencies = {
  /** Validated configuration. */
  env: Env;
  /** Database handle used by the tenant-scoped routes. */
  db: Database;
  /** Better Auth instance: owns the `/api/auth/*` surface and session lookup. */
  auth: AuthInstance;
  /** Logger used by the error handler and the access log (§4.5). */
  logger: Logger;
  /**
   * Lifecycle of the process, shared with the shutdown controller (§4.8).
   * Defaults to a fresh one, so an app built without a controller still
   * reports itself as ready.
   */
  lifecycle?: Lifecycle;
  /**
   * Circuit breaker of the database client, read by the readiness endpoint
   * (§4.6). Defaults to the process-wide breaker of the database package.
   */
  breaker?: BreakerProbe;
};

/**
 * Build the HTTP application.
 *
 * The Better Auth handler is mounted on the whole `/api/auth/*` surface before
 * any custom route (§4.1), so the framework owns sign-up, sign-in, sign-out,
 * session and organization endpoints. The project-owned registration endpoint
 * lives outside that surface (`/api/v1/registration`), which removes any
 * possible shadowing between the two.
 *
 * The product routes live under `/api/v1` (§4.10): the versioned prefix is
 * the contract, published as an OpenAPI 3.1 document at
 * `/api/v1/openapi.json` and rendered by the Swagger UI at `/api/v1/docs`.
 * The historical paths keep working as deprecated aliases: they answer with
 * the `Deprecation` and `Sunset` headers.
 */
export const createApp = (
  dependencies: AppDependencies,
): OpenAPIHono<AppEnv> => {
  const { env, db, auth, logger } = dependencies;
  const lifecycle = dependencies.lifecycle ?? createLifecycle();
  const breaker = dependencies.breaker ?? getBreaker();
  const app = new OpenAPIHono<AppEnv>();

  // The services are built once per app: the membership cache must survive
  // across requests, so it cannot be created per request (§4.3). The audit
  // port is the database-backed implementation, shared by every service that
  // mutates state (§4.4).
  const audit = new DatabaseAuditRepository(undefined, db);
  const branches = createBranchesService({ db, audit });
  const services = {
    membership: createMembershipService({
      ttlSeconds: env.MEMBERSHIP_CACHE_TTL_S,
      audit,
      db,
    }),
    branches,
    organizations: createOrganizationsService({ db }),
    contacts: createContactsService({ branches, audit, db }),
    registration: createRegistrationService({ env, audit, db }),
    idempotency: createIdempotencyService({
      ttlSeconds: env.IDEMPOTENCY_TTL_S,
      db,
    }),
  };

  // Dependency-injection slots (§4.7): expose the validated config, the
  // database handle, the auth instance, the logger and the services on the
  // request context so downstream middleware/handlers read them from
  // `c.get(...)` instead of reaching for module globals. Registered before any
  // route so every request sees them.
  app.use("*", async (c, next) => {
    c.set("env", env);
    c.set("db", db);
    c.set("auth", auth);
    c.set("logger", logger);
    c.set("services", services);
    await next();
  });

  // The cross-cutting pipeline (§4.5) is mounted before every route, the
  // Better Auth surface included: the correlation id, the access log, the
  // security headers, the CORS allowlist, the write rate limit and the body
  // size limit apply to every request the app answers.
  for (const middleware of createPipeline({ env, logger, lifecycle })) {
    app.use("*", middleware);
  }

  // The deprecated paths are marked before any route is matched: the headers
  // belong to every response of those paths, successful or not (§4.10).
  app.use("*", createLegacyDeprecationMiddleware());

  // Better Auth owns every `/api/auth/*` endpoint (§4.1): sign-up, sign-in,
  // sign-out, session, and the organization plugin endpoints.
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  // The health surface (§4.6): liveness, readiness and the deprecated
  // `/api/health` alias. It is mounted on the root, before the tenant
  // middleware, and it needs neither a session nor a tenant.
  app.route(
    "/",
    createHealthRouter({
      // The composition root is the only place that knows how to reach a
      // database: the health route depends on the port, not on the driver.
      db: {
        isReachable: (timeoutMs) => probeDatabase({ db, timeoutMs }),
      },
      breaker,
      timeoutMs: env.HEALTH_PROBE_TIMEOUT_MS,
      lifecycle,
      logger,
    }),
  );

  // The GraphQL surface (§4.11): one endpoint over the CRM domain, behind the
  // same pipeline and the same tenant resolution as REST. The session, the
  // tenant and the branch are resolved before a resolver runs, and every
  // resolver delegates to the service layer.
  const graphql = createGraphqlEndpoint({ env });

  app.on(["GET", "POST"], "/graphql", tenantContextMiddleware, (c) =>
    graphql.fetch(c.req.raw, createGraphqlContext(c)),
  );

  // The versioned product surface (§4.10). These are the paths the OpenAPI
  // document describes and the paths the contract is tested against.
  app.route("/api/v1/registration", registrationRouter);
  app.route(
    "/api/v1/contacts",
    createContactsRouter({ bulkMaxContacts: env.BULK_MAX_CONTACTS }),
  );
  app.route("/api/v1/branches", createBranchesRouter());

  // The deprecated aliases (§4.10): the very same handlers, mounted on the
  // historical paths. They are wrapped in a plain Hono application, so the
  // published contract only describes the versioned surface.
  const legacyContacts = new Hono<AppEnv>();
  legacyContacts.route(
    "/",
    createContactsRouter({ bulkMaxContacts: env.BULK_MAX_CONTACTS }),
  );
  app.route("/api/contacts", legacyContacts);

  const legacyBranches = new Hono<AppEnv>();
  legacyBranches.route("/", createBranchesRouter());
  app.route("/api/branches", legacyBranches);

  const legacyRegistration = new Hono<AppEnv>();
  legacyRegistration.route("/", registrationRouter);
  app.route("/api/registration", legacyRegistration);

  // The contract itself (§4.10): the OpenAPI 3.1 document, generated from the
  // schemas the running application uses, and the page that renders it.
  app.get("/api/v1/openapi.json", (c) =>
    c.json(buildOpenApiDocument(app) as Record<string, unknown>),
  );

  app.get("/api/v1/docs", (c) => {
    // The default policy of the API would block the CDN that serves the
    // Swagger UI bundle, so the documentation route relaxes it (§4.10).
    c.header("content-security-policy", swaggerUiContentSecurityPolicy);
    return c.html(swaggerUiHtml("/api/v1/openapi.json"));
  });

  // Unknown routes still answer with the JSON envelope instead of Hono's
  // plain-text default, keeping the response contract intact.
  app.notFound((c) => {
    const error = new NotFoundError("Route not found", { path: c.req.path });
    return c.json(fail(error), 404);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      // A rate-limited client is told how long it has to wait (§4.5).
      if (err instanceof TooManyRequestsError) {
        c.header("retry-after", String(err.retryAfterSeconds));
      }

      logger.warn({
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        details: err.details,
        path: c.req.path,
      });

      return c.json(fail(err), statusFromError(err) as ContentfulStatusCode);
    }

    logger.error(err, "Unhandled server error");

    // Unknown errors never leak internals: no details, generic message.
    return c.json(
      fail("INTERNAL_SERVER_ERROR", "An unexpected error occurred"),
      500,
    );
  });

  return app;
};
