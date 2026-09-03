/**
 * Phase 0 spike: drive the bare loop against the notepad environment in speed
 * mode. Requires ANTHROPIC_API_KEY in the environment (or a .env you've loaded).
 *
 *   npm run spike
 */
// Loads .env (shell values win). Must come before anything reads the key.
import "./env";
import {
  run,
  ToolRegistry,
  completionTool,
  resilient,
  type AgentEvent,
  type Goal,
} from "@cadence/core";
import { FileTracer } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import { speedMode } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";

async function main() {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Set ANTHROPIC_API_KEY (see .env.example) before running the spike.");
    process.exit(1);
  }

  const env = new NotepadEnv();
  const goal: Goal = {
    id: "haiku-1",
    description:
      "Write a three-line haiku about the ocean to the notepad — one line per append_line call (5-7-5 syllables). Then call complete.",
  };

  const tracer = new FileTracer();
  const result = await run({
    goal,
    env,
    tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
    model: resilient(new AnthropicModelClient(), {
      onRetry: ({ attempt, delayMs }) => console.log(`  ⟳ retry ${attempt} in ${delayMs}ms`),
    }),
    mode: speedMode(),
    tracer,
    onEvent: render,
  });

  const final = await env.observe();
  console.log("\n──────── result ────────");
  console.log(final.summary);
  console.log(
    `\noutcome: ${result.outcome}${result.completionStatus ? ` (${result.completionStatus})` : ""}${result.error ? ` — ${result.error}` : ""}`,
  );
  console.log("success:", result.success);
  console.log(
    `steps: ${result.steps} | llm calls: ${result.totals.llmCalls} | ` +
      `in: ${result.totals.inputTokens} tok | out: ${result.totals.outputTokens} tok | ` +
      `cache-read: ${result.totals.cacheReadTokens} tok | wall: ${result.totals.wallMs} ms`,
  );
  console.log(`trace: ${tracer.finalPath ?? tracer.livePath}`);
}

function render(e: AgentEvent): void {
  switch (e.type) {
    case "turn_start":
      console.log(`\n● turn ${e.index}`);
      break;
    case "thought":
      if (e.text.trim()) console.log(`  thought: ${e.text.trim()}`);
      break;
    case "action":
      console.log(`  → ${e.tool}(${JSON.stringify(e.args)})`);
      break;
    case "observation":
      console.log(`  ← ${e.ok ? "ok" : "ERR"}: ${e.summary.split("\n")[0]}`);
      break;
    case "done":
      console.log(`\n${e.success ? "✓" : "✗"} ${e.outcome}`);
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
