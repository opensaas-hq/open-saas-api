import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  REGISTRATION_MODES,
  createEnv,
  envSchema,
  formatEnvError,
  getEnv,
  initConfig,
} from "../config";

// Minimal valid configuration reused across the schema assertions below.
const validEnv = {
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("@opensaas/core - Config", () => {
  describe("defaults", () => {
    test("applies defaults for every optional variable", () => {
      const result = envSchema.safeParse(validEnv);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.NODE_ENV).toBe("development");
      expect(result.data.PORT).toBe(3000);
      expect(result.data.LOG_LEVEL).toBe("info");
      expect(result.data.REGISTRATION_MODE).toBe("public");
      expect(result.data.DISPOSABLE_EMAIL_DOMAINS).toBeUndefined();
    });
  });

  describe("REGISTRATION_MODE", () => {
    test.each(REGISTRATION_MODES)("accepts %s", (mode) => {
      const result = envSchema.safeParse({
        ...validEnv,
        REGISTRATION_MODE: mode,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.REGISTRATION_MODE).toBe(mode);
    });

    test("an unknown value fails, names the variable and lists allowed values", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        REGISTRATION_MODE: "bogus",
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["REGISTRATION_MODE"]);
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toContain("public");
      expect(message).toContain("waiting_list");
      expect(message).toContain("invite_code");
      expect(message).toContain("paid_required");
    });

    test("an empty value falls back to the default (public)", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        REGISTRATION_MODE: "",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.REGISTRATION_MODE).toBe("public");
    });
  });

  describe("DATABASE_URL", () => {
    test.each(["postgresql://", "postgres://"])(
      "accepts the %s scheme",
      (scheme) => {
        const result = envSchema.safeParse({
          ...validEnv,
          DATABASE_URL: `${scheme}postgres:password@localhost:5432/opensaas`,
        });

        expect(result.success).toBe(true);
      },
    );

    test.each([
      ["http://localhost/x", "a non-postgres scheme"],
      ["postgresl://localhost/opensaas", "a scheme typo"],
    ])("rejects %s (%s)", (databaseUrl) => {
      const result = envSchema.safeParse({
        ...validEnv,
        DATABASE_URL: databaseUrl,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["DATABASE_URL"]);
    });
  });

  describe("formatEnvError", () => {
    test("names every invalid variable and lists its allowed values", () => {
      const result = envSchema.safeParse({
        DATABASE_URL: "http://localhost/x",
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        REGISTRATION_MODE: "bogus",
      });

      expect(result.success).toBe(false);
      if (result.success) return;

      const report = formatEnvError(result.error);

      expect(report).toContain("Invalid or missing environment variables");
      expect(report).toContain("DATABASE_URL:");
      expect(report).toContain("REGISTRATION_MODE:");
      expect(report).toContain("public");
    });
  });

  // Factories: pure parsing (createEnv), memoized access (getEnv) and the
  // explicit boot initializer (initConfig).
  describe("createEnv / getEnv / initConfig", () => {
    test("createEnv parses an injected source without touching process.env", () => {
      const env = createEnv(validEnv);

      expect(env.NODE_ENV).toBe("development");
      expect(env.REGISTRATION_MODE).toBe("public");
    });

    test("createEnv throws a ConfigError (no process.exit) on invalid input", () => {
      expect(() =>
        createEnv({ ...validEnv, REGISTRATION_MODE: "bogus" }),
      ).toThrow(ConfigError);
    });

    test("getEnv returns the parsed environment", () => {
      const env = getEnv(validEnv);

      expect(env.PORT).toBeGreaterThan(0);
      expect(env.REGISTRATION_MODE).toBe("public");
    });

    test("initConfig returns the parsed environment for a valid source", () => {
      const env = initConfig(validEnv);

      expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    });
  });

  // Boot behavior: importing the module must not exit, while calling
  // initConfig() must fail fast on invalid config. Exercised in a subprocess
  // because the failure path terminates the process.
  describe("boot behavior (subprocess)", () => {
    const bootEnv = {
      NODE_ENV: "test",
      PORT: "3000",
      LOG_LEVEL: "error",
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
    };

    const bootWith = async (overrides: Record<string, string>) => {
      const entry = `${import.meta.dir}/../config.ts`;
      const script = `const m = await import(${JSON.stringify(entry)}); m.initConfig();`;
      const proc = Bun.spawn([process.execPath, "-e", script], {
        env: { ...bootEnv, ...overrides },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      return { code, stderr };
    };

    test("a valid environment boots (exit 0)", async () => {
      const { code } = await bootWith({});

      expect(code).toBe(0);
    });

    test("REGISTRATION_MODE=bogus aborts boot naming the variable", async () => {
      const { code, stderr } = await bootWith({ REGISTRATION_MODE: "bogus" });

      expect(code).toBe(1);
      expect(stderr).toContain("REGISTRATION_MODE");
      expect(stderr).toContain("invite_code");
    });

    test("a non-postgres DATABASE_URL aborts boot naming the variable", async () => {
      const { code, stderr } = await bootWith({
        DATABASE_URL: "http://localhost/x",
      });

      expect(code).toBe(1);
      expect(stderr).toContain("DATABASE_URL");
    });
  });
});
