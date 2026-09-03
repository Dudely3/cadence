import { z } from "zod";
import type { CompletionStatus, Goal } from "./types";
import type { Tool } from "./tool";

/**
 * The core-provided terminator tool — Solo's AvailableCompletionStatuses
 * pattern. Completion is a tool call carrying a STATUS, not a boolean:
 * the status is data a workflow layer can branch on, and the zod enum means
 * an invalid status is rejected and fed back to the model through the same
 * invalid-args path the drill proves recovers.
 *
 * Environments do not define their own terminators; examples register this
 * alongside the environment's tools:
 *
 *   new ToolRegistry([...env.availableTools(), completionTool(goal)])
 */

export const DEFAULT_COMPLETION_STATUSES: CompletionStatus[] = [
  { value: "success", description: "The goal was fully accomplished.", isSuccess: true },
  {
    value: "failure",
    description: "The goal could not be accomplished; explain why in the summary.",
    isSuccess: false,
  },
];

export function completionStatuses(goal: Goal): CompletionStatus[] {
  return goal.completionStatuses?.length ? goal.completionStatuses : DEFAULT_COMPLETION_STATUSES;
}

/** True when `status` maps to success for this goal. Unknown/absent → false. */
export function isSuccessStatus(goal: Goal, status: string | undefined): boolean {
  if (status === undefined) return false;
  return completionStatuses(goal).some((s) => s.value === status && s.isSuccess);
}

export function completionTool(goal: Goal): Tool<{ status: string; summary: string }> {
  const statuses = completionStatuses(goal);
  const values = statuses.map((s) => s.value) as [string, ...string[]];
  const statusLines = statuses
    .map((s) => `- "${s.value}"${s.description ? `: ${s.description}` : ""}`)
    .join("\n");

  return {
    name: "complete",
    description: `Declare the goal complete with a status. This ends the run — call it exactly once, when no further actions are needed. Statuses:\n${statusLines}`,
    schema: z.object({
      status: z.enum(values).describe("How the goal concluded."),
      summary: z.string().describe("A short summary of what was done (or why it failed)."),
    }),
    execute: async (_env, args) => ({
      ok: true,
      done: true,
      completionStatus: args.status,
      observation: { summary: `Completed (${args.status}): ${args.summary}` },
    }),
  };
}
