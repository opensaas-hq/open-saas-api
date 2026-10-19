import { z } from "zod";

export const REGISTRATION_MODES = [
  "public",
  "waiting_list",
  "invite_code",
  "paid_required",
] as const;

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection string")
    .regex(
      /^postgres(ql)?:\/\//,
      "DATABASE_URL must be a PostgreSQL connection string (scheme postgres:// or postgresql://)",
    ),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a valid URL"),
  DISPOSABLE_EMAIL_DOMAINS: z.string().optional(),
  REGISTRATION_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(REGISTRATION_MODES).default("public"),
  ),
});

export type Env = z.infer<typeof envSchema>;

export const formatEnvError = (error: z.ZodError): string => {
  const lines = error.issues.map(
    (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
  );
  return ["❌ Invalid or missing environment variables:", ...lines].join("\n");
};

export const parseEnv = (
  customEnv: Record<string, unknown> = process.env,
): Env => {
  const result = envSchema.safeParse(customEnv);

  if (!result.success) {
    console.error(formatEnvError(result.error));
    process.exit(1);
  }

  return result.data;
};

// Export singleton instance initialized with runtime environment
export const env = parseEnv();
