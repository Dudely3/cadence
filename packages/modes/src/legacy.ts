import {
  buildMessages,
  composeSystem,
  parseLegacyReply,
  renderStateTail,
  renderToolCatalogue,
  type LegacySchema,
} from "@cadence/core";
import type {
  ContentBlock,
  DecideInput,
  ExecutionMode,
  ModelResult,
  PendingRequest,
  ToolUse,
} from "@cadence/core";

export interface LegacyModeOptions {
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
  /**
   * Give the model one more go when its reply cannot be parsed, with the parse
   * error handed back. Real harnesses do this; without it the comparison is
   * unfair, because a single stray character would end an otherwise fine run.
   */
  repairAttempts?: number;
  /**
   * Which catalogue to ask for. "lean" is the default: prose thinking, then
   * one minified {"action":[...]}. "verbose" is the historical shape, with
   * current_state and reasoning restating a page the model can already see —
   * kept runnable because it is the artifact, but it is not what this
   * protocol has to cost. See ContextShape.legacySchema.
   */
  schema?: LegacySchema;
}

const SCRATCH_CATALOGUE = "legacy.catalogue";
/** Parse failures seen this run — reported by examples/protocols.ts. */
export const SCRATCH_PARSE_FAILURES = "legacy.parseFailures";
/** Repairs that worked: a parse failure the second call recovered from. */
export const SCRATCH_REPAIRS = "legacy.repairs";

/**
 * The way agents called tools before the API had a `tools` parameter.
 *
 * Same loop, same environment, same tools, same model. The only thing that
 * changes is how a call gets from the model to the harness: prose catalogue in
 * the system prompt, one JSON blob back, parsed here.
 *
 * This exists to be RUN, not to be mocked. The deck can assert that native tool
 * use is better; a mode that actually works and can be measured beside speed
 * mode on the same goal is a different kind of argument, and some of what it
 * shows is in the old protocol's favour — declaring no tools means the API adds
 * no tool-use preamble, which is 317 tokens on Haiku 4.5.
 *
 * What it genuinely gives up is in legacy-format.ts, at the two places it
 * happens: positional binding with nobody checking the order, and a history
 * entry the harness paraphrases rather than the result the tool returned.
 */
export function legacyMode(opts: LegacyModeOptions = {}): ExecutionMode {
  const model = opts.model ?? "claude-haiku-4-5";
  const maxTokens = opts.maxTokens ?? 2048;
  const repairAttempts = opts.repairAttempts ?? 1;
  const schema: LegacySchema = opts.schema ?? "lean";

  return {
    name: schema === "verbose" ? "legacy-verbose" : "legacy",
    maxSteps: opts.maxSteps ?? 8,

    // The shape is DATA on the session so buildMessages and the viewer both
    // read it, exactly as naiveMode does. Merge rather than assign: the loop
    // stamps goalCache on every new session.
    prepare: ({ session, tools, ctx }) => {
      session.contextShape = {
        ...session.contextShape,
        toolProtocol: "json-in-text",
        legacySchema: schema,
      };
      ctx.scratch[SCRATCH_CATALOGUE] = renderToolCatalogue(tools.toModelSchema(), schema);
      ctx.scratch[SCRATCH_PARSE_FAILURES] = 0;
      ctx.scratch[SCRATCH_REPAIRS] = 0;
      return Promise.resolve();
    },

    // The catalogue is baked into the system prompt, which means it is inside
    // the cached prefix and paid for once — the same trick native tool use gets
    // for free by putting schemas in the tools parameter.
    system: ({ goal, env, ctx }) =>
      composeSystem(goal, env, String(ctx.scratch[SCRATCH_CATALOGUE] ?? "")),

    composeTurn: ({ session, observation }: DecideInput): Promise<PendingRequest> => {
      const openTurn = session.turns[session.turns.length - 1];
      const tail = openTurn?.tail ?? renderStateTail(observation);
      return Promise.resolve({ tail });
    },

    decide: async ({ session, tools, model: client, observation, ctx }): Promise<ModelResult> => {
      const openTurn = session.turns[session.turns.length - 1];
      const tail = openTurn?.tail ?? renderStateTail(observation);
      if (openTurn) openTurn.tail = tail;
      const turnIndex = openTurn?.index ?? session.turns.length;
      const schema = session.tools ?? tools.toModelSchema();

      const ask = async (extra?: string): Promise<ModelResult> =>
        client.decide({
          system: session.system ?? "",
          messages: buildMessages(session, { tail: extra ? `${tail}\n\n${extra}` : tail }),
          // The whole point: no tools parameter. The model is told about them
          // in prose and nothing validates what comes back.
          tools: [],
          model,
          maxTokens,
        });

      let raw = await ask();
      let parsed = parseLegacyReply(raw.thought, schema);

      for (let attempt = 0; parsed.error !== undefined && attempt < repairAttempts; attempt += 1) {
        ctx.scratch[SCRATCH_PARSE_FAILURES] = Number(ctx.scratch[SCRATCH_PARSE_FAILURES] ?? 0) + 1;
        const retry = await ask(
          `Your previous reply could not be parsed: ${parsed.error}\n` +
            "Reply with the JSON object only.",
        );
        const reparsed = parseLegacyReply(retry.thought, schema);
        // Keep the repaired call, but bill both round-trips: the wasted one is
        // the cost of this protocol and hiding it would flatter the comparison.
        raw = { ...retry, usage: mergeUsage(raw.usage, retry.usage) };
        parsed = reparsed;
        if (parsed.error === undefined) {
          ctx.scratch[SCRATCH_REPAIRS] = Number(ctx.scratch[SCRATCH_REPAIRS] ?? 0) + 1;
        }
      }

      if (parsed.error !== undefined) {
        ctx.scratch[SCRATCH_PARSE_FAILURES] = Number(ctx.scratch[SCRATCH_PARSE_FAILURES] ?? 0) + 1;
      }

      // Ids are ours, not the API's — there is no id in this protocol. They are
      // derived from the turn so a re-render of the same trace produces the same
      // bytes, which replay depends on.
      const toolUses: ToolUse[] = parsed.calls.map((c, i) => ({
        id: `legacy_${turnIndex}_${i}`,
        name: c.name,
        input: c.input,
      }));

      // The assistant block stays the model's ACTUAL output: one text blob. That
      // is what went on the wire and what goes back into history, so the trace
      // stays a true account and the viewer draws a text block, not a tool_use.
      const assistantBlocks: ContentBlock[] = [{ type: "text", text: raw.thought }];

      return {
        ...raw,
        thought: parsed.error !== undefined ? `[unparseable] ${parsed.error}` : parsed.thought,
        toolUses,
        assistantBlocks,
      };
    },
  };
}

function mergeUsage(a: ModelResult["usage"], b: ModelResult["usage"]): ModelResult["usage"] {
  return {
    ...b,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
      ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
      : {}),
    ...(a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) }
      : {}),
  };
}
