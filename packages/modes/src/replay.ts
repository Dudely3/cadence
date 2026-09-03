import { z } from "zod";
import { composeSystem } from "@cadence/core";
import type {
  Action,
  ActionResult,
  ContentBlock,
  DecideInput,
  ExecutionMode,
  ModelResult,
  Session,
  Tool,
  ToolRegistry,
  ToolUse,
  Usage,
} from "@cadence/core";

/**
 * Replay mode: no model. decide() walks a recorded Session turn by turn and
 * re-issues its tool calls — it never builds a prompt, which is exactly why
 * the loop doesn't pre-build one (settled decision #2).
 *
 * Param re-resolution is what separates this from brittle record-and-playback:
 * args tagged with an ArgSource recompute against the live world on every
 * replay; untagged args are reused literally.
 *
 *   - "literal"   → captured value, as-is
 *   - "now"       → current timestamp, recomputed
 *   - "fromTurn"  → read from THIS run's earlier replayed turn (a dot-path
 *                   into the turn object), so chained values stay live
 *   - "dom"/other → delegated to env.resolveArg() — the environment knows
 *                   how to re-read its own world
 *
 * Warm-start: when the trace runs out, an optional fallback mode takes over
 * live from that turn — replay turns 0..N, live from N+1.
 *
 * Mode-owned tools: a recording can contain calls to tools its MODE registered
 * rather than the environment (accuracy's `update_plan`). Replay doesn't run
 * that mode's prepare(), so those tools aren't in the registry, and the loop
 * would reject every such call as an unknown tool.
 *
 * Default policy is `skip`: drop those calls entirely. There is no plan state
 * in a replay to update, so the bookkeeping is meaningless the second time
 * around — and dropping it keeps the viz clean. A turn made up ENTIRELY of
 * skipped calls is skipped whole, because a turn with zero tool calls is how
 * the loop recognizes "the model stopped" and would end the run early.
 * `stub` keeps them instead, replaying each recorded result — pick that when
 * the replayed trace needs to mirror the recording turn for turn.
 */

export interface ReplayModeOptions {
  /** Take over live when the trace is exhausted. Omit → the run stops there. */
  fallback?: ExecutionMode;
  maxSteps?: number;
  /**
   * What to do with calls to tools the recording has but this run doesn't
   * (tools the recorded run's MODE registered, e.g. accuracy's update_plan).
   *   "skip" (default) — drop them; a turn of nothing but these is skipped too
   *   "stub"           — keep them, replaying each recorded result
   */
  unknownTools?: "skip" | "stub";
}

function zeroUsage(): Usage {
  return { model: "replay", inputTokens: 0, outputTokens: 0 };
}

/** Read a dot-path (e.g. "actions.0.result.observation.summary") off a value. */
function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

async function reResolveArgs(
  action: Action,
  input: DecideInput,
): Promise<Record<string, unknown>> {
  if (!action.argSources) return action.args;
  const out: Record<string, unknown> = { ...action.args };

  for (const [key, source] of Object.entries(action.argSources)) {
    switch (source.kind) {
      case "literal":
        break;
      case "now":
        out[key] = new Date().toISOString();
        break;
      case "fromTurn": {
        // Resolve against THIS run's session — the replayed turns' live
        // results — not the recording. That's what keeps chained values fresh.
        const turn = input.session.turns[source.turn];
        const value = turn ? readPath(turn, source.path) : undefined;
        if (value !== undefined) out[key] = value;
        break;
      }
      default: {
        const value = await input.env.resolveArg?.(source);
        if (value !== undefined) out[key] = value;
      }
    }
  }
  return out;
}

/**
 * Register a stand-in for every tool the recording calls that the live
 * registry doesn't have. Each stand-in hands back the recorded results for
 * that tool, in order — replay re-issues the calls in the recorded sequence,
 * so position is an exact match.
 */
function registerRecordedOnlyTools(source: Session, tools: ToolRegistry): void {
  const recorded = new Map<string, ActionResult[]>();
  for (const turn of source.turns) {
    for (const action of turn.actions) {
      // An action with no recorded result never finished executing; replaying
      // a benign success keeps the sequence aligned with the recorded calls.
      const result: ActionResult = action.result ?? {
        ok: true,
        observation: { summary: `(replay) ${action.tool} — no result recorded.` },
      };
      const list = recorded.get(action.tool);
      if (list) list.push(result);
      else recorded.set(action.tool, [result]);
    }
  }

  for (const [name, results] of recorded) {
    if (tools.get(name)) continue; // a real tool — replay it for real
    const queue = [...results];
    const stub: Tool<Record<string, unknown>> = {
      name,
      description: `Replay stand-in for "${name}" (registered by the recorded run's mode).`,
      // Permissive on purpose: the original schema lived in the other mode, and
      // the args being replayed were already validated when they were recorded.
      schema: z.object({}).passthrough(),
      execute: async () =>
        queue.shift() ?? {
          ok: true,
          observation: { summary: `(replay) ${name} called more often than the recording did.` },
        },
    };
    tools.register(stub as Tool);
  }
}

export function replayMode(source: Session, opts: ReplayModeOptions = {}): ExecutionMode {
  const policy = opts.unknownTools ?? "skip";
  // Our own cursor into the recording: with skipping, replayed turn N is not
  // necessarily recorded turn N, so the session length can't be the index.
  let cursor = 0;

  return {
    name: "replay",
    maxSteps:
      opts.maxSteps ?? source.turns.length + (opts.fallback ? opts.fallback.maxSteps : 0),

    async prepare({ tools }) {
      if (policy === "stub") registerRecordedOnlyTools(source, tools);
    },

    // The recorded system verbatim — the trace is the context.
    system: ({ goal, env }) => source.system ?? composeSystem(goal, env),

    async decide(input: DecideInput): Promise<ModelResult> {
      // Advance past any turn whose calls were ALL skipped. Emitting such a
      // turn with zero tool calls would read as "the model stopped" and end
      // the run — see the header note.
      let recorded = source.turns[cursor];
      while (recorded?.closed) {
        const replayable = recorded.actions.filter((a) => input.tools.get(a.tool));
        if (recorded.actions.length === 0 || replayable.length > 0) break;
        console.log(
          `  (replay: skipping turn ${recorded.index} — only ${[
            ...new Set(recorded.actions.map((a) => a.tool)),
          ].join(", ")}, not part of this run)`,
        );
        cursor++;
        recorded = source.turns[cursor];
      }

      if (!recorded || !recorded.closed) {
        if (opts.fallback) return opts.fallback.decide(input); // warm-start
        const text = "Replay trace exhausted; no fallback configured.";
        return {
          thought: text,
          toolUses: [],
          assistantBlocks: [{ type: "text", text }],
          stopReason: "end_turn",
          usage: zeroUsage(),
        };
      }
      cursor++;

      const toolUses: ToolUse[] = [];
      const resolvedById = new Map<string, Record<string, unknown>>();
      const skippedIds = new Set<string>();
      for (const action of recorded.actions) {
        if (!input.tools.get(action.tool)) {
          skippedIds.add(action.id); // mode-owned tool, policy "skip"
          continue;
        }
        const args = await reResolveArgs(action, input);
        resolvedById.set(action.id, args);
        toolUses.push({ id: action.id, name: action.tool, input: args });
      }

      // Faithful transcript: the recorded assistant blocks, with tool_use
      // inputs swapped for the re-resolved args so trace ≡ what actually ran.
      // Skipped calls drop their tool_use block too — a tool_use with no
      // matching tool_result is a malformed pair on any later render or replay.
      const assistantBlocks: ContentBlock[] = recorded.assistantBlocks
        .filter((b) => !(b.type === "tool_use" && skippedIds.has(b.id)))
        .map((b) => (b.type === "tool_use" ? { ...b, input: resolvedById.get(b.id) ?? b.input } : b));

      return {
        thought: recorded.thought ?? "",
        toolUses,
        assistantBlocks,
        stopReason: toolUses.length > 0 ? "tool_use" : "end_turn",
        usage: zeroUsage(),
      };
    },
  };
}
