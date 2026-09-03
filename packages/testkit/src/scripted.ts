import type {
  ContentBlock,
  ModelClient,
  ModelRequest,
  ModelResult,
  ToolUse,
  Usage,
} from "@cadence/core";

/**
 * A ModelClient that returns canned turns instead of calling the API.
 *
 * Three uses, in ascending order of importance:
 *   1. Run the loop instantly and for free while you poke at it.
 *   2. Make the loop testable at all (deterministic tool-use ids, zero tokens).
 *   3. It is structurally most of ReplayMode — a decide() that reads a recorded
 *      script instead of asking a model, with a live fallback once the script
 *      runs out (DESIGN.md §6 warm-start). Build this, and Phase 4 is mostly a
 *      question of where the script comes from.
 */

export interface ScriptedCall {
  name: string;
  input?: Record<string, unknown>;
}

/** One scripted turn. No `calls` => text-only, which the loop reads as "done". */
export interface ScriptStep {
  thought?: string;
  calls?: ScriptedCall[];
}

export function call(name: string, input: Record<string, unknown> = {}): ScriptedCall {
  return { name, input };
}

/** A turn that thinks, then calls one or more tools. */
export function step(thought: string, ...calls: ScriptedCall[]): ScriptStep {
  return { thought, calls };
}

/** A turn that only talks. The loop treats this as the model being finished. */
export function say(thought: string): ScriptStep {
  return { thought };
}

export interface ScriptedOptions {
  /**
   * Artificial per-call latency. Real model calls take seconds; a script
   * returns instantly. Set this when rehearsing so you practise narrating over
   * think-time instead of being surprised by it on stage.
   */
  delayMs?: number;
  /**
   * Where to go when the script runs out. With a fallback, the run replays the
   * script and then continues live from that point — exactly the warm-start
   * behaviour Replay mode needs. Without one, the run simply stops.
   */
  fallback?: ModelClient;
}

/** Scripted turns cost nothing. This is also the shape of Replay's metrics row. */
function zeroUsage(): Usage {
  return { model: "scripted", inputTokens: 0, outputTokens: 0 };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class ScriptedModelClient implements ModelClient {
  private index = 0;

  constructor(
    private readonly script: ScriptStep[],
    private readonly opts: ScriptedOptions = {},
  ) {}

  /** How many scripted turns have been consumed so far. */
  get consumed(): number {
    return this.index;
  }

  /** True once the script is spent — i.e. the run has gone live (or stopped). */
  get exhausted(): boolean {
    return this.index >= this.script.length;
  }

  async decide(req: ModelRequest): Promise<ModelResult> {
    const current = this.script[this.index];

    if (!current) {
      if (this.opts.fallback) return this.opts.fallback.decide(req);
      return {
        thought: "Script exhausted.",
        toolUses: [],
        assistantBlocks: [{ type: "text", text: "Script exhausted." }],
        stopReason: "end_turn",
        usage: zeroUsage(),
      };
    }

    const stepIndex = this.index;
    this.index += 1;

    if (this.opts.delayMs) await sleep(this.opts.delayMs);

    const thought = current.thought ?? "";
    const calls = current.calls ?? [];
    const assistantBlocks: ContentBlock[] = [];
    const toolUses: ToolUse[] = [];

    if (thought) assistantBlocks.push({ type: "text", text: thought });

    calls.forEach((c, i) => {
      // Deterministic ids: same script => same trace bytes, which is what makes
      // scripted runs comparable and cache prefixes stable.
      const id = `scripted_${stepIndex}_${i}`;
      const input = c.input ?? {};
      toolUses.push({ id, name: c.name, input });
      assistantBlocks.push({ type: "tool_use", id, name: c.name, input });
    });

    return {
      thought,
      toolUses,
      assistantBlocks,
      stopReason: calls.length > 0 ? "tool_use" : "end_turn",
      usage: zeroUsage(),
    };
  }
}
