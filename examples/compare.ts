/**
 * The money table: the SAME goal run under speed, accuracy, and replay, with
 * real wall-clock / calls / tokens / cost / outcome side by side.
 *
 * Order matters: speed runs first and its trace becomes replay's program —
 * proving the thesis end to end (the trace IS the context IS the replay).
 *
 * Requires ANTHROPIC_API_KEY (speed + accuracy are live; replay is free).
 *
 *   npm run compare
 */
// Loads .env (shell values win). Must come before anything reads the key.
import "./env";
import {
  run,
  ToolRegistry,
  completionTool,
  resilient,
  InMemoryTracer,
  costOfSession,
  type Environment,
  type ExecutionMode,
  type Goal,
  type RunResult,
  type Session,
} from "@cadence/core";
import { FileTracer } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import { speedMode, accuracyMode, replayMode } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";

const GOAL: Goal = {
  id: "compare-haiku",
  description:
    "Write a three-line haiku about the ocean to the notepad — one line per append_line call (5-7-5 syllables). Then call complete.",
  successCriteria: "The notepad contains exactly three lines forming a plausible 5-7-5 haiku.",
};

interface Row {
  mode: string;
  result: RunResult;
  lines: number;
  cost: number;
}

async function runMode(name: string, mode: ExecutionMode): Promise<{ row: Row; session: Session }> {
  const env = new NotepadEnv();
  // Live runs write traces (viz + replay artifacts); replay itself stays in memory.
  const tracer = name === "replay" ? new InMemoryTracer() : new FileTracer();

  console.log(`\n━━ ${name} ━━`);
  const result = await run({
    goal: GOAL,
    env,
    tools: new ToolRegistry([...env.availableTools(), completionTool(GOAL)]),
    model: resilient(new AnthropicModelClient()),
    mode,
    tracer,
    onEvent: (e) => {
      if (e.type === "action") console.log(`  → ${e.tool}`);
      if (e.type === "done") console.log(`  ${e.success ? "✓" : "✗"} ${e.outcome}`);
    },
  });

  const observed = await env.observe();
  const lines = (observed.raw as { lines: string[] }).lines.length;
  const session = tracer.session;
  if (!session) throw new Error("tracer has no session");
  return { row: { mode: name, result, lines, cost: costOfSession(session) }, session };
}

function fmt(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

async function main(): Promise<void> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Set ANTHROPIC_API_KEY before running the comparison.");
    process.exit(1);
  }

  const rows: Row[] = [];

  // 1. Speed — live Haiku, trace recorded to disk.
  const speed = await runMode("speed", speedMode());
  rows.push(speed.row);

  // 2. Accuracy — live Opus: planner + per-step critic + failure budget.
  const accuracy = await runMode("accuracy", accuracyMode());
  rows.push(accuracy.row);

  // 3. Replay — walks the speed run's trace. No model, no tokens, no cost.
  const replay = await runMode("replay", replayMode(speed.session));
  rows.push(replay.row);

  console.log("\n\n## Same goal, three execution modes\n");
  console.log("| Mode | Wall | LLM calls | In tok | Out tok | Cache read | Cost | Outcome | Goal met |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const t = r.result.totals;
    const outcome = `${r.result.outcome}${r.result.completionStatus ? ` (${r.result.completionStatus})` : ""}`;
    console.log(
      `| ${r.mode} | ${(t.wallMs / 1000).toFixed(1)}s | ${t.llmCalls} | ${fmt(t.inputTokens)} | ${fmt(t.outputTokens)} | ${fmt(t.cacheReadTokens)} | $${r.cost.toFixed(4)} | ${outcome} | ${r.lines >= 3 ? "✓" : "✗"} (${r.lines} lines) |`,
    );
  }
  console.log("\ntrace for replay came from the speed run — one structure, three payoffs.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
