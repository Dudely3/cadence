// Core data types shared across the harness. Provider-agnostic by design — the
// Anthropic-specific translation lives entirely in @cadence/model-anthropic.

/**
 * A completion status the agent may declare via the core `complete` tool —
 * the AvailableCompletionStatuses pattern: completion is a status, not a
 * boolean, and status values are what let sessions chain into workflows.
 */
export interface CompletionStatus {
  value: string;
  /** Shown to the model in the complete tool's description. */
  description?: string;
  /** Whether ending with this status counts as success in RunResult. */
  isSuccess: boolean;
}

/** A natural-language objective for one run. */
export interface Goal {
  id: string;
  description: string;
  /** Optional, folded into the system prompt; accuracy's critic leans on it. */
  successCriteria?: string;
  /** Statuses the complete tool accepts. Default: success/failure. */
  completionStatuses?: CompletionStatus[];
}

/** What the agent perceives. `summary` is model-facing; `raw` is structured detail. */
export interface Observation {
  summary: string;
  raw?: unknown;
}

/** Result of executing one tool against the environment. */
export interface ActionResult {
  ok: boolean;
  observation: Observation;
  error?: string;
  /** Set true when this action means the goal is complete (the `complete` tool). */
  done?: boolean;
  /** The status the agent declared when completing (see CompletionStatus). */
  completionStatus?: string;
  /**
   * Provenance the TOOL reports for the args it just executed — the tool is
   * the one that knows an arg was an element handle or a timestamp. The loop
   * copies these onto the recorded Action; replay re-resolves them live.
   */
  argSources?: Record<string, ArgSource>;
}

/**
 * Provenance for a captured arg, so replay knows what to re-resolve against the
 * live world vs. reuse literally. Populated by TOOLS (BrowserEnv's element-id
 * args are the main producer) and consumed by replayMode. See DESIGN.md §6.
 */
export type ArgSource =
  | { kind: "literal" }
  | { kind: "dom"; selector: string }
  | { kind: "now" }
  | { kind: "fromTurn"; turn: number; path: string };

/** Reasoning depth knob — Opus 4.6+/Sonnet 4.6 only. NOT supported on Haiku. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Token accounting for one model round-trip. */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// --- Neutral message representation -----------------------------------------
// A small content-block union the loop and context builder speak. The model
// client translates these to/from the provider wire format. `cache` marks a
// block as a prompt-cache breakpoint anchor (DESIGN.md §6.1).

export type ContentBlock =
  | { type: "text"; text: string; cache?: boolean }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean; cache?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** Per-run mutable state threaded through the loop. */
export interface RunContext {
  goal: Goal;
  step: number;
  scratch: Record<string, unknown>;
}

/**
 * How a run ended. Only `completed` counts as success.
 *
 * The distinction that matters: `stopped` means the model quit talking without
 * ever signalling done. That used to be recorded as a success, which made the
 * Success column of the comparison table a lie. A run that gives up is not a
 * run that succeeded.
 */
export type RunOutcome =
  /** An action signalled done — the agent claims the goal is met. */
  | "completed"
  /** The model stopped calling tools without signalling done. Gave up. */
  | "stopped"
  /** Ran out of step budget. */
  | "max_steps"
  /** Unrecoverable failure (model or environment). See `error`. */
  | "error";

/** What the loop returns. The serialized `session` is also the replay artifact. */
export interface RunResult {
  /** True when `outcome === "completed"` with a success-mapped status. */
  success: boolean;
  outcome: RunOutcome;
  /** The status declared via the complete tool, when the run completed. */
  completionStatus?: string;
  /** Present when `outcome === "error"`. */
  error?: string;
  steps: number;
  finalObservation: Observation;
  totals: {
    wallMs: number;
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
}
