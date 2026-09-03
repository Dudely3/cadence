import type { ContentBlock, Goal, ActionResult, ArgSource, Observation, Usage } from "./types";
import type { ToolDef } from "./tool";

// Session → Turn → Action. The single structure behind both replay and
// incremental prompt-caching. See DESIGN.md §3.7.

/** A single tool call within a Turn. `id` is stable so replay can match by identity. */
export interface Action {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Which args re-resolve on replay, and how (Phase 4). */
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
export interface Session {
  id: string;
  goal: Goal;
  mode: string;
  turns: Turn[];
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
