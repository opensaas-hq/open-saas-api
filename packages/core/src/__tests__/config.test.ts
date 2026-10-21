import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  REGISTRATION_MODES,
  createEnv,
  envSchema,
  formatEnvError,
  getEnv,
  getTrustedOrigins,
  initConfig,
  parseTrustedOrigins,
  resetConfig,
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
      expect(result.data.RLS_ENABLED).toBe(false);
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

  describe("RLS_ENABLED", () => {
    test("defaults to false", () => {
      const result = envSchema.safeParse(validEnv);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.RLS_ENABLED).toBe(false);
    });

    test('"true" is coerced to a boolean', () => {
      const result = envSchema.safeParse({ ...validEnv, RLS_ENABLED: "true" });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.RLS_ENABLED).toBe(true);
    });

    test("an unknown value fails naming the variable", () => {
      const result = envSchema.safeParse({ ...validEnv, RLS_ENABLED: "yes" });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["RLS_ENABLED"]);
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

  describe("required and bounded variables", () => {
    test("a missing DATABASE_URL fails naming the variable", () => {
      const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;
      const result = envSchema.safeParse(withoutDb);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join("."))).toContain(
        "DATABASE_URL",
      );
    });

    test("a BETTER_AUTH_SECRET shorter than 32 characters fails", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        BETTER_AUTH_SECRET: "short",
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["BETTER_AUTH_SECRET"]);
    });

    test("a malformed BETTER_AUTH_URL fails", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        BETTER_AUTH_URL: "not-a-url",
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["BETTER_AUTH_URL"]);
    });

    test("PORT is coerced to a number and a non-numeric value fails", () => {
      const okResult = envSchema.safeParse({ ...validEnv, PORT: "8080" });
      expect(okResult.success).toBe(true);
      if (okResult.success) expect(okResult.data.PORT).toBe(8080);

      const badResult = envSchema.safeParse({ ...validEnv, PORT: "abc" });
      expect(badResult.success).toBe(false);
    });

    test("a well-formed postgres URL passes both scheme and URL checks", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Auth hardening knobs (§3.4)", () => {
    test("rate limit, session and trusted-origin defaults are applied", () => {
      const result = envSchema.safeParse(validEnv);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.AUTH_RATE_LIMIT_ENABLED).toBe(true);
      expect(result.data.AUTH_RATE_LIMIT_WINDOW_S).toBe(60);
      expect(result.data.AUTH_RATE_LIMIT_MAX).toBe(100);
      expect(result.data.SESSION_EXPIRES_IN_S).toBe(60 * 60 * 24 * 7);
      expect(result.data.SESSION_UPDATE_AGE_S).toBe(60 * 60 * 24);
      expect(result.data.TRUSTED_ORIGINS).toBeUndefined();
    });

    test("values are coerced from strings", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        AUTH_RATE_LIMIT_ENABLED: "false",
        AUTH_RATE_LIMIT_WINDOW_S: "30",
        AUTH_RATE_LIMIT_MAX: "5",
        SESSION_EXPIRES_IN_S: "3600",
        SESSION_UPDATE_AGE_S: "0",
        TRUSTED_ORIGINS: "https://a.example, https://b.example",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.AUTH_RATE_LIMIT_ENABLED).toBe(false);
      expect(result.data.AUTH_RATE_LIMIT_WINDOW_S).toBe(30);
      expect(result.data.AUTH_RATE_LIMIT_MAX).toBe(5);
      expect(result.data.SESSION_EXPIRES_IN_S).toBe(3600);
      expect(result.data.SESSION_UPDATE_AGE_S).toBe(0);
      expect(result.data.TRUSTED_ORIGINS).toBe(
        "https://a.example, https://b.example",
      );
    });

    test("a zero rate-limit max is rejected naming the variable", () => {
      const result = envSchema.safeParse({
        ...validEnv,
        AUTH_RATE_LIMIT_MAX: "0",
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["AUTH_RATE_LIMIT_MAX"]);
    });

    test("parseTrustedOrigins trims, drops blanks and is order-preserving", () => {
      expect(
        parseTrustedOrigins(" https://a.example ,, https://b.example "),
      ).toEqual(["https://a.example", "https://b.example"]);
      expect(parseTrustedOrigins(undefined)).toEqual([]);
      expect(parseTrustedOrigins("   ")).toEqual([]);
    });

    test("getTrustedOrigins always includes BETTER_AUTH_URL and de-duplicates", () => {
      const env = createEnv({
        ...validEnv,
        BETTER_AUTH_URL: "https://app.example",
        TRUSTED_ORIGINS: "https://app.example, https://admin.example",
      });

      expect(getTrustedOrigins(env)).toEqual([
        "https://app.example",
        "https://admin.example",
      ]);
    });

    test("getTrustedOrigins falls back to BETTER_AUTH_URL when unset", () => {
      const env = createEnv(validEnv);

      expect(getTrustedOrigins(env)).toEqual([validEnv.BETTER_AUTH_URL]);
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
      resetConfig();
      const env = getEnv(validEnv);

      expect(env.PORT).toBeGreaterThan(0);
      expect(env.REGISTRATION_MODE).toBe("public");
    });

    test("getEnv memoizes: a second call ignores a different source", () => {
      resetConfig();
      const first = getEnv(validEnv);
      const second = getEnv({ ...validEnv, REGISTRATION_MODE: "waiting_list" });

      expect(first.REGISTRATION_MODE).toBe("public");
      expect(second).toBe(first);
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

    test("the boot failure is reported as a single structured JSON line", async () => {
      const { stderr } = await bootWith({ REGISTRATION_MODE: "bogus" });

      const entry = JSON.parse(stderr.trim());
      expect(entry.name).toBe("ConfigError");
      expect(entry.msg).toContain("Invalid or missing environment variables");
      expect(entry.report).toContain("REGISTRATION_MODE");
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
