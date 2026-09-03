import type { ContentBlock, Effort, Message, Usage } from "./types";
import type { ToolDef } from "./tool";

/** A tool call the model decided to make. */
export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** How the model may use tools this round-trip. */
export type ToolChoice =
  | { type: "auto" }
  | { type: "any" }
  /** Force a specific tool — structured output without JSON-in-text parsing. */
  | { type: "tool"; name: string };

/** One decision request: everything the model needs for a single round-trip. */
export interface ModelRequest {
  system?: string;
  messages: Message[];
  tools: ToolDef[];
  model: string;
  maxTokens: number;
  /** Adaptive thinking, when the mode wants it. Omit for speed. */
  thinking?: "adaptive";
  /** Reasoning depth. Omit on Haiku (unsupported — would 400). */
  effort?: Effort;
  /** Default auto. Forced tool calls pair with omitted thinking. */
  toolChoice?: ToolChoice;
}

export interface ModelResult {
  /** Concatenated text the model emitted (rationale / narration). */
  thought: string;
  toolUses: ToolUse[];
  /** Neutral representation of the assistant response, stored on the Turn. */
  assistantBlocks: ContentBlock[];
  stopReason: string | null;
  usage: Usage;
}

/**
 * A single decision turn. Implementations translate the neutral request to a
 * provider call and back. The loop owns turn structure; this is just the call.
 */
export interface ModelClient {
  decide(req: ModelRequest): Promise<ModelResult>;
}
