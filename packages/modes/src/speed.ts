import { buildMessages, composeSystem, renderStateTail } from "@cadence/core";
import type { DecideInput, ExecutionMode, PendingRequest } from "@cadence/core";

export interface SpeedModeOptions {
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
}

/**
 * Speed mode: Haiku, no planning, no critic, no thinking, low step budget.
 * Fastest path to "probably right".
 *
 * decide() reads the system prompt and tool schemas back off the session —
 * the recorded trace and the wire are the same bytes by construction.
 *
 * Note: NO effort parameter — Haiku 4.5 rejects it (400), so speed mode never
 * sets one.
 */
export function speedMode(opts: SpeedModeOptions = {}): ExecutionMode {
  const model = opts.model ?? "claude-haiku-4-5";
  const maxTokens = opts.maxTokens ?? 2048;

  return {
    name: "speed",
    maxSteps: opts.maxSteps ?? 8,

    system: ({ goal, env }) => composeSystem(goal, env),

    // Solo-style: current state rides the volatile tail, replaced per turn.
    // Composed here rather than on the way into the model call so the loop can
    // record it first — that is what a stepped pause has to show. Idempotent:
    // if the turn already carries a tail, reuse it.
    composeTurn: ({
      session,
      observation,
    }: DecideInput): Promise<PendingRequest> => {
      const openTurn = session.turns[session.turns.length - 1];
      const tail = openTurn?.tail ?? renderStateTail(observation);
      return Promise.resolve({ tail });
    },

    decide: ({ session, tools, model: client, observation }) => {
      const openTurn = session.turns[session.turns.length - 1];
      // The loop composed and recorded this already; falling back keeps the
      // mode usable on its own (tests, compare.ts).
      const tail = openTurn?.tail ?? renderStateTail(observation);
      if (openTurn) openTurn.tail = tail;

      return client.decide({
        system: session.system ?? "",
        messages: buildMessages(session, { tail }),
        tools: session.tools ?? tools.toModelSchema(),
        model,
        maxTokens,
        // thinking + effort intentionally omitted
      });
    },
  };
}
