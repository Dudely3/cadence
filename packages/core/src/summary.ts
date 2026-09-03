import type { Session } from "./turn";
import type { RunResult, Usage } from "./types";

/**
 * One-line summaries of a recorded Session — what it was, what it did, what it
 * cost. Lives in core so every surface reads the same numbers: the `traces`
 * listing, the `pin` picker, the money table, and the viewer's session
 * overview. Same rule as the prompt renderer: one implementation, no drift.
 */

/**
 * First-party API list prices, $/MTok (cached 2026-08). Cache reads bill at
 * ~0.1x input; cache writes at 1.25x.
 */
export const PRICES: Array<{ prefix: string; in: number; out: number }> = [
  { prefix: "claude-haiku-4-5", in: 1, out: 5 },
  { prefix: "claude-opus-4-8", in: 5, out: 25 },
];

/** Dollar cost of every model call in a session, decide loop and aux alike. */
export function costOfSession(session: Session): number {
  const usages: Usage[] = [
    ...session.turns.flatMap((t) => (t.usage ? [t.usage] : [])),
    ...(session.auxUsage ?? []),
  ];
  let dollars = 0;
  for (const u of usages) {
    const price = PRICES.find((p) => u.model.startsWith(p.prefix));
    if (!price) continue; // scripted/replay entries have no billable model
    dollars +=
      (u.inputTokens * price.in +
        (u.cacheReadTokens ?? 0) * price.in * 0.1 +
        (u.cacheWriteTokens ?? 0) * price.in * 1.25 +
        u.outputTokens * price.out) /
      1_000_000;
  }
  return dollars;
}

export interface SessionSummary {
  id: string;
  mode: string;
  goalId: string;
  goalDescription: string;
  startedMs: number;
  turns: number;
  /** "completed" | "stopped" | … , or "unfinished" when the run never ended. */
  outcome: string;
  completionStatus?: string;
  /** True only for a run that finished AND declared a success status. */
  success: boolean;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  wallMs: number;
  costUsd: number;
  /** Distinct models the run actually called, e.g. ["claude-haiku-4-5-…"]. */
  models: string[];
  /** The tool sequence, deduped run-length style: "click → complete". */
  storyline: string;
}

export function summarizeSession(session: Session, result?: RunResult): SessionSummary {
  const usages: Usage[] = [
    ...session.turns.flatMap((t) => (t.usage ? [t.usage] : [])),
    ...(session.auxUsage ?? []),
  ];
  const billable = usages.filter((u) => u.model && u.model !== "replay");

  // Prefer the recorded totals; fall back to summing usage for a trace whose
  // run never finished (live.json mid-run, or a killed process).
  const totals = result?.totals;
  const sum = (pick: (u: Usage) => number | undefined): number =>
    usages.reduce((n, u) => n + (pick(u) ?? 0), 0);

  const tools = session.turns.flatMap((t) => t.actions.map((a) => a.tool));
  const storyline = tools
    .filter((name, i) => name !== tools[i - 1]) // collapse consecutive repeats
    .join(" → ");

  const summary: SessionSummary = {
    id: session.id,
    mode: session.mode,
    goalId: session.goal.id,
    goalDescription: session.goal.description,
    startedMs: session.startedMs,
    turns: session.turns.length,
    outcome: result?.outcome ?? "unfinished",
    success: result?.success ?? false,
    llmCalls: totals?.llmCalls ?? billable.length,
    inputTokens: totals?.inputTokens ?? sum((u) => u.inputTokens),
    outputTokens: totals?.outputTokens ?? sum((u) => u.outputTokens),
    cacheReadTokens: totals?.cacheReadTokens ?? sum((u) => u.cacheReadTokens),
    wallMs: totals?.wallMs ?? 0,
    costUsd: costOfSession(session),
    models: [...new Set(billable.map((u) => u.model))],
    storyline: storyline || "(no tool calls)",
  };
  if (result?.completionStatus !== undefined) summary.completionStatus = result.completionStatus;
  return summary;
}

/** "3m ago", "2h ago", "Aug 29" — for listings, relative to `now`. */
export function relativeTime(ms: number, now = Date.now()): string {
  const secs = Math.round((now - ms) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86_400);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
