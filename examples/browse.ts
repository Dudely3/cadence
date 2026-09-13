/**
 * BrowserEnv demo: the SAME loop that wrote haikus drives a browser.
 *
 * Task: on the local Trailhead Supply shop (examples/site/shop.html — file://,
 * no network, deterministic), add the cheapest CAMPING item to the cart. The
 * overall cheapest item is in another category, so the model has to filter,
 * not just min() the page.
 *
 * Ready-made (no flags to type, identical in every shell):
 *
 *   npm run browse         # live, speed mode (Haiku), headless
 *   npm run demo           # STAGE SETUP: step + headed + sized for half a screen
 *   npm run demo:accuracy  # same, Opus + plan + critic
 *   npm run demo:replay    # same, from your pinned recording (no key)
 *   npm run traces         # list recordings   |   npm run pin  # choose the fallback
 *
 * Custom flags — invoke tsx directly. `npm run browse -- --flag` is a trap on
 * PowerShell: it strips the `--`, then npm eats the flags as its own config and
 * the script silently runs with defaults.
 *
 *   npx tsx examples/browse.ts --step --headed --viewport 940x820 --mode accuracy
 *   npx tsx examples/browse.ts --mode legacy      (json-in-text tool calls)
 *   npx tsx examples/browse.ts --replay sess_xxxx      # id, path, latest, or pinned
 *   npx tsx examples/browse.ts --url prairiedevcon.com --goal "..."   # any site
 *
 * (bash users: the old STEP=1 / HEADED=1 / VIEWPORT / MODE / REPLAY env vars
 * still work, and an explicit flag beats an env var.)
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
import { speedMode, accuracyMode, replayMode, legacyMode } from "@cadence/modes";
import { BrowserEnv } from "@cadence/env-browser";
import { stepped, pressEnter, closeGate } from "./step";
import { demoFlags, resolveReplayPath } from "./flags";

const CHEAPEST_CAMPING = "Titanium Tent Stakes";
const GOAL_ID = "shop-cheapest-camping";

async function main(): Promise<void> {
  const opts = demoFlags();
  const replayPath = opts.replay
    ? resolveReplayPath(opts.replay, opts.goalId?.trim() || GOAL_ID)
    : undefined;
  if (!replayPath && !process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "No ANTHROPIC_API_KEY. Put one in .env, or run from a recording instead:\n" +
        "  npm run demo:replay",
    );
    process.exit(1);
  }

  // The start URL is CONFIG, not something the model infers: the environment
  // navigates here before the first observation, and the model only ever learns
  // the address by reading it back in the CURRENT STATE block.
  const startUrl = opts.url?.trim()
    ? normalizeUrl(opts.url.trim())
    : pathToFileURL(path.resolve("examples/site/shop.html")).href;
  const siteLabel = describeSite(startUrl);
  const headed = opts.headed;
  const env = new BrowserEnv({
    startUrl,
    headless: !headed,
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
  });

  // A goal given on the command line replaces the built-in one — the loop is
  // domain-agnostic, so the only thing a new task needs is new words.
  const custom = opts.goal?.trim();
  const goal: Goal = custom
    ? {
        id: opts.goalId?.trim() || "custom",
        // The site sentence is derived from the URL — hardcoding "the Trailhead
        // Supply store page" would put a falsehood in the prompt on any --url.
        description: `You are on ${siteLabel}. ${custom}`,
        successCriteria: custom,
      }
    : {
        id: GOAL_ID,
        description:
          "You are on the Trailhead Supply store page. Add the cheapest item in the Camping category to the cart (exactly one item), then call complete with status \"success\". Read prices from the page; do not guess.",
        successCriteria: `The cart contains exactly one item: the cheapest Camping product.`,
      };
  if (custom) console.log(`goal: ${custom}`);

  let mode: ExecutionMode;
  if (replayPath) {
    const trace = loadTrace(replayPath);
    mode = replayMode(trace.session);
    console.log(`replaying ${replayPath} (${trace.session.turns.length} turns, mode was "${trace.session.mode}")`);
  } else {
    mode =
      opts.mode === "accuracy"
        ? accuracyMode()
        : // The pre-native-tool-use protocol, same loop and same tools — only
          // how a call gets from the model to the harness changes.
          opts.mode === "legacy"
          ? legacyMode()
          : speedMode();
  }
  if (opts.step) {
    mode = stepped(mode);
    console.log('presenter mode: paused before each turn — Enter advances, "go" runs to the end');
  }

  // Replays stream to live.json too (so the viewer can follow them) but skip
  // the final <sessionId>.json — the durable artifact is the one being replayed.
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

    // Objective check, straight from the live page. Only the built-in goal has
    // a known-correct answer to check against; a custom goal just reports.
    const final = await env.observe();
    const cartOk =
      final.summary.includes("Cart (1 item)") && final.summary.includes(`${CHEAPEST_CAMPING} —`);

    console.log("\n──────── result ────────");
    console.log(
      `outcome: ${result.outcome}${result.completionStatus ? ` (${result.completionStatus})` : ""}` +
        `${result.error ? ` — ${result.error}` : ""}`,
    );
    if (custom) {
      console.log("final page state:");
      for (const line of final.summary.split(/\r?\n/).slice(0, 6)) console.log(`  ${line}`);
    } else {
      console.log(
        `goal actually met: ${cartOk ? "✓" : "✗"} (cart should hold exactly: ${CHEAPEST_CAMPING})`,
      );
    }
    console.log(
      `steps: ${result.steps} | llm calls: ${result.totals.llmCalls} | ` +
        `in: ${result.totals.inputTokens} tok | out: ${result.totals.outputTokens} tok | ` +
        `cache-read: ${result.totals.cacheReadTokens} tok | wall: ${result.totals.wallMs} ms`,
    );
    if (tracer instanceof FileTracer) console.log(`trace: ${tracer.finalPath ?? tracer.livePath}`);

    // Don't tear the window down on the punchline — the finished cart IS the
    // proof the goal was met, and it's what you point at while wrapping up.
    if (headed) await pressEnter("\nbrowser still open on the final page — Enter to close ");
  } finally {
    closeGate();
    await env.dispose();
  }
}

/** Accept "example.com" as well as a full URL; anything else is left alone. */
function normalizeUrl(raw: string): string {
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith("file:")) return raw;
  return `https://${raw}`;
}

/** "the page at www.prairiedevcon.com" / "the Trailhead Supply store page". */
function describeSite(url: string): string {
  if (url.startsWith("file:")) return "the Trailhead Supply store page";
  try {
    return `the page at ${new URL(url).host}`;
  } catch {
    return "the current page";
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
