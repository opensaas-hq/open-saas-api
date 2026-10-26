import type { Logger } from "@opensaas/core";
import type { Lifecycle } from "./lifecycle";

/** The signals the process handles. */
export type ShutdownSignal = "SIGTERM" | "SIGINT";

/** Dependencies of the shutdown controller (§4.8). */
export type ShutdownOptions = {
  /** Lifecycle flipped to draining so the readiness endpoint answers 503. */
  lifecycle: Lifecycle;
  /**
   * Stop accepting new connections.
   *
   * The in-flight requests keep being served: the drain is bounded, not
   * abrupt.
   */
  stopAccepting: () => void | Promise<void>;
  /** Close the database pool (§2.4). */
  closeDatabase: () => Promise<void>;
  /** Flush the pending log lines. */
  flushLogs: () => void | Promise<void>;
  /** Terminate the process with the given code. */
  exit: (code: number) => void;
  /** Milliseconds the drain may take before the process gives up waiting. */
  drainTimeoutMs: number;
  /** Logger the shutdown events are written to. */
  logger: Logger;
};

/** The controller returned by {@link createShutdownController}. */
export type ShutdownController = {
  /**
   * Run the shutdown sequence.
   *
   * A second call (a second signal) exits the process immediately: the
   * operator asked twice, the drain is abandoned.
   */
  shutdown: (signal: ShutdownSignal) => Promise<void>;
  /** True once the shutdown sequence has started. */
  isShuttingDown: () => boolean;
  /** Register the signal handlers on the process. */
  install: () => void;
  /** Remove the signal handlers from the process. */
  uninstall: () => void;
};

/**
 * Conventional exit code of a signal: 128 + the signal number (128 + 2 = 130
 * for `SIGINT`, 128 + 15 = 143 for `SIGTERM`).
 */
const exitCodeForSignal = (signal: ShutdownSignal): number =>
  signal === "SIGINT" ? 130 : 143;

/**
 * Wait for a promise, but not longer than the given budget.
 *
 * Resolves to `true` when the promise settled in time and to `false` when the
 * budget elapsed first. The promise is not cancelled: the caller decides what
 * to do with a late settlement.
 */
const settleWithin = async (
  work: Promise<unknown>,
  budgetMs: number,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * The graceful shutdown of the HTTP process (§4.8).
 *
 * The order is the contract, and it is the one a load balancer needs:
 *
 * 1. the readiness endpoint flips to 503, so the instance leaves the
 *    rotation **before** anything is cut;
 * 2. the server stops accepting new connections, while the requests already
 *    in flight keep being served;
 * 3. the drain waits for those requests, bounded by `drainTimeoutMs`;
 * 4. the database pool is closed and the logs are flushed;
 * 5. the process exits 0 — or non-zero when the drain timed out, so the
 *    orchestrator knows the instance did not close cleanly.
 *
 * A second signal abandons the sequence and exits immediately.
 */
export const createShutdownController = (
  options: ShutdownOptions,
): ShutdownController => {
  let shuttingDown = false;

  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    if (shuttingDown) {
      options.logger.warn(
        `Received ${signal} while shutting down: exiting immediately`,
      );
      options.exit(exitCodeForSignal(signal));
      return;
    }

    shuttingDown = true;
    options.logger.info(`Received ${signal}: starting the graceful shutdown`);

    // 1. Readiness flips to 503 first: the load balancer must stop sending
    //    new traffic before the connections are drained.
    options.lifecycle.beginDrain();

    try {
      // 2. Stop accepting new connections. The in-flight requests continue.
      await options.stopAccepting();
    } catch (error) {
      options.logger.error(error, "Failed to stop accepting connections");
    }

    // 3. Drain the in-flight requests, bounded.
    const drained = await settleWithin(
      options.lifecycle.whenIdle(),
      options.drainTimeoutMs,
    );

    if (!drained) {
      options.logger.error(
        `The drain timed out after ${options.drainTimeoutMs}ms: exiting with an error`,
      );
    }

    // 4. Close the database and flush the logs.
    try {
      await options.closeDatabase();
    } catch (error) {
      options.logger.error(error, "Failed to close the database");
    }

    try {
      await options.flushLogs();
    } catch (error) {
      options.logger.error(error, "Failed to flush the logs");
    }

    // 5. Exit: 0 on a clean drain, non-zero when it timed out.
    options.exit(drained ? 0 : 1);
  };

  const onSignal = (signal: ShutdownSignal) => {
    void shutdown(signal);
  };

  return {
    shutdown,
    isShuttingDown: () => shuttingDown,
    install: () => {
      process.on("SIGTERM", onSignal);
      process.on("SIGINT", onSignal);
    },
    uninstall: () => {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    },
  };
};
