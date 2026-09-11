import type { Goal, RunResult, RunOutcome, Observation } from "./types";
import type { Session, Turn } from "./turn";
import type { ToolDef } from "./tool";
import { isSuccessStatus } from "./complete";

/** The static parts of the prompt, recorded once so the trace is self-contained. */
export interface SessionContext {
  system: string;
  tools: ToolDef[];
  initialObservation: Observation;
}

/**
 * Accumulates the Session. The serialized Session IS the replay artifact
 * (PLAN.md) — logging is the foundation, not an afterthought.
 */
export interface Tracer {
  start(goal: Goal, mode: string): Session;
  /** Record the prompt's static parts (system, tools, initial observation). */
  recordContext?(ctx: SessionContext): void;
  openTurn(): Turn;
  /**
   * Persist the session as it stands, mid-turn. The loop calls this once the
   * mode has composed the pending request, so a stepped run's pause shows the
   * request that is about to be sent rather than an empty turn.
   */
  flush?(): void;
  closeTurn(turn: Turn): void;
  finish(
    outcome: RunOutcome,
    finalObservation: Observation,
    extra?: { error?: string; completionStatus?: string },
  ): RunResult;
}

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export class InMemoryTracer implements Tracer {
  session: Session | null = null;

  start(goal: Goal, mode: string): Session {
    this.session = { id: id("sess"), goal, mode, turns: [], startedMs: Date.now() };
    return this.session;
  }

  /** Nothing to persist in memory — subclasses that write files override this. */
  flush(): void {}

  recordContext(ctx: SessionContext): void {
    if (!this.session) throw new Error("Tracer.recordContext called before start()");
    this.session.system = ctx.system;
    this.session.tools = ctx.tools;
    this.session.initialObservation = ctx.initialObservation;
  }

  openTurn(): Turn {
    if (!this.session) throw new Error("Tracer.openTurn called before start()");
    const turn: Turn = {
      index: this.session.turns.length,
      actions: [],
      assistantBlocks: [],
      toolResults: [],
      closed: false,
      cacheable: false,
      timing: { startedMs: Date.now(), durationMs: 0 },
    };
    this.session.turns.push(turn);
    return turn;
  }

  closeTurn(turn: Turn): void {
    turn.closed = true;
    turn.cacheable = true; // frozen → safe cache-segment boundary
    turn.timing.durationMs = Date.now() - turn.timing.startedMs;
  }

  finish(
    outcome: RunOutcome,
    finalObservation: Observation,
    extra?: { error?: string; completionStatus?: string },
  ): RunResult {
    if (!this.session) throw new Error("Tracer.finish called before start()");
    const turns = this.session.turns;
    // Every model call counts — decide turns AND aux calls (planner, critic).
    // Replayed/scripted turns report zero-usage entries; skip pure zeros so
    // replay's "0 LLM calls" row stays honest.
    const usages = [
      ...turns.flatMap((t) => (t.usage ? [t.usage] : [])),
      ...(this.session.auxUsage ?? []),
    ].filter((u) => u.inputTokens > 0 || u.outputTokens > 0);
    const totals = usages.reduce(
      (acc, u) => {
        acc.llmCalls += 1;
        acc.inputTokens += u.inputTokens;
        acc.outputTokens += u.outputTokens;
        acc.cacheReadTokens += u.cacheReadTokens ?? 0;
        return acc;
      },
      { llmCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    );

    // Success = explicitly completed with a success-mapped status. A run that
    // completed without a status (a custom done-setting tool) counts as
    // success only if the goal defines no statuses of its own.
    const status = extra?.completionStatus;
    const success =
      outcome === "completed" &&
      (status !== undefined
        ? isSuccessStatus(this.session.goal, status)
        : !this.session.goal.completionStatuses?.length);

    return {
      success,
      outcome,
      ...(status !== undefined ? { completionStatus: status } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
      steps: turns.length,
      finalObservation,
      totals: { wallMs: Date.now() - this.session.startedMs, ...totals },
    };
  }
}
