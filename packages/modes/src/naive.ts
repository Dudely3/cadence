import { buildMessages, composeSystem } from "@cadence/core";
import type { DecideInput, ExecutionMode, PendingRequest } from "@cadence/core";

/**
 * Naive mode: a chatbot loop pressed into service as an agent. Deliberately
 * the wrong shape, and here to be measured against — it is rung 1 of the
 * context ladder (examples/ladder.ts), not a mode anyone should ship.
 *
 * What it does that speed mode doesn't:
 *
 *   1. FREEZES the full observation into history. Every turn appends the whole
 *      page state as a message and never removes it, so turn N carries N
 *      copies of the page — most of them stale, all of them re-sent.
 *   2. Puts the cache breakpoint at the very END, on the last block. "Cache
 *      everything" sounds thrifty and is: the append-only prefix does get
 *      reused. The problem was never the cache — it's what's being cached.
 *   3. Never re-observes into a volatile tail. There is no tail; nothing ever
 *      falls out of the context.
 *
 * The failure this produces is not an error. It is a run that still works,
 * costs several times more, gets slower every turn, and hands the model a
 * pile of contradictory page snapshots to choose between.
 */

export interface NaiveModeOptions {
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
}

const PREAMBLE = `Each turn you are given the page state again. Earlier states in this conversation may be out of date; prefer the most recent one.`;

export function naiveMode(opts: NaiveModeOptions = {}): ExecutionMode {
  const model = opts.model ?? "claude-haiku-4-5";
  const maxTokens = opts.maxTokens ?? 2048;

  return {
    name: "naive",
    maxSteps: opts.maxSteps ?? 8,

    // The shape is DATA on the session, not private knowledge in this file:
    // buildMessages reads it and so does the context viewer, so what is drawn
    // is what was sent. Recorded in prepare(), before the trace freezes.
    prepare: ({ session }) => {
      // Merge, don't replace: the loop stamps goalCache on every new session and
      // a wholesale assignment would quietly drop it.
      session.contextShape = { ...session.contextShape, freezeState: true, cacheAt: "end" };
      return Promise.resolve();
    },

    system: ({ goal, env }) => composeSystem(goal, env, PREAMBLE),

    // Freeze this turn's state onto the turn, before the model call, so the
    // request is fully described while it is still pending. It will still be
    // here on every later request, which is the whole problem — and it is what
    // makes the trace a complete account of what was sent.
    composeTurn: ({
      session,
      observation,
    }: DecideInput): Promise<PendingRequest> => {
      const openTurn = session.turns[session.turns.length - 1];
      return Promise.resolve({
        stateAt: openTurn?.stateAt ?? observation.summary,
      });
    },

    decide: ({ session, tools, model: client, observation }) => {
      const openTurn = session.turns[session.turns.length - 1];
      const state = openTurn?.stateAt ?? observation.summary;
      if (openTurn) openTurn.stateAt = state;

      const messages = buildMessages(session, { state });

      return client.decide({
        system: session.system ?? "",
        messages,
        tools: session.tools ?? tools.toModelSchema(),
        model,
        maxTokens,
      });
    },
  };
}
