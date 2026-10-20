import { describe, expect, test } from "bun:test";
import { ServiceUnavailableError } from "@opensaas/core";
import {
  CircuitBreaker,
  type Sleeper,
  isTransientDbError,
  withRetry,
} from "../resilience";

/** Records every delay instead of waiting, so tests run in real time 0. */
const recordingSleeper = (delays: number[]): Sleeper => {
  return (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
};

const transientError = () =>
  Object.assign(new Error("connection refused"), { code: "08006" });

const permanentError = () =>
  Object.assign(new Error("syntax error"), { code: "42601" });

describe("@opensaas/database - transient error classification", () => {
  test("flags connection/serialization SQLSTATEs as retryable", () => {
    expect(isTransientDbError(transientError())).toBe(true);
    expect(
      isTransientDbError(Object.assign(new Error("x"), { code: "40001" })),
    ).toBe(true);
  });

  test("treats constraint and syntax errors as permanent", () => {
    expect(isTransientDbError(permanentError())).toBe(false);
    expect(isTransientDbError(new Error("plain"))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError("string")).toBe(false);
  });
});

describe("@opensaas/database - withRetry", () => {
  test("retries an idempotent operation until it succeeds", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(transientError());
        return Promise.resolve("ok");
      },
      {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 5_000,
        isRetryable: isTransientDbError,
        idempotent: true,
        sleeper: recordingSleeper(delays),
        random: () => 1,
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  test("stops at maxAttempts and rethrows the last error", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(transientError());
        },
        {
          maxAttempts: 3,
          baseDelayMs: 50,
          maxDelayMs: 5_000,
          isRetryable: isTransientDbError,
          idempotent: true,
          sleeper: recordingSleeper([]),
          random: () => 0,
        },
      ),
    ).rejects.toThrow("connection refused");

    expect(attempts).toBe(3);
  });

  test("never retries a permanent error", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(permanentError());
        },
        {
          maxAttempts: 5,
          baseDelayMs: 100,
          maxDelayMs: 5_000,
          isRetryable: isTransientDbError,
          idempotent: true,
          sleeper: recordingSleeper([]),
          random: () => 0,
        },
      ),
    ).rejects.toThrow("syntax error");

    expect(attempts).toBe(1);
  });

  test("does not retry a non-idempotent write without a key", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(transientError());
        },
        {
          maxAttempts: 5,
          baseDelayMs: 100,
          maxDelayMs: 5_000,
          isRetryable: isTransientDbError,
          idempotent: false,
          sleeper: recordingSleeper([]),
          random: () => 0,
        },
      ),
    ).rejects.toThrow("connection refused");

    expect(attempts).toBe(1);
  });

  test("retries a non-idempotent write when given an idempotency key", async () => {
    let attempts = 0;

    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 2) return Promise.reject(transientError());
        return Promise.resolve("written");
      },
      {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 5_000,
        isRetryable: isTransientDbError,
        idempotent: false,
        idempotencyKey: "abc",
        sleeper: recordingSleeper([]),
        random: () => 0,
      },
    );

    expect(result).toBe("written");
    expect(attempts).toBe(2);
  });

  test("caps the backoff at maxDelayMs", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(transientError());
        },
        {
          maxAttempts: 6,
          baseDelayMs: 100,
          maxDelayMs: 250,
          isRetryable: isTransientDbError,
          idempotent: true,
          sleeper: recordingSleeper(delays),
          random: () => 1,
        },
      ),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200, 250, 250, 250]);
  });
});

describe("@opensaas/database - CircuitBreaker", () => {
  test("passes calls through while closed", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1_000,
      now: () => 0,
    });

    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.getState()).toBe("closed");
  });

  test("opens after the failure threshold and fails fast with 503", async () => {
    const clock = 0;
    const states: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1_000,
      now: () => clock,
      onStateChange: (next) => states.push(next),
    });

    const fail = () => breaker.execute(() => Promise.reject(transientError()));
    await expect(fail()).rejects.toThrow("connection refused");
    await expect(fail()).rejects.toThrow("connection refused");
    await expect(fail()).rejects.toThrow("connection refused");

    expect(breaker.getState()).toBe("open");

    // While open, the operation is never invoked.
    let invoked = false;
    await expect(
      breaker.execute(() => {
        invoked = true;
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(invoked).toBe(false);
    expect(breaker.rejected).toBe(1);
    expect(states).toEqual(["open"]);
  });

  test("half-opens after cooldown, then closes on a successful probe", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => clock,
    });

    await expect(
      breaker.execute(() => Promise.reject(transientError())),
    ).rejects.toThrow();
    expect(breaker.getState()).toBe("open");

    clock += 1_000;
    expect(breaker.getState()).toBe("halfOpen");

    const result = await breaker.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  test("reopens when the half-open probe fails", async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => clock,
    });

    await expect(
      breaker.execute(() => Promise.reject(transientError())),
    ).rejects.toThrow();

    clock += 1_000;
    expect(breaker.getState()).toBe("halfOpen");

    await expect(
      breaker.execute(() => Promise.reject(transientError())),
    ).rejects.toThrow();

    expect(breaker.getState()).toBe("open");
    expect(breaker.trips).toBe(2);
  });
});
