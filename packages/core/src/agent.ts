import type {
  ActionResult,
  Goal,
  RunContext,
  RunResult,
  RunOutcome,
  ContentBlock,
  Observation,
} from "./types";
import type { Environment } from "./environment";
import type { ToolRegistry } from "./tool";
import type { ModelClient, ModelResult } from "./model";
import type { ExecutionMode } from "./mode";
import type { Tracer } from "./tracer";

export interface AgentConfig {
  goal: Goal;
  env: Environment;
  tools: ToolRegistry;
  model: ModelClient;
  mode: ExecutionMode;
  tracer: Tracer;
  /** Optional observer for the live dashboard (Phase 6). */
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "turn_start"; index: number }
  | { type: "thought"; index: number; text: string }
  | { type: "action"; index: number; tool: string; args: Record<string, unknown> }
  | { type: "observation"; index: number; summary: string; ok: boolean }
  | { type: "done"; success: boolean; outcome: RunOutcome };

/**
 * The fixed loop: perceive → decide → act → observe → trace → repeat.
 * The only thing that varies between modes is the injected `mode` config.
 */
export async function run(cfg: AgentConfig): Promise<RunResult> {
  const { goal, env, tools, model, mode, tracer, onEvent } = cfg;

  const session = tracer.start(goal, mode.name);
  const ctx: RunContext = { goal, step: 0, scratch: {} };

  // The environment can be dead before we ever ask the model anything — a
  // crashed page, a suspended audio context. Fail the run, don't crash the host.
  let initialObservation: Observation;
  try {
    initialObservation = await env.observe();
  } catch (err) {
    const message = errorMessage(err);
    onEvent?.({ type: "done", success: false, outcome: "error" });
    return tracer.finish(
      "error",
      { summary: `Environment unavailable: ${message}` },
      { error: `env.observe() failed before the first turn: ${message}` },
    );
  }

  // Mode setup (accuracy plans here, and may register its own tools), then the
  // mode composes the system prompt. Both run before the trace freezes its
  // static parts, so whatever prepare() produces lands in the cached prefix —
  // and toolDefs is computed AFTER prepare so mode-registered tools are in it.
  try {
    await mode.prepare?.({ goal, env, tools, model, ctx, session, observation: initialObservation });
  } catch (err) {
    const message = errorMessage(err);
    onEvent?.({ type: "done", success: false, outcome: "error" });
    return tracer.finish("error", initialObservation, {
      error: `mode.prepare() failed: ${message}`,
    });
  }
  const system = mode.system({ goal, env, ctx });
  const toolDefs = tools.toModelSchema();

  // Freeze the prompt's static parts into the trace — the Session must be a
  // complete account of what the model saw (viz + replay both depend on it).
  tracer.recordContext?.({ system, tools: toolDefs, initialObservation });

  let lastObservation: Observation = initialObservation;
  // Nothing proved the goal met yet; running out of steps is the default ending.
  let outcome: RunOutcome = "max_steps";
  let completionStatus: string | undefined;

  for (ctx.step = 0; ctx.step < mode.maxSteps; ctx.step++) {
    onEvent?.({ type: "turn_start", index: ctx.step });

    // Fresh look at the world every turn (Solo-style): the state the mode
    // renders into the volatile tail is CURRENT, not last turn's leftovers.
    if (ctx.step > 0) {
      try {
        lastObservation = await env.observe();
      } catch (err) {
        const message = errorMessage(err);
        onEvent?.({ type: "done", success: false, outcome: "error" });
        return tracer.finish("error", lastObservation, {
          error: `env.observe() failed at turn ${ctx.step}: ${message}`,
        });
      }
    }

    const turn = tracer.openTurn();

    // The mode produces the decision — composing the prompt and calling the
    // model (live), or reading the recorded session (replay). Transport
    // failures are the ModelClient's problem (wrap it in resilient() for retry
    // and timeout); anything that still escapes ends the run cleanly rather
    // than throwing out of run() and taking the process with it.
    let result: ModelResult;
    try {
      result = await mode.decide({
        goal,
        env,
        tools,
        model,
        ctx,
        session,
        observation: lastObservation,
      });
    } catch (err) {
      const message = errorMessage(err);
      tracer.closeTurn(turn);
      onEvent?.({ type: "done", success: false, outcome: "error" });
      return tracer.finish("error", lastObservation, {
        error: `mode.decide() failed: ${message}`,
      });
    }

    turn.thought = result.thought;
    turn.assistantBlocks = result.assistantBlocks;
    turn.usage = result.usage;
    if (result.thought.trim()) onEvent?.({ type: "thought", index: turn.index, text: result.thought });

    // No tool calls. The model has stopped working — but "stopped talking" is
    // not "goal achieved", so this is `stopped`, not success. Only an explicit
    // done signal from an action counts (see below).
    if (result.toolUses.length === 0) {
      tracer.closeTurn(turn);
      outcome = "stopped";
      break;
    }

    const toolResults: ContentBlock[] = [];
    let doneSignalled = false;

    for (const use of result.toolUses) {
      const tool = tools.get(use.name);
      if (!tool) {
        toolResults.push({
          type: "tool_result",
          toolUseId: use.id,
          content: `Error: unknown tool "${use.name}".`,
          isError: true,
        });
        continue;
      }

      const parsed = tool.schema.safeParse(use.input);
      if (!parsed.success) {
        toolResults.push({
          type: "tool_result",
          toolUseId: use.id,
          content: `Error: invalid arguments — ${parsed.error.message}`,
          isError: true,
        });
        continue;
      }

      onEvent?.({ type: "action", index: turn.index, tool: use.name, args: use.input });

      let actionResult: ActionResult;
      try {
        actionResult = await tool.execute(env, parsed.data, ctx);
      } catch (err) {
        // A throwing tool is an observation, not a crash. Hand the failure back
        // to the model as a tool_result — same contract as the unknown-tool and
        // invalid-args paths above — so it can adapt. Playwright throws on every
        // timeout and element-not-found, so this is the common case, not the edge.
        const message = err instanceof Error ? err.message : String(err);
        actionResult = {
          ok: false,
          error: message,
          observation: { summary: `Tool "${use.name}" failed: ${message}` },
        };
      }

      turn.actions.push({
        id: use.id,
        tool: use.name,
        args: use.input,
        result: actionResult,
        ...(actionResult.argSources ? { argSources: actionResult.argSources } : {}),
      });
      lastObservation = actionResult.observation;
      onEvent?.({
        type: "observation",
        index: turn.index,
        summary: actionResult.observation.summary,
        ok: actionResult.ok,
      });

      toolResults.push({
        type: "tool_result",
        toolUseId: use.id,
        content: actionResult.observation.summary,
        isError: !actionResult.ok,
      });

      if (actionResult.done) {
        doneSignalled = true;
        if (actionResult.completionStatus !== undefined) {
          completionStatus = actionResult.completionStatus;
        }
      }
    }

    turn.toolResults = toolResults;
    tracer.closeTurn(turn);

    // The only route to success: an action explicitly signalled done.
    if (doneSignalled) {
      outcome = "completed";
      break;
    }
  }

  const result = tracer.finish(outcome, lastObservation, {
    ...(completionStatus !== undefined ? { completionStatus } : {}),
  });
  onEvent?.({ type: "done", success: result.success, outcome });
  return result;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
