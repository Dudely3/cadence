/**
 * Recovery demo: the same notepad task, a real model, and a tool that throws.
 *
 * The scripted drill can only show that the loop SURVIVES a throwing tool. It
 * cannot show recovery, because a script has no capacity to read an error and
 * change its mind. This does — the second append_line throws the way Playwright
 * throws on a timeout, and Haiku has to notice and try again.
 *
 * Requires ANTHROPIC_API_KEY.
 *
 *   npm run recover
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
import { chaosEnv } from "@cadence/testkit";

async function main(): Promise<void> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Set ANTHROPIC_API_KEY (see .env.example) before running this.");
    process.exit(1);
  }

  const notepad = new NotepadEnv();
  // Fault the second tool call — the model will have one line down and lose the next.
  const env = chaosEnv(notepad, { at: 1, inject: "throwOnExecute" });

  const goal: Goal = {
    id: "recover-1",
    description:
      "Write a three-line haiku about the ocean to the notepad — one line per append_line call (5-7-5 syllables). Then call complete.",
  };

  console.log("Live model, one tool call rigged to throw.\n");

  const result = await run({
    goal,
    env,
    tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
    model: resilient(new AnthropicModelClient()),
    mode: speedMode(),
    tracer: new FileTracer(),
    onEvent: render,
  });

  const final = await notepad.observe();
  console.log("\n──────── result ────────");
  console.log(final.summary);
  console.log(`\noutcome: ${result.outcome}`);
  console.log(
    `steps: ${result.steps} | llm calls: ${result.totals.llmCalls} | ` +
      `in: ${result.totals.inputTokens} tok | out: ${result.totals.outputTokens} tok | ` +
      `wall: ${result.totals.wallMs} ms`,
  );
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
      console.log(`  ${e.ok ? "←" : "✗"} ${e.summary.split("\n")[0]}`);
      break;
    case "done":
      console.log(`\n${e.success ? "✓" : "✗"} ${e.outcome}`);
      break;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
