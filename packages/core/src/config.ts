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
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be a valid URL"),
  DISPOSABLE_EMAIL_DOMAINS: z.string().optional(),
  // An empty string (e.g. an unset `.env` entry) falls back to the default
  // instead of being treated as an invalid value.
  REGISTRATION_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(REGISTRATION_MODES).default("public"),
  ),
});

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
