import { z } from "zod";

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
    .url("DATABASE_URL must be a valid PostgreSQL connection string"),
});

export type Env = z.infer<typeof envSchema>;

export const parseEnv = (
  customEnv: Record<string, unknown> = process.env,
): Env => {
  if (customEnv.NODE_ENV === "test" || !customEnv.DATABASE_URL) {
    customEnv.DATABASE_URL =
      (customEnv.DATABASE_URL as string) ||
      "postgresql://postgres:postgres@localhost:5432/test_db";
  }

  const result = envSchema.safeParse(customEnv);

  if (!result.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(result.error.format(), null, 2),
    );
    process.exit(1);
  }

  return result.data;
};

// Export singleton instance initialized with runtime environment
export const env = parseEnv();
