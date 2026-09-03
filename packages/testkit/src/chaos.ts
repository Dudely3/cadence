import type {
  ActionResult,
  Environment,
  ModelClient,
  ModelRequest,
  ModelResult,
  RunContext,
  Tool,
  Usage,
} from "@cadence/core";

/**
 * Deliberate failure injection. Wrap a ModelClient or an Environment, name a
 * fault and a step, and watch what the loop does.
 *
 * The point is not robustness for its own sake — it is finding out which
 * failures the loop already absorbs and which ones end the run, before a room
 * full of people finds out with you.
 */

/** Thrown by model-side faults. Shaped like an SDK error so retry logic can key on `status`. */
export class SimulatedApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type: string,
  ) {
    super(message);
    this.name = "SimulatedApiError";
  }
}

/** Thrown by environment-side faults. Playwright throws things like this constantly. */
export class SimulatedEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatedEnvError";
  }
}

export type ModelFault =
  /** HTTP 429. Unhandled today: propagates out of run() and kills the process. */
  | "rateLimit"
  /** HTTP 529 overloaded. Same path as rateLimit, different status. */
  | "overloaded"
  /** No response, no error, no timeout configured. The worst one to hit live. */
  | "hang"
  /** Model names a tool that does not exist. agent.ts:76 handles this — verify it recovers. */
  | "unknownTool"
  /** Model calls a real tool with junk args. agent.ts:86 handles this — verify it recovers. */
  | "invalidArgs"
  /** Text with no tool calls. Triggers the optimistic success path at agent.ts:65. */
  | "bareText";

export interface ModelChaosSpec {
  /** Which decide() call to fault, zero-indexed. Accepts several. */
  at: number | number[];
  inject: ModelFault;
  /** How long "hang" hangs. Default 60s — long enough to feel like forever on stage. */
  hangMs?: number;
}

export type EnvFault =
  /** observe() throws. Page crashed, or the WebAudio context got suspended. */
  | "throwOnObserve"
  /** A tool's execute() throws. agent.ts:98 is unguarded — this ends the run. */
  | "throwOnExecute";

export interface EnvChaosSpec {
  /** Which call to fault, zero-indexed. Counts observe() calls or execute() calls
   *  depending on `inject` — the two are counted separately. */
  at: number | number[];
  inject: EnvFault;
}

function hits(at: number | number[], n: number): boolean {
  return Array.isArray(at) ? at.includes(n) : at === n;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function zeroUsage(): Usage {
  return { model: "chaos", inputTokens: 0, outputTokens: 0 };
}

/**
 * Wrap a ModelClient so it fails in a chosen way at a chosen step.
 * Counts its own decide() calls, which track ctx.step one-for-one.
 */
export function chaos(inner: ModelClient, spec: ModelChaosSpec): ModelClient {
  let n = -1;

  return {
    async decide(req: ModelRequest): Promise<ModelResult> {
      n += 1;
      if (!hits(spec.at, n)) return inner.decide(req);

      switch (spec.inject) {
        case "rateLimit":
          throw new SimulatedApiError("rate_limit_error: too many requests", 429, "rate_limit_error");

        case "overloaded":
          throw new SimulatedApiError("overloaded_error: API temporarily overloaded", 529, "overloaded_error");

        case "hang":
          await sleep(spec.hangMs ?? 60_000);
          return inner.decide(req);

        case "unknownTool": {
          const id = `chaos_${n}`;
          const name = "scroll_element";
          return {
            thought: "Let me scroll to see the rest.",
            toolUses: [{ id, name, input: {} }],
            assistantBlocks: [
              { type: "text", text: "Let me scroll to see the rest." },
              { type: "tool_use", id, name, input: {} },
            ],
            stopReason: "tool_use",
            usage: zeroUsage(),
          };
        }

        case "invalidArgs": {
          // Target a tool that really exists, but violate its schema.
          const target = req.tools[0];
          if (!target) return inner.decide(req);
          const id = `chaos_${n}`;
          const input = { wrong_field: 12345 };
          return {
            thought: "",
            toolUses: [{ id, name: target.name, input }],
            assistantBlocks: [{ type: "tool_use", id, name: target.name, input }],
            stopReason: "tool_use",
            usage: zeroUsage(),
          };
        }

        case "bareText": {
          const text = "I think that covers it.";
          return {
            thought: text,
            toolUses: [],
            assistantBlocks: [{ type: "text", text }],
            stopReason: "end_turn",
            usage: zeroUsage(),
          };
        }
      }
    },
  };
}

/**
 * Wrap an Environment so it fails in a chosen way at a chosen call.
 *
 * Note on `throwOnObserve`: the loop calls env.observe() exactly ONCE, before
 * the first turn (agent.ts:37) — it never re-observes, relying on tool results
 * to carry new state instead. So `at: 0` is the only observe fault that fires.
 * That divergence from DESIGN.md §4 is worth a decision, not just a workaround.
 */
export function chaosEnv(inner: Environment, spec: EnvChaosSpec): Environment {
  let observeN = -1;
  let executeN = -1;

  const wrapped: Environment = {
    name: `${inner.name}+chaos`,

    async observe() {
      observeN += 1;
      if (spec.inject === "throwOnObserve" && hits(spec.at, observeN)) {
        throw new SimulatedEnvError(`observe() failed (call ${observeN}): environment is gone`);
      }
      return inner.observe();
    },

    availableTools(): Tool[] {
      return inner.availableTools().map((t): Tool => ({
        ...t,
        execute: async (env: Environment, args: unknown, ctx: RunContext): Promise<ActionResult> => {
          executeN += 1;
          if (spec.inject === "throwOnExecute" && hits(spec.at, executeN)) {
            throw new SimulatedEnvError(
              `${t.name}() failed (call ${executeN}): Timeout 30000ms exceeded waiting for selector`,
            );
          }
          return t.execute(env, args, ctx);
        },
      }));
    },
  };

  if (inner.systemHint) wrapped.systemHint = () => inner.systemHint!();
  if (inner.reset) wrapped.reset = () => inner.reset!();
  if (inner.dispose) wrapped.dispose = () => inner.dispose!();

  return wrapped;
}
