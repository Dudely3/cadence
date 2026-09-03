/**
 * StrudelEnv demo — the keystone: the SAME loop that wrote haikus and drove a
 * browser now composes EDM. The environment is the only thing that changed.
 *
 *   npm run jam                    # live, speed mode (Haiku), silent (headless)
 *   HEADED=1 npm run jam           # hear it — real Chromium window with audio
 *   MODE=accuracy npm run jam      # Opus + plan + critic
 *   REPLAY=traces/<id>.json npm run jam   # no model — replay reproduces the song
 *   STEP=1 <any of the above>      # presenter mode: pause before every turn,
 *                                  # Enter advances, "go" finishes unattended
 *
 * Drum samples load from the network; offline, the model is told to use pure
 * synths instead (the engine bundle itself is vendored — no CDN at showtime).
 */
// Loads .env (shell values win). Must come before anything reads the key.
import "./env";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  run,
  ToolRegistry,
  completionTool,
  resilient,
  type AgentEvent,
  type ExecutionMode,
  type Goal,
  type Tracer,
} from "@cadence/core";
import { FileTracer, loadTrace } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import { speedMode, accuracyMode, replayMode } from "@cadence/modes";
import { StrudelEnv } from "@cadence/env-strudel";
import { stepped, closeGate } from "./step";

async function main(): Promise<void> {
  const replayPath = process.env["REPLAY"];
  if (!replayPath && !process.env["ANTHROPIC_API_KEY"]) {
    console.error("Set ANTHROPIC_API_KEY (or REPLAY=traces/<id>.json) first.");
    process.exit(1);
  }

  const pageUrl = pathToFileURL(path.resolve("examples/site/strudel.html")).href;
  const headed = process.env["HEADED"] === "1";
  const env = new StrudelEnv({ pageUrl, headless: !headed, bpm: 120 });

  const goal: Goal = {
    id: "house-groove",
    description:
      "Build a house groove at 124 BPM with at least four layers: a kick on every beat, off-beat or steady hi-hats, a bassline in C minor, and one melodic element. Balance gains so no layer overwhelms. Then call complete.",
    successCriteria:
      "Playing at 124 BPM with ≥4 layers: four-on-the-floor kick, hats, a C-minor bassline, and a melodic layer, with sensible gains.",
  };

  let mode: ExecutionMode;
  if (replayPath) {
    const trace = loadTrace(replayPath);
    mode = replayMode(trace.session);
    console.log(`replaying ${replayPath} (${trace.session.turns.length} turns) — the song, reproduced`);
  } else {
    mode = process.env["MODE"] === "accuracy" ? accuracyMode() : speedMode();
  }
  if (process.env["STEP"] === "1") {
    mode = stepped(mode);
    console.log('presenter mode: paused before each turn — Enter advances, "go" runs to the end');
  }

  // Replays stream to live.json too (so the viz can follow them) but skip the
  // final <sessionId>.json — the durable artifact is the one being replayed.
  const tracer: Tracer = replayPath ? new FileTracer({ liveOnly: true }) : new FileTracer();
  try {
    const result = await run({
      goal,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode,
      tracer,
      onEvent: render,
    });

    const final = await env.observe();
    const raw = final.raw as { bpm: number; layers: Record<string, string>; status: { playing: boolean } };
    const layerCount = Object.keys(raw.layers).length;
    const structureOk = raw.status.playing && raw.bpm === 124 && layerCount >= 4;

    console.log("\n──────── result ────────");
    console.log(final.summary);
    console.log(
      `\noutcome: ${result.outcome}${result.completionStatus ? ` (${result.completionStatus})` : ""}` +
        `${result.error ? ` — ${result.error}` : ""}`,
    );
    console.log(
      `structure check: ${structureOk ? "✓" : "✗"} (playing=${raw.status.playing}, bpm=${raw.bpm}, layers=${layerCount})`,
    );
    console.log(
      `steps: ${result.steps} | llm calls: ${result.totals.llmCalls} | ` +
        `in: ${result.totals.inputTokens} tok | out: ${result.totals.outputTokens} tok | ` +
        `cache-read: ${result.totals.cacheReadTokens} tok | wall: ${result.totals.wallMs} ms`,
    );
    if (tracer instanceof FileTracer) console.log(`trace: ${tracer.finalPath ?? tracer.livePath}`);

    if (headed) {
      console.log("\nHEADED — leaving the music playing for 20s. Ctrl+C to stop earlier.");
      await new Promise((r) => setTimeout(r, 20_000));
    }
  } finally {
    // An open readline interface keeps a TTY process alive — always release it.
    closeGate();
    await env.dispose();
  }
}

function render(e: AgentEvent): void {
  switch (e.type) {
    case "turn_start":
      console.log(`\n● turn ${e.index}`);
      break;
    case "thought":
      if (e.text.trim()) console.log(`  thought: ${e.text.trim().split("\n")[0]}`);
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
