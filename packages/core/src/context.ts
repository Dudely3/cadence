import type { Goal, Message, ContentBlock, Observation } from "./types";
import type { Session } from "./turn";
import type { Environment } from "./environment";

/**
 * Render the fresh per-turn state block for the volatile tail — Solo's
 * placement discipline: current state is REPLACED every turn and always sits
 * after the last cache breakpoint, so the frozen prefix stays byte-stable
 * while the model still sees the latest world.
 */
export function renderStateTail(observation: Observation): string {
  return `CURRENT STATE (fresh this turn — supersedes any state mentioned earlier):\n${observation.summary}`;
}

const BASE_SYSTEM = `You are Cadence, an autonomous agent that accomplishes a goal by calling tools against an environment.
Work in small steps: inspect the current state, call exactly the tool you need, observe the result, repeat.
When the goal is fully accomplished, call the complete tool with an appropriate status. Do not narrate excessively.`;

/**
 * Compose a system prompt: base + optional mode preamble + environment hint.
 * A library function modes call from their system() hook — the loop never
 * composes a prompt itself (PLAN.md, settled decision #2).
 */
export function composeSystem(goal: Goal, env: Environment, preamble?: string): string {
  const parts = [BASE_SYSTEM];
  if (goal.successCriteria) parts.push(`Success criteria: ${goal.successCriteria}`);
  if (preamble) parts.push(preamble);
  const hint = env.systemHint?.();
  if (hint) parts.push(`Environment (${env.name}):\n${hint}`);
  return parts.join("\n\n");
}

/**
 * Build the Messages array from a Session. Each closed Turn expands to an
 * (assistant, tool_result) pair — the same turns Replay walks. A cache
 * breakpoint is anchored on the most recent closed turn boundary so the
 * growing prefix stays warm.
 *
 * The Session is the ONLY input: goal and initial observation are read off it
 * (see Session — the trace is a complete account of what the model saw). This
 * is what lets the context viewer render the exact request for any turn N by
 * calling this same function over `{...session, turns: session.turns.slice(0, N)}`
 * — one renderer, no drift.
 */
export function buildMessages(session: Session, opts: { tail?: string } = {}): Message[] {
  // Solo-style placement: the goal message carries only the goal. State is
  // NEVER frozen into history — it arrives via the volatile tail, fresh each
  // turn (see renderStateTail). Frozen turns hold brief outcomes only.
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: `Goal: ${session.goal.description}` }],
    },
  ];

  const closed = session.turns.filter((t) => t.closed);
  closed.forEach((turn, i) => {
    const isLast = i === closed.length - 1;
    messages.push({ role: "assistant", content: turn.assistantBlocks });
    if (turn.toolResults.length > 0) {
      const results = turn.toolResults.map((b) => ({ ...b }));
      // Anchor a cache breakpoint on the last block of the most recent turn.
      if (isLast) {
        const tail = results[results.length - 1];
        if (tail) (tail as ContentBlock & { cache?: boolean }).cache = true;
      }
      messages.push({ role: "user", content: results });
    }
  });

  // Volatile tail — critic feedback, steering — appended AFTER the breakpoint
  // so the frozen prefix still hits the cache (the Solo observations pattern:
  // per-turn content lives past the cache line, never inside it). Callers that
  // send a tail should also record it on the open turn (turn.tail) so the
  // trace stays complete.
  if (opts.tail) {
    messages.push({ role: "user", content: [{ type: "text", text: opts.tail }] });
  }

  return messages;
}
