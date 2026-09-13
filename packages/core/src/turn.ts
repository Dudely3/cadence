import type { ContentBlock, Goal, ActionResult, ArgSource, Observation, Usage } from "./types";
import type { ToolDef } from "./tool";

// Session → Turn → Action. The single structure behind both replay and
// incremental prompt-caching. See DESIGN.md §3.7.

/** A single tool call within a Turn. `id` is stable so replay can match by identity. */
export interface Action {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Which args re-resolve on replay, and how. See ArgSource. */
  argSources?: Record<string, ArgSource>;
  result?: ActionResult;
}

/**
 * One model round-trip: the model is invoked, returns a thought + 1..n tool
 * calls, those execute into results. Maps 1:1 to an (assistant message,
 * tool_result message) pair. FROZEN once closed — its bytes never change, which
 * is what makes the serialized prefix a stable cache segment.
 */
export interface Turn {
  index: number;
  thought?: string;
  actions: Action[];
  /** The model's response, neutral form (text + tool_use blocks). */
  assistantBlocks: ContentBlock[];
  /** The tool_result blocks produced by executing this turn's actions. */
  toolResults: ContentBlock[];
  closed: boolean;
  /** Eligible to anchor a cache breakpoint (set on close). */
  cacheable: boolean;
  /** Optional: replaces bulky tool results in the LIVE context once closed. */
  compacted?: { summary: string };
  /**
   * Accuracy mode: the critic's verdict on the PREVIOUS turn's results,
   * produced while deciding this turn. Recorded so the trace stays a complete
   * account (the viz and replay can reconstruct what the model saw).
   */
  critic?: { ok: boolean; feedback?: string };
  /**
   * Volatile text appended AFTER the cache breakpoint in this turn's request —
   * critic feedback, failure-budget steering. The Solo observations pattern:
   * per-turn content lands past the cache line so the frozen prefix survives.
   */
  tail?: string;
  /**
   * Full state frozen INTO history for this turn. Only set when the session's
   * contextShape says to freeze state (rung 1) — the entire point of the
   * Solo-style placement is that state never lands here. Recorded so the trace
   * stays a complete account of what was sent, and rendered by the SAME
   * buildMessages the loop uses, so the viewer draws a naive run correctly
   * without knowing anything about naive mode.
   */
  stateAt?: string;
  usage?: Usage;
  timing: { startedMs: number; durationMs: number };
}

/**
 * One full run toward a Goal.
 *
 * A Session is a COMPLETE account of what the model saw: goal, rendered system
 * prompt, tool schemas, initial observation, and every frozen turn. That is
 * what lets one serialized structure be three things at once — the live
 * context (buildMessages renders requests from it), the replay program, and
 * the visualization the context viewer draws.
 */
/**
 * How this session's requests are laid out — the part of prompt construction
 * that differs between modes, recorded as DATA on the session.
 *
 * This exists so there is still exactly one message builder. A mode that hand-
 * rolls its own messages puts the viewer (which can only call buildMessages)
 * one step behind the wire, and the first thing you notice is a block that was
 * sent but isn't drawn. Shape belongs in the trace, not in a second renderer.
 */
export interface ContextShape {
  /**
   * Freeze each turn's full state into history instead of re-observing into a
   * volatile tail. Rung 1 of the context ladder; nothing should ship this.
   */
  freezeState?: boolean;
  /**
   * Where the cache breakpoint goes. "last-turn" (default) anchors it on the
   * last closed turn, so the frozen prefix is stable and the fresh tail sits
   * past it. "end" is the "cache everything" instinct: the breakpoint rides
   * the very last block of the request.
   */
  cacheAt?: "last-turn" | "end";
  /**
   * Also anchor a breakpoint on the GOAL message, so the frozen prefix reaches
   * below the API's injected tool-use preamble.
   *
   * Declaring tools makes the API add a fixed ~317-token block of instructions
   * after the system prompt, which a cache line on the system block cannot
   * cover — measured on claude-haiku-4-5: 7 tokens billed fresh with no tools,
   * exactly 324 with 1, 4 or 12. Without this flag turn 0 pays it at full price
   * and turn 1 pays it again as cache write, once the history breakpoint
   * finally reaches past it. With it: 302 base tokens saved per run.
   *
   * OPT-IN, and set by the loop on every new run, because buildMessages is also
   * what the viewer replays recordings through. Defaulting it on would redraw
   * every trace recorded before it existed with a cache line that was never
   * sent — the one thing the anatomy pane must never do.
   */
  goalCache?: boolean;
  /**
   * How tool calls and their results are carried on the wire.
   *
   * "native" (the default, and what every recording before this field existed
   * used) sends the API's `tools` parameter and gets back `tool_use` blocks the
   * API pairs to `tool_result` blocks by id.
   *
   * "json-in-text" is the shape agents had before that parameter existed: the
   * tool catalogue is prose in the system prompt, the model answers with one
   * JSON blob of text, and history carries the harness's own paraphrase of what
   * happened instead of paired results. See legacy-format.ts and legacyMode.
   *
   * ADDITIVE BY CONSTRUCTION: undefined means native, so no session recorded
   * before this existed renders any differently.
   */
  toolProtocol?: "native" | "json-in-text";
}

/**
 * Hints for AUTHORED comparison traces only — the hand-written recordings that
 * illustrate a different architecture (a RAG chatbot, a legacy JSON-in-text
 * agent) so it can be put beside a real one in the viewer. A live run never
 * sets these.
 *
 * They exist because a Turn is shaped for an agent loop — assistant output,
 * then the results of the actions it took — and another architecture's turn
 * boundary can fall somewhere else. Rather than distort the drawing to fit, the
 * trace says which convention it is using.
 */
export interface SessionPresentation {
  /** No goal message: a chatbot's prompt is system → chat, and nothing else. */
  hideGoal?: boolean;
  /**
   * The user-side blocks recorded on a turn are the NEXT request's input, not
   * this turn's output.
   *
   * A chatbot turn is: user message (+ whatever was retrieved for it) goes in,
   * an answer comes out. An agent Turn is the other way round: the assistant
   * acts, then results come back. Encoding the former in the latter leaves the
   * next user message sitting in `toolResults`, where the viewer would draw it
   * under "what came back" — showing an input as an output.
   */
  resultsAreNextInput?: boolean;
}

export interface Session {
  id: string;
  goal: Goal;
  mode: string;
  turns: Turn[];
  /** Request layout for this run. Absent means the default Solo-style shape. */
  contextShape?: ContextShape;
  /** Drawing hints for authored comparison traces. Live runs never set this. */
  presentation?: SessionPresentation;
  /**
   * The named values this run was about — "the item is Titanium Tent Stakes".
   *
   * Recorded so a replay can be re-pointed at different ones: replay re-issues
   * the recorded calls, and anywhere a recorded value appears in an argument or
   * in a DOM selector it can be swapped for the new value. One paid run becomes
   * a program you can run again for a different input, with no model at all.
   *
   * Only meaningful if the values are distinctive enough to find unambiguously
   * in what the run did — see replayMode's `params` option.
   */
  params?: Record<string, string>;
  startedMs: number;
  /** Rendered system prompt, recorded before the first turn. */
  system?: string;
  /** Serialized tool definitions sent with every request. */
  tools?: ToolDef[];
  /** The observation the run opened with — part of the first user message. */
  initialObservation?: Observation;
  /**
   * Usage from model calls made OUTSIDE the decide loop — accuracy's planner
   * and per-step critic. Counted into RunResult totals so the money table is
   * honest about what a mode really costs.
   */
  auxUsage?: Usage[];
}
