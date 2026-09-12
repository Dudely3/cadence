import { OPERATING_GUIDE } from "./operating-guide";
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

/**
 * Header on a state block that was frozen into history (freezeState). It is
 * real prompt text the model reads, and it is also how the context viewer
 * recognises these blocks — derived from the wire, not a side channel.
 */
export const FROZEN_STATE_PREFIX = "PAGE STATE (turn ";

export function renderFrozenState(turnIndex: number, summary: string): string {
  return `${FROZEN_STATE_PREFIX}${turnIndex}):\n${summary}`;
}

const BASE_SYSTEM = `You are Cadence, an autonomous agent that accomplishes a goal by calling tools against an environment.
Work in small steps: inspect the current state, call exactly the tool you need, observe the result, repeat.
When the goal is fully accomplished, call the complete tool with an appropriate status. Do not narrate excessively.`;

/**
 * Compose a system prompt: base + operating guide + optional mode preamble +
 * environment hint. A library function modes call from their system() hook —
 * the loop never composes a prompt itself.
 *
 * Order is deliberate: the two constants first, then the parts that vary by
 * goal, mode and environment. The whole system block sits inside one cache
 * segment, so internal order does not change what caches — but it keeps the
 * bytes that never change at the front, where a reader looking for the stable
 * prefix expects them.
 *
 * The operating guide is what carries this prefix over the model's minimum
 * cacheable length; see operating-guide.ts for why that is the reason it is
 * long, and `npm run floor` for checking it still does.
 */
export function composeSystem(
  goal: Goal,
  env: Environment,
  preamble?: string,
): string {
  const parts = [BASE_SYSTEM, OPERATING_GUIDE];
  if (goal.successCriteria)
    parts.push(`Success criteria: ${goal.successCriteria}`);
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
export function buildMessages(
  session: Session,
  opts: { tail?: string; state?: string } = {},
): Message[] {
  // Solo-style placement by default: the goal message carries only the goal,
  // state is NEVER frozen into history but arrives via the volatile tail,
  // fresh each turn (renderStateTail), and frozen turns hold brief outcomes.
  // session.contextShape can ask for the other shape — see ContextShape.
  const shape = session.contextShape ?? {};
  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Goal: ${session.goal.description}`,
          // A breakpoint HERE, and not only on the system block, because
          // declaring tools makes the API inject a fixed ~317-token tool-use
          // preamble that lands after the system prompt — outside the reach of
          // a cache line on it. Measured on claude-haiku-4-5 with a system-only
          // breakpoint: 7 tokens billed fresh with no tools declared, and
          // exactly 324 with 1, 4 or 12 of them.
          //
          // Without this, turn 0 pays that preamble at full price and turn 1
          // pays it again as cache write when the history breakpoint finally
          // reaches below it. Measured over three turns with 14 tools: 354
          // fresh on turn 0 and a 414-token write on turn 1, against 20 and 80
          // with this line — 302 base tokens per run, for one flag.
          //
          // The goal is the right anchor because it is the last thing in the
          // prompt that cannot change during a run. Everything after it is
          // history, which grows, or the volatile tail, which is replaced.
          //
          // Opt-in (ContextShape.goalCache), set by the loop on every new run:
          // this same function redraws old recordings in the viewer, and a
          // default-on flag would show them a cache line they never sent.
          ...(shape.goalCache ? { cache: true } : {}),
        },
      ],
    },
  ];

  const closed = session.turns.filter((t) => t.closed);
  closed.forEach((turn, i) => {
    const isLast = i === closed.length - 1;
    // freezeState: the state the model saw when it decided this turn, kept in
    // history forever. It goes in BEFORE the assistant message that answered
    // it — where it was actually sent — and never moves again. That ordering
    // is what makes the request append-only: every later request is a strict
    // extension of this one, so a breakpoint anywhere still matches. Fold it
    // in after the results instead and the bytes shift every turn, which
    // silently breaks the prefix match (measured: cache read 0 on every turn).
    if (shape.freezeState && turn.stateAt !== undefined) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: renderFrozenState(turn.index, turn.stateAt) },
        ],
      });
    }
    messages.push({ role: "assistant", content: turn.assistantBlocks });
    const results: ContentBlock[] = turn.toolResults.map((b) => ({ ...b }));
    if (results.length > 0) {
      // Anchor a cache breakpoint on the last block of the most recent turn.
      if (isLast && shape.cacheAt !== "end") {
        const tail = results[results.length - 1];
        if (tail) (tail as ContentBlock & { cache?: boolean }).cache = true;
      }
      messages.push({ role: "user", content: results });
    }
  });

  // freezeState's current state — the trailing message this turn, and it stays
  // exactly here once the turn closes and the loop above emits it.
  if (shape.freezeState && opts.state !== undefined) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: renderFrozenState(closed.length, opts.state) },
      ],
    });
  }

  // Volatile tail — current state, critic feedback, steering — appended AFTER
  // the breakpoint so the frozen prefix still hits the cache (the Solo
  // observations pattern: per-turn content lives past the cache line, never
  // inside it). Callers that send a tail should also record it on the open
  // turn (turn.tail) so the trace stays complete.
  if (opts.tail) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: opts.tail }],
    });
  }

  // "Cache everything": the breakpoint rides the very last block, wherever
  // that turned out to be.
  if (shape.cacheAt === "end") {
    const last = messages[messages.length - 1]?.content;
    const block = last?.[last.length - 1];
    if (block) (block as ContentBlock & { cache?: boolean }).cache = true;
  }

  return messages;
}
