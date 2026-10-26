import { z } from "zod";

/**
 * Canonical registration modes. Single source of truth shared by the schema
 * below and the derived `RegistrationMode` type, so the two never drift apart.
 */
export const REGISTRATION_MODES = [
  "public",
  "waiting_list",
  "invite_code",
  "paid_required",
] as const;

/**
 * A boolean knob.
 *
 * The string form is what an `.env` file carries; the boolean form is what a
 * programmatic source (a factory, a test) already has at hand. Both are
 * accepted and the parsed value is always a real boolean.
 *
 * A plain `z.coerce.boolean()` would be wrong here: it would turn the string
 * `"false"` into `true`.
 */
const booleanFlag = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) =>
    typeof value === "boolean" ? value : value === "true",
  );

/**
 * Validated configuration contract. Every new variable must be declared here
 * and documented in `.env.example`.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  // Consumed by the logger; kept in the schema so an invalid level fails boot.
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z
    .string()
    // Require a postgres scheme so typos (`postgresl://`, `http://`) fail at
    // boot instead of at connect time with a less actionable message.
    .regex(
      /^postgres(ql)?:\/\//,
      "DATABASE_URL must be a PostgreSQL connection string (scheme postgres:// or postgresql://)",
    )
    // Then require a well-formed URL, so malformed remainder fails here too.
    .refine((value) => z.url().safeParse(value).success, {
      message: "DATABASE_URL must be a valid PostgreSQL connection string",
    }),
  // Dedicated database for integration tests. Under `.env.test`, `DATABASE_URL`
  // points at this same test database (so they are equal there), always
  // distinct from development. Optional in every environment; required only by
  // the database package's test isolation machinery (§2.7), never read by
  // application code.
  DATABASE_URL_TEST: z
    .string()
    .regex(
      /^postgres(ql)?:\/\//,
      "DATABASE_URL_TEST must be a PostgreSQL connection string (scheme postgres:// or postgresql://)",
    )
    .optional(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be a valid URL"),
  // Connection pool settings consumed by `@opensaas/database`'s `createDb`.
  // Safe defaults; values are in the units documented in `.env.example`.
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_S: z.coerce.number().int().nonnegative().default(20),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_CONNECT_TIMEOUT_S: z.coerce.number().int().positive().default(10),
  // Connection resilience (§2.5): startup retry, transient-retry and the
  // circuit breaker. Defaults are safe; every value is documented in
  // `.env.example`.
  DB_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  DB_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().default(100),
  DB_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(5_000),
  DB_BREAKER_ENABLED: booleanFlag.default(true),
  DB_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  DB_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(10_000),
  DB_BREAKER_PROBE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(2_000),
  // Postgres Row-Level Security (§2.5). This is a runtime behavioral switch,
  // not a migration gate: when on, the client connects as the dedicated
  // `opensaas_app` role and every tenant-scoped transaction sets the
  // `app.current_org` GUC. Off in local development until the application-layer
  // adoption lands; on in the RLS test job. See docs/architecture/multitenancy.md.
  RLS_ENABLED: booleanFlag.default(false),
  DISPOSABLE_EMAIL_DOMAINS: z.string().optional(),
  // Comma-separated allowlist of browser origins accepted by Better Auth's
  // CSRF/origin check (§3.4). The same list feeds the API CORS config (§4.5).
  // When unset, only `BETTER_AUTH_URL` is trusted.
  TRUSTED_ORIGINS: z.string().optional(),
  // Better Auth built-in rate limiter (§3.4). Enabled by default; the window and
  // max are per auth route-class.
  AUTH_RATE_LIMIT_ENABLED: booleanFlag.default(true),
  AUTH_RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  // Session lifetime policy (§3.4). `expiresIn` is the absolute lifetime;
  // `updateAge` is how often an active session's expiry is refreshed.
  SESSION_EXPIRES_IN_S: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  SESSION_UPDATE_AGE_S: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60 * 60 * 24),
  // Membership cache TTL (§4.3). The tenant middleware resolves the role of a
  // user in the active organization through a short-lived in-memory cache, so
  // a burst of requests does not turn into a burst of `member` lookups. The
  // TTL bounds how long a role change can stay invisible.
  MEMBERSHIP_CACHE_TTL_S: z.coerce.number().int().nonnegative().default(30),
  // Maximum size, in bytes, of a request body (§4.5). The limit is global:
  // a single oversized body is refused with a 413 before it reaches a route.
  BODY_SIZE_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Maximum number of contacts accepted in one bulk import (§4.5). The limit
  // is enforced by the DTO schema, so an oversized batch is a validation
  // failure and never reaches the transaction.
  BULK_MAX_CONTACTS: z.coerce.number().int().positive().default(1_000),
  // Timeout of the readiness probe (§4.6), in milliseconds. The probe must
  // answer within this budget: a health endpoint that hangs is worse than one
  // that reports the database as down.
  HEALTH_PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  // Budget given to the in-flight requests when the process shuts down
  // (§4.8), in milliseconds. When it elapses the process exits with a
  // non-zero code instead of waiting forever.
  SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // How long the response of a write stays replayable (§4.9), in seconds. It
  // is the TTL of the idempotency keys: after it, the same key runs the
  // operation again.
  IDEMPOTENCY_TTL_S: z.coerce.number().int().positive().default(86_400),
  // Write-endpoint rate limiter (§4.5). Better Auth guards its own routes
  // (§3.4); this one guards the project's write endpoints (registration and
  // the CRM writes). `false` disables the limiter.
  WRITE_RATE_LIMIT_ENABLED: booleanFlag.default(true),
  WRITE_RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
  WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  // GraphQL safety limits (§4.11). The depth is the maximum nesting of a
  // selection set; the cost is the number of fields a document selects once
  // its fragments are expanded. Both are checked before execution, so a
  // pathological document is refused instead of resolved.
  GRAPHQL_MAX_DEPTH: z.coerce.number().int().positive().default(10),
  GRAPHQL_MAX_COMPLEXITY: z.coerce.number().int().positive().default(500),
  // Schema introspection (§4.11). Unset enables it outside production only;
  // an explicit `true`/`false` overrides that default.
  GRAPHQL_INTROSPECTION_ENABLED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    booleanFlag.optional(),
  ),
  // An empty string (e.g. an unset `.env` entry) falls back to the default
  // instead of being treated as an invalid value.
  REGISTRATION_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(REGISTRATION_MODES).default("public"),
  ),
});

/**
 * Parse a comma-separated origin allowlist, trimming blanks. Pure and
 * order-preserving so it can be unit-tested directly.
 */
export const parseTrustedOrigins = (raw: string | undefined): string[] => {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

/**
 * The effective trusted-origin allowlist: the origins configured through
 * `TRUSTED_ORIGINS`, always including the app's own `BETTER_AUTH_URL`. This is
 * the single source of truth shared by Better Auth's `trustedOrigins` (§3.4)
 * and the API CORS allowlist (§4.5).
 */
export const getTrustedOrigins = (env: Env = getEnv()): string[] => [
  ...new Set([
    env.BETTER_AUTH_URL,
    ...parseTrustedOrigins(env.TRUSTED_ORIGINS),
  ]),
];

/** Configuration type inferred from the schema. */
export type Env = z.infer<typeof envSchema>;

/**
 * Turn a Zod error into a human-readable boot report: one line per invalid
 * variable, naming each one and the reason it failed.
 */
export const formatEnvError = (error: z.ZodError): string => {
  const lines = error.issues.map(
    (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
  );
  return ["❌ Invalid or missing environment variables:", ...lines].join("\n");
};

/**
 * Typed error thrown by the config factories. It carries the formatted report
 * so the boot path can print it and exit, keeping validation free of side
 * effects.
 */
export class ConfigError extends Error {
  public readonly report: string;

  constructor(error: z.ZodError) {
    const report = formatEnvError(error);
    super(report);
    this.name = "ConfigError";
    this.report = report;
  }
}

/**
 * Parse and validate a configuration source (defaults to `process.env`).
 * Pure: it throws a `ConfigError` on failure and never exits the process.
 */
export const createEnv = (
  source: Record<string, unknown> = process.env,
): Env => {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigError(result.error);
  }

  return result.data;
};

let cachedEnv: Env | undefined;

/**
 * Lazily-parsed, memoized accessor for consumers that want validated config
 * without an explicit boot step.
 */
export const getEnv = (source: Record<string, unknown> = process.env): Env => {
  cachedEnv ??= createEnv(source);
  return cachedEnv;
};

/**
 * Test seam: drop the memoized environment so the next {@link getEnv} /
 * {@link initConfig} re-parses from the provided source. Keeps config tests
 * order-independent; production code never needs this.
 */
export const resetConfig = (): void => {
  cachedEnv = undefined;
};

/**
 * Explicit boot initializer. This is the only place allowed to terminate the
 * process: it reports the failure and exits when config is invalid.
 *
 * The report is emitted to stderr as a single structured JSON line (the same
 * shape as the logger's output) so boot failures are machine-readable. A pino
 * logger cannot be used here: constructing it needs a valid `env`, which is
 * exactly what failed.
 */
export const initConfig = (
  source: Record<string, unknown> = process.env,
): Env => {
  try {
    cachedEnv = createEnv(source);
    return cachedEnv;
  } catch (error) {
    if (error instanceof ConfigError) {
      // Boot only: surface the report and stop before the app starts.
      const bootFailure = {
        level: 60,
        name: "ConfigError",
        msg: "Invalid or missing environment variables",
        report: error.report,
        time: Date.now(),
      };
      process.stderr.write(`${JSON.stringify(bootFailure)}\n`);
      process.exit(1);
    }
    throw error;
  }
};
