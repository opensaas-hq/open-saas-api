/**
 * The lifecycle of the running process.
 *
 * It carries the state the HTTP surface and the shutdown controller must
 * share (§4.8): whether the process is draining, and how many requests are
 * still in flight. It is an injected object, not a module-level flag: the
 * app, the shutdown controller and the tests share the same instance
 * explicitly.
 */
export type Lifecycle = {
  /**
   * Flip the process into the draining state.
   *
   * Called first when a termination signal arrives: the readiness endpoint
   * must answer 503 **before** the connections stop being drained, so a load
   * balancer takes the instance out of rotation while the in-flight requests
   * are still served.
   */
  beginDrain: () => void;
  /** True while the process is draining. */
  isDraining: () => boolean;
  /** Register a request that started. */
  beginRequest: () => void;
  /** Register a request that finished. */
  endRequest: () => void;
  /**
   * Resolve once no request is in flight.
   *
   * Resolves immediately when the process is already idle. It never rejects:
   * the bounded wait belongs to the shutdown controller, which owns the
   * deadline.
   */
  whenIdle: () => Promise<void>;
};

/** Create a lifecycle whose drain state starts at "not draining". */
export const createLifecycle = (): Lifecycle => {
  let draining = false;
  let inFlight = 0;
  const idleWaiters: (() => void)[] = [];

  const settle = (): void => {
    if (inFlight > 0) return;
    for (const waiter of idleWaiters.splice(0)) waiter();
  };

  return {
    beginDrain: () => {
      draining = true;
    },
    isDraining: () => draining,
    beginRequest: () => {
      inFlight += 1;
    },
    endRequest: () => {
      inFlight = Math.max(0, inFlight - 1);
      settle();
    },
    whenIdle: async () => {
      if (inFlight === 0) return;
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };
};
