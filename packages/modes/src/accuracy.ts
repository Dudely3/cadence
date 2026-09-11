import { z } from "zod";
import {
  buildMessages,
  composeSystem,
  renderStateTail,
  ToolRegistry,
} from "@cadence/core";
import type {
  DecideInput,
  ExecutionMode,
  ModelClient,
  ModelResult,
  PendingRequest,
  Session,
  Tool,
  Turn,
} from "@cadence/core";

/**
 * Accuracy mode: Opus, plan-first, per-step critic, failure budget.
 *
 * Where each piece lives is the talk's context-anatomy story told twice
 * (PLAN.md, settled decision #3):
 *   - The PLAN text is composed into the system prompt in prepare(), before
 *     the trace freezes its statics → it rides the cached prefix, free after
 *     the first request.
 *   - Plan STATE travels as update_plan tool results, and the critic's
 *     feedback rides the volatile TAIL after the cache breakpoint — the Solo
 *     observations pattern. The frozen prefix is never touched.
 *
 * Why accuracy is slower and costlier, visibly: one planner call up front,
 * one critic call per turn (both recorded in session.auxUsage), plus the
 * bookkeeping update_plan calls the model makes. The money table shows all
 * of it.
 *
 * Retry is a budget, not a mechanism (settled decision #4): failed tool
 * calls come back as observations; after `failureBudget` consecutive bad
 * turns the tail steers the model toward complete(status: "failure").
 */

export interface AccuracyModeOptions {
  model?: string;
  maxTokens?: number;
  maxSteps?: number;
  /** Consecutive bad turns tolerated before steering toward failure. Default 3. */
  failureBudget?: number;
  /** Run the per-step critic. Default true. */
  critic?: boolean;
  /** Run the up-front planner. Default true. */
  planner?: boolean;
}

interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "done" | "failed";
  /** Ids of steps that must be DONE before this one can be marked done. */
  dependsOn: string[];
}

interface AccuracyState {
  plan: PlanStep[];
  consecutiveFailures: number;
}

const ACCURACY_PREAMBLE = `Work deliberately. Before each action, confirm the previous action had the effect you expected; if it did not, diagnose before retrying. Prefer one careful action over several optimistic ones. As you complete each plan step, mark it with update_plan before moving on. Respect step dependencies: do not work on a step before everything it depends on is done.`;

const PLANNER_SYSTEM = `You are a planner for an autonomous agent. Break the goal into a short, ordered plan of concrete steps the agent can execute with its tools. Fewer, larger steps beat many tiny ones. When a step requires another step's result, record that in dependsOn (ids of EARLIER steps only). Call create_plan exactly once.`;

const CRITIC_SYSTEM = `You are a critic reviewing one step of an autonomous agent's work. Judge ONLY whether the last action's results moved the agent toward the goal and matched its stated intent. Be strict about evidence: if the result contradicts the intent or shows an error, say so. Also flag work done out of dependency order — a step attempted while its dependencies are pending. Call verdict exactly once.`;

const STATE_KEY = "accuracy";

function state(scratch: Record<string, unknown>): AccuracyState {
  let s = scratch[STATE_KEY] as AccuracyState | undefined;
  if (!s) {
    s = { plan: [], consecutiveFailures: 0 };
    scratch[STATE_KEY] = s;
  }
  return s;
}

function renderPlan(plan: PlanStep[]): string {
  if (plan.length === 0) return "(no plan)";
  const mark = { pending: "☐", done: "✓", failed: "✗" } as const;
  return plan
    .map(
      (s) =>
        `${mark[s.status]} ${s.id}: ${s.title}${s.dependsOn.length ? ` (needs ${s.dependsOn.join(", ")})` : ""}`,
    )
    .join("\n");
}

/** The mode's own bookkeeping tool — registered in prepare(), not by the env. */
function updatePlanTool(): Tool<{
  stepId: string;
  status: "done" | "failed";
  note?: string;
}> {
  return {
    name: "update_plan",
    description:
      "Mark a plan step done or failed. Call this as soon as a step's outcome is known, before starting the next step.",
    schema: z.object({
      stepId: z.string().describe("The id of the plan step."),
      status: z.enum(["done", "failed"]),
      note: z
        .string()
        .optional()
        .describe("One line on the outcome, if useful."),
    }),
    execute: async (_env, args, ctx) => {
      const s = state(ctx.scratch);
      const step = s.plan.find((p) => p.id === args.stepId);
      if (!step) {
        return {
          ok: false,
          error: `unknown plan step "${args.stepId}"`,
          observation: {
            summary: `No plan step with id "${args.stepId}". Plan:\n${renderPlan(s.plan)}`,
          },
        };
      }

      // Dependency tracking: a step cannot be DONE while its dependencies are
      // unresolved. Marking a step FAILED is always allowed — abandoning a
      // branch must never be blocked.
      if (args.status === "done") {
        const unmet = step.dependsOn.filter(
          (id) => s.plan.find((p) => p.id === id)?.status !== "done",
        );
        if (unmet.length > 0) {
          return {
            ok: false,
            error: `dependencies not done: ${unmet.join(", ")}`,
            observation: {
              summary: `Cannot mark "${step.id}" done — it depends on ${unmet
                .map(
                  (id) =>
                    `"${id}" (${s.plan.find((p) => p.id === id)?.status})`,
                )
                .join(
                  ", ",
                )}. Finish the dependencies first, or mark "${step.id}" failed if its branch is being abandoned.\n\nPlan:\n${renderPlan(s.plan)}`,
            },
          };
        }
      }

      step.status = args.status;
      return {
        ok: true,
        observation: { summary: `Plan updated:\n${renderPlan(s.plan)}` },
      };
    },
  };
}

/** Summarize the last closed turn for the critic — thought, calls, results. */
function describeTurn(turn: Turn): string {
  const actions = turn.actions
    .map((a) => {
      const result = a.result
        ? `${a.result.ok ? "ok" : "ERROR"}: ${a.result.observation.summary}`
        : "(no result)";
      return `- ${a.tool}(${JSON.stringify(a.args)}) → ${result}`;
    })
    .join("\n");
  return `Intent: ${turn.thought?.trim() || "(none stated)"}\nActions:\n${actions || "(none)"}`;
}

export function accuracyMode(opts: AccuracyModeOptions = {}): ExecutionMode {
  const model = opts.model ?? "claude-opus-4-8";
  const maxTokens = opts.maxTokens ?? 8192;
  const failureBudget = opts.failureBudget ?? 3;
  const useCritic = opts.critic ?? true;
  const usePlanner = opts.planner ?? true;

  /** One aux model round-trip through a forced tool — structured output, no JSON parsing. */
  async function forcedToolCall(
    client: ModelClient,
    session: Session,
    input: { system: string; user: string; tool: Tool },
  ): Promise<Record<string, unknown> | null> {
    const [def] = new ToolRegistry([input.tool]).toModelSchema();
    if (!def) return null;
    const res = await client.decide({
      system: input.system,
      messages: [
        { role: "user", content: [{ type: "text", text: input.user }] },
      ],
      tools: [def],
      toolChoice: { type: "tool", name: input.tool.name },
      model,
      maxTokens: 2048,
      // thinking omitted — single-shot structured calls don't need it, and
      // forced tool_choice pairs safely with no thinking everywhere.
    });
    (session.auxUsage ??= []).push(res.usage);
    return res.toolUses[0]?.input ?? null;
  }

  /**
   * Everything this turn's request carries beyond the frozen prefix — the
   * critic call included. Composed BEFORE the decision so the loop can
   * record it and flush: at a stepped pause the critic's verdict is already
   * on screen, in the tail, where the model will read it.
   *
   * Idempotent, and it has to be: decide() runs immediately afterwards and
   * asks for the same thing. A second critic call would be a second Opus
   * request per turn, silently doubling the mode's cost.
   */
  const composeTurn = async (input: DecideInput): Promise<PendingRequest> => {
    const { session, goal } = input;
    const s = state(input.ctx.scratch);
    const openTurn = session.turns[session.turns.length - 1];
    if (openTurn?.tail !== undefined) {
      return {
        tail: openTurn.tail,
        ...(openTurn.critic ? { critic: openTurn.critic } : {}),
      };
    }
    const lastClosed = [...session.turns].reverse().find((t) => t.closed);

    // --- Critic: review the previous turn before deciding this one -------
    let verdict: { ok: boolean; feedback?: string } | undefined;
    if (useCritic && lastClosed && lastClosed.actions.length > 0) {
      const verdictTool: Tool<{ ok: boolean; feedback?: string }> = {
        name: "verdict",
        description: "Record the verdict on the last step.",
        schema: z.object({
          ok: z.boolean().describe("Did the step do what it intended?"),
          feedback: z
            .string()
            .optional()
            .describe("If not ok: what went wrong and what to try."),
        }),
        execute: async () => ({
          ok: true,
          observation: { summary: "recorded" },
        }),
      };
      const raw = await forcedToolCall(input.model, session, {
        system: CRITIC_SYSTEM,
        user:
          `Goal: ${goal.description}` +
          (goal.successCriteria
            ? `\nSuccess criteria: ${goal.successCriteria}`
            : "") +
          `\n\nPlan state:\n${renderPlan(s.plan)}\n\nLast step:\n${describeTurn(lastClosed)}` +
          `\n\nCurrent state after the step:\n${input.observation.summary}`,
        tool: verdictTool as Tool,
      });
      if (raw && typeof raw["ok"] === "boolean") {
        verdict = { ok: raw["ok"] as boolean };
        if (typeof raw["feedback"] === "string" && raw["feedback"]) {
          verdict.feedback = raw["feedback"];
        }
      }
    }

    // --- Failure budget: errors or a failed verdict count against it -----
    const turnHadError = lastClosed?.toolResults.some(
      (b) => b.type === "tool_result" && b.isError,
    );
    if (turnHadError || verdict?.ok === false) s.consecutiveFailures += 1;
    else if (lastClosed) s.consecutiveFailures = 0;

    // --- Volatile tail: past the cache line, recorded on the turn ---------
    // Solo's full volatile section: current state + plan progress (Task
    // Decomposition Progress) + critic feedback + budget steering.
    const tailParts: string[] = [renderStateTail(input.observation)];
    if (s.plan.length > 0) {
      tailParts.push(`Plan progress:\n${renderPlan(s.plan)}`);
    }
    if (verdict && !verdict.ok) {
      tailParts.push(
        `[critic] ${verdict.feedback ?? "The last step did not achieve its intent."} Address this before proceeding.`,
      );
    }
    if (s.consecutiveFailures >= failureBudget) {
      tailParts.push(
        `You have had ${s.consecutiveFailures} consecutive unproductive steps. If the goal cannot be accomplished, call complete with status "failure" and explain why instead of retrying further.`,
      );
    }
    return {
      tail: tailParts.join("\n\n"),
      ...(verdict ? { critic: verdict } : {}),
    };
  };

  return {
    name: "accuracy",
    maxSteps: opts.maxSteps ?? 20,

    async prepare({ goal, tools, model: client, ctx, session, observation }) {
      const s = state(ctx.scratch);
      tools.register(updatePlanTool());

      if (!usePlanner) return;

      const planTool: Tool<{
        steps: Array<{ id: string; title: string; dependsOn?: string[] }>;
      }> = {
        name: "create_plan",
        description: "Record the ordered plan.",
        schema: z.object({
          steps: z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                dependsOn: z
                  .array(z.string())
                  .optional()
                  .describe("Ids of EARLIER steps this one requires."),
              }),
            )
            .min(1)
            .describe("2-6 ordered, concrete steps."),
        }),
        execute: async () => ({
          ok: true,
          observation: { summary: "plan recorded" },
        }),
      };

      const toolList = tools
        .list()
        .map((t) => `- ${t.name}: ${t.description.split("\n")[0]}`)
        .join("\n");
      const input = await forcedToolCall(client, session, {
        system: PLANNER_SYSTEM,
        user: `Goal: ${goal.description}\n\nInitial state:\n${observation.summary}\n\nAgent tools:\n${toolList}`,
        tool: planTool as Tool,
      });

      const steps = (
        input as {
          steps?: Array<{ id: string; title: string; dependsOn?: string[] }>;
        } | null
      )?.steps;
      const raw = steps?.length
        ? steps
        : [{ id: "s1", title: goal.description }];
      // Sanitize dependencies: only EARLIER step ids are honored (drops
      // self-references, unknown ids, and forward edges — no cycles possible
      // by construction).
      const seen = new Set<string>();
      s.plan = raw.map((p) => {
        const dependsOn = (p.dependsOn ?? []).filter((id) => seen.has(id));
        seen.add(p.id);
        return {
          id: p.id,
          title: p.title,
          status: "pending" as const,
          dependsOn,
        };
      });
    },

    system({ goal, env, ctx }) {
      const s = state(ctx.scratch);
      const planBlock = s.plan.length
        ? `\n\nPlan (mark steps with update_plan as you go):\n${renderPlan(s.plan)}`
        : "";
      // The plan text baked here is the INITIAL plan — part of the frozen
      // prefix. Progress never edits this; it arrives via tool results.
      return composeSystem(goal, env, ACCURACY_PREAMBLE + planBlock);
    },

    composeTurn,

    async decide(input: DecideInput): Promise<ModelResult> {
      const { session, tools, model: client } = input;
      // The loop composed and recorded this already; calling it again is the
      // standalone path, and composeTurn is idempotent so the critic is not
      // re-run.
      const pending = await composeTurn(input);
      const tail = pending.tail ?? "";

      // Record what this request actually carried — trace stays complete.
      const openTurn = session.turns[session.turns.length - 1];
      if (openTurn) {
        if (pending.critic) openTurn.critic = pending.critic;
        openTurn.tail = tail;
      }

      return client.decide({
        system: session.system ?? "",
        messages: buildMessages(session, { tail }),
        tools: session.tools ?? tools.toModelSchema(),
        model,
        maxTokens,
        thinking: "adaptive",
        effort: "high",
      });
    },
  };
}
