import type { Goal, Observation, RunContext } from "./types";
import type { Environment } from "./environment";
import type { ToolRegistry } from "./tool";
import type { ModelClient, ModelResult } from "./model";
import type { Session } from "./turn";

/**
 * The speed/accuracy/replay knob — a POLICY object, not a config bag.
 *
 * Division of labor:
 *   - The LOOP owns turn bookkeeping: observe, validate, execute, trace,
 *     outcome semantics, the step budget.
 *   - The MODE owns the decision: how the next action is produced. Live modes
 *     compose the prompt (via the shared buildMessages/composeSystem library)
 *     and call the model; replay reads the recorded session and never builds
 *     a prompt at all — which is why the loop must not pre-build a request.
 *
 * Model tier, token budget, thinking, and effort are implementation details of
 * a mode's decide(), invisible to the loop and to this interface.
 *
 * Retry is not an interface concern either: a failed
 * tool call comes back to the model as an observation, and how many
 * consecutive failures a mode tolerates before steering toward
 * completion-with-failure is private policy, kept in ctx.scratch.
 */

/** Everything a mode can reach. The loop passes the same deps to every hook. */
export interface ModeDeps {
  goal: Goal;
  env: Environment;
  tools: ToolRegistry;
  model: ModelClient;
  ctx: RunContext;
}

export interface DecideInput extends ModeDeps {
  /** The trace so far. Live modes render it with buildMessages; replay walks it. */
  session: Session;
  /** The latest observation (initial before turn 0, last action result after). */
  observation: Observation;
}

/**
 * What this turn's request will carry beyond the frozen prefix — composed
 * BEFORE the model is called, so the trace describes the request while it is
 * still pending.
 *
 * This exists for one reason: a stepped run pauses before the model call, and
 * at that pause the whole request should be on screen. If the mode only
 * composes its volatile content on the way into client.decide(), the trace at
 * the pause has an open turn with nothing in it, and the viewer can only draw
 * the frozen prefix — you find out what you were about to send by sending it.
 */
export interface PendingRequest {
  /** Volatile tail: sent after the last cache breakpoint, replaced each turn. */
  tail?: string;
  /** Full state frozen into history (freezeState shapes — see ContextShape). */
  stateAt?: string;
  /** A critic verdict produced while composing (accuracy mode). */
  critic?: { ok: boolean; feedback?: string };
}

export interface ExecutionMode {
  name: string;
  maxSteps: number;

  /**
   * Optional one-time setup before the first turn — accuracy mode plans here,
   * stashing the plan in ctx.scratch so system() can bake it into the cached
   * prefix (settled decision #3). Receives the session so aux model calls can
   * record their usage (session.auxUsage) and may register mode-owned tools
   * via tools.register() — both happen before the trace freezes its statics.
   */
  prepare?(input: ModeDeps & { observation: Observation; session: Session }): Promise<void>;

  /**
   * Compose the system prompt. Called once after prepare() and recorded into
   * the Session; decide() should read it back from session.system so the
   * trace and the wire can never diverge.
   */
  system(input: { goal: Goal; env: Environment; ctx: RunContext }): string;

  /**
   * Optional: compose this turn's volatile content without calling the model.
   * The loop calls this right after opening the turn, records the result on
   * the turn and flushes the trace — so a stepped run can show the entire
   * request at the pause, and any aux calls this makes (accuracy's critic) are
   * recorded before the decision rather than during it.
   *
   * MUST be idempotent: decide() runs straight afterwards and asks for the
   * same content, so an implementation memoises onto the open turn rather than
   * composing (and re-calling a model) twice.
   */
  composeTurn?(input: DecideInput): Promise<PendingRequest>;

  /** Produce this turn's decision — the model call (or trace read) lives here. */
  decide(input: DecideInput): Promise<ModelResult>;
}
