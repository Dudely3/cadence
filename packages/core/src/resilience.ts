import type { ModelClient, ModelRequest, ModelResult } from "./model";

/**
 * Retry and timeout, as ModelClient decorators.
 *
 * These are decorators rather than loop code on purpose: DESIGN.md §2 says the
 * loop never changes. Composing `withRetry(withTimeout(client))` keeps transport
 * concerns out of agent.ts, and mirrors how chaos() wraps the same seam.
 *
 * Note on metrics: a retried 429 is not billed, so retries do not distort the
 * token columns of the comparison table. They do cost wall-clock, which is
 * already measured. `onRetry` is there if you want to surface them anyway.
 */

export class ModelTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Model call exceeded ${timeoutMs}ms`);
    this.name = "ModelTimeoutError";
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 429, 408, 409 and any 5xx are transient. So is our own timeout. */
export function isTransient(err: unknown): boolean {
  if (err instanceof ModelTimeoutError) return true;
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== "number") return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export interface RetryOptions {
  /** Total attempts including the first. Default 4. */
  maxAttempts?: number;
  /** First backoff delay; doubles each attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Ceiling on a single backoff delay. Default 8s. */
  maxDelayMs?: number;
  /** Override which errors are worth retrying. */
  retryOn?: (err: unknown) => boolean;
  /** Observe retries — useful for the live dashboard, or just to see them happen. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Retry transient model failures with exponential backoff and jitter. */
export function withRetry(inner: ModelClient, opts: RetryOptions = {}): ModelClient {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8_000;
  const retryOn = opts.retryOn ?? isTransient;

  return {
    async decide(req: ModelRequest): Promise<ModelResult> {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await inner.decide(req);
        } catch (err) {
          lastError = err;
          if (attempt === maxAttempts || !retryOn(err)) throw err;

          const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
          // Jitter avoids a fleet of agents retrying in lockstep.
          const delayMs = Math.round(backoff * (0.5 + Math.random() * 0.5));
          opts.onRetry?.({ attempt, delayMs, error: err });
          await sleep(delayMs);
        }
      }

      throw lastError;
    },
  };
}

/**
 * Fail a model call that takes too long.
 *
 * On stage this is the difference between an error you can talk over and a
 * blinking cursor you cannot. Pair with withRetry so a slow call becomes a
 * retried call rather than a dead run.
 */
export function withTimeout(inner: ModelClient, timeoutMs: number): ModelClient {
  return {
    async decide(req: ModelRequest): Promise<ModelResult> {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ModelTimeoutError(timeoutMs));
        }, timeoutMs);
      });

      try {
        return await Promise.race([inner.decide(req), deadline]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export interface ResilientOptions extends RetryOptions {
  /** Per-attempt deadline. Default 90s — generous enough for Opus with high effort. */
  timeoutMs?: number;
}

/** The stack you almost always want: retry around a per-attempt timeout. */
export function resilient(inner: ModelClient, opts: ResilientOptions = {}): ModelClient {
  const { timeoutMs = 90_000, ...retry } = opts;
  return withRetry(withTimeout(inner, timeoutMs), retry);
}
