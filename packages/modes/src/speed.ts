import { buildMessages, composeSystem, renderStateTail } from "@cadence/core";
import type { ExecutionMode } from "@cadence/core";

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

    decide: ({ session, tools, model: client, observation }) => {
      // Solo-style: current state rides the volatile tail, replaced per turn.
      const tail = renderStateTail(observation);
      const openTurn = session.turns[session.turns.length - 1];
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
