/**
 * One paid run, then the same program for free against different values.
 *
 *   npm run rerun                    record live, then re-point it three times
 *   npx tsx examples/rerun.ts --replay sess_abc_1     skip the paid run
 *   npx tsx examples/rerun.ts --items "Camp Stove,Packraft"
 *
 * This is what makes a trace a program rather than a video. The recording
 * knows what it was about — `session.params` says `item: "Titanium Tent
 * Stakes"` — so replay can find that value in what the run actually did and
 * swap it: in the arguments it passed, and in the DOM selector it captured for
 * re-resolution.
 *
 * That second part is the load-bearing one, and it only works because the page
 * labels its controls with the thing they act on:
 *
 *   recorded:  click { elementId: 2 }
 *              argSources.elementId = dom "button|Add Titanium Tent Stakes to cart"
 *   replayed:  dom "button|Add Camp Stove to cart"  →  whatever id that is NOW
 *
 * A recording that captured only `elementId: 2` would be re-runnable exactly
 * once, on a page that had not moved. Capture what the element WAS and the same
 * recording runs anywhere the equivalent element exists.
 *
 * Every replay here makes zero model calls and costs nothing. The check is the
 * world afterwards — what is actually in the cart — never the model's summary,
 * which was written about the recorded values and is deliberately not rewritten.
 */
import "./env";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  run,
  ToolRegistry,
  completionTool,
  resilient,
  costOfSession,
  type Goal,
  type Session,
} from "@cadence/core";
import { FileTracer } from "@cadence/tracer-file";
import { loadTrace } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import { speedMode, replayMode } from "@cadence/modes";
import { BrowserEnv } from "@cadence/env-browser";
import { demoFlags, resolveReplayPath } from "./flags";

const START_URL = pathToFileURL(path.resolve("examples/site/bigshop.html")).href;

/** The value the live run is recorded against. */
const RECORD_ITEM = "Titanium Tent Stakes";
/** The values it is re-pointed at afterwards — all free. */
const DEFAULT_ITEMS = ["Camp Stove", "Packraft", "Dry Bag 20L"];

const flags = demoFlags(process.argv.slice(2), process.env, ["items"]);
const itemsArg = process.argv.indexOf("--items");
const items =
  itemsArg >= 0 && process.argv[itemsArg + 1]
    ? process.argv[itemsArg + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ITEMS;

const TOOLS = ["navigate", "click", "type_text", "find_in_page", "read_element", "scroll"];

function goalFor(item: string): Goal {
  return {
    id: "rerun-add-item",
    description:
      `You are on the Trailhead Supply store page. Add "${item}" to the cart, ` +
      `then call complete with the cart's item count and total.`,
    successCriteria: `The cart contains ${item} and nothing else.`,
  };
}

function newEnv(): BrowserEnv {
  return new BrowserEnv({
    startUrl: START_URL,
    headless: !flags.headed,
    ...(flags.viewport ? { viewport: flags.viewport } : {}),
    representation: "cleaned",
    pageTextLimit: 2_500,
    maxElements: 30,
    tools: TOOLS,
  });
}

/** Did the cart end up holding exactly this item? Checked against the world. */
function cartHolds(worldSummary: string, item: string): boolean {
  const cart = worldSummary.slice(worldSummary.indexOf("Cart"));
  return cart.includes(item);
}

// --- 1. the paid run ------------------------------------------------------
let recorded: Session;
let recordedCost = 0;

if (flags.replay) {
  const file = resolveReplayPath(flags.replay, "rerun-add-item");
  recorded = loadTrace(file).session;
  console.log(
    `using recording ${path.basename(file)} — params ${JSON.stringify(recorded.params ?? {})}\n`,
  );
} else {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "Needs ANTHROPIC_API_KEY for the one live run.\n" +
        "Already have a recording? Pass --replay <id> and every run here is free.",
    );
    process.exit(1);
  }
  console.log(`──────── recording live: ${RECORD_ITEM} ────────`);
  const env = newEnv();
  const goal = goalFor(RECORD_ITEM);
  const tracer = new FileTracer();
  try {
    const result = await run({
      goal,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode: speedMode({ maxSteps: 8 }),
      tracer,
      // The whole point: name what this run is about, so a replay can re-point it.
      params: { item: RECORD_ITEM },
      onEvent: (e) => {
        if (e.type === "action") console.log(`  → ${e.tool}(${JSON.stringify(e.args)})`);
      },
    });
    const world = await env.observe();
    recorded = tracer.session!;
    recordedCost = costOfSession(recorded);
    console.log(
      `  ${result.outcome} · ${result.steps} turns · $${recordedCost.toFixed(4)} · cart ${
        cartHolds(world.summary, RECORD_ITEM) ? "correct" : "WRONG"
      }`,
    );
    console.log(`  trace: ${tracer.finalPath}\n`);
  } finally {
    await env.dispose();
  }
}

// What the recording captured for re-resolution — the reason this works at all.
const selectors = recorded.turns
  .flatMap((t) => t.actions)
  .flatMap((a) => Object.values(a.argSources ?? {}))
  .flatMap((src) => ("selector" in src ? [src.selector] : []));
if (selectors.length > 0) {
  console.log("captured DOM selectors (these are what get re-pointed):");
  for (const sel of selectors) console.log(`  ${sel}`);
  console.log();
}

// --- 2. the free runs -----------------------------------------------------
interface Row {
  item: string;
  outcome: string;
  turns: number;
  calls: number;
  cost: number;
  correct: boolean;
}
const rows: Row[] = [];

for (const item of items) {
  console.log(`──────── replay, re-pointed: ${item} ────────`);
  const env = newEnv();
  const goal = goalFor(item);
  // liveOnly: the durable recording already exists; a replay shouldn't mint a
  // near-duplicate of it every time you demo this.
  const tracer = new FileTracer({ liveOnly: true });
  try {
    const result = await run({
      goal,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode: replayMode(recorded, { params: { item } }),
      tracer,
      params: { item },
      onEvent: (e) => {
        if (e.type === "action") console.log(`  → ${e.tool}(${JSON.stringify(e.args)})`);
      },
    });
    const world = await env.observe();
    const correct = cartHolds(world.summary, item);
    rows.push({
      item,
      outcome: result.outcome,
      turns: result.steps,
      calls: result.totals.llmCalls,
      cost: costOfSession(tracer.session!),
      correct,
    });
    console.log(`  ${result.outcome} · cart ${correct ? "correct" : "WRONG"}\n`);
  } finally {
    await env.dispose();
  }
}

// --- the table ------------------------------------------------------------
const pad = (s: string, n: number): string => s.padEnd(n);
console.log("\n════════ one recording, re-pointed ════════\n");
const W = 34;
console.log(`${pad("item", W)}|${pad(" turns", 7)}|${pad(" llm calls", 11)}|${pad("    cost", 10)}| cart`);
console.log("-".repeat(W + 36));
if (!flags.replay) {
  const calls = recorded.turns.filter((t) => t.usage && t.usage.model !== "replay").length;
  console.log(
    `${pad(`${RECORD_ITEM} (recorded)`, W)}|${String(recorded.turns.length).padStart(6)} |` +
      `${String(calls).padStart(10)} |${("$" + recordedCost.toFixed(4)).padStart(9)} | ✓`,
  );
}
for (const r of rows) {
  console.log(
    `${pad(r.item, W)}|${String(r.turns).padStart(6)} |${String(r.calls).padStart(10)} |` +
      `${("$" + r.cost.toFixed(4)).padStart(9)} | ${r.correct ? "✓" : "✗"}`,
  );
}

// --- 3. the guard ---------------------------------------------------------
// Re-pointing is not magic, and the interesting question is what it does when
// the new value is not on the page. The recorded arg is a positional handle
// from another run; reusing it would click whatever sits there now, report
// success, and leave the wrong thing in the cart.
const MISSING = "Hydraulic Press 9000";
console.log("\n──────── guard: re-pointed at something that isn't there ────────");
{
  const env = newEnv();
  const goal = goalFor(MISSING);
  const tracer = new FileTracer({ liveOnly: true });
  try {
    const result = await run({
      goal,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode: replayMode(recorded, { params: { item: MISSING } }),
      tracer,
      params: { item: MISSING },
    });
    const world = await env.observe();
    const cartLine = world.summary.slice(world.summary.indexOf("Cart"), world.summary.indexOf("Cart") + 120);
    const errored = tracer
      .session!.turns.flatMap((t) => t.toolResults)
      .some((b) => b.type === "tool_result" && b.isError);
    const empty = /empty|0 item/i.test(cartLine) || !/\$/.test(cartLine);
    console.log(`  ${result.outcome} · tool call failed: ${errored ? "yes" : "NO"} · cart empty: ${empty ? "yes" : "NO"}`);
    if (!errored || !empty) {
      console.error(
        "\n  A re-pointed replay that cannot find its target must fail the call and" +
          "\n  leave the world alone. It did not — that is a silent wrong action.",
      );
      process.exit(1);
    }
    console.log("  failed cleanly and put nothing in the cart.");
  } finally {
    await env.dispose();
  }
}

console.log(
  [
    "",
    "Note the replayed summaries still name the RECORDED item. That is the",
    "recorded model's sentence, kept as it was: no model ran, so nothing rewrote",
    "it — and substituting the name in would have produced a fluent sentence with",
    "the recorded run's price still inside it. A replay re-executes actions; it",
    "does not re-write narration. Judge it by the cart.",
  ].join("\n"),
);

const wrong = rows.filter((r) => !r.correct);
console.log(
  `\n${rows.length} re-pointed replays · ${rows.reduce((n, r) => n + r.calls, 0)} model calls · $${rows
    .reduce((n, r) => n + r.cost, 0)
    .toFixed(4)}`,
);
if (wrong.length > 0) {
  console.log(`\n${wrong.length} did not end with the right cart: ${wrong.map((r) => r.item).join(", ")}`);
  process.exit(1);
}
console.log("every re-pointed replay left the right cart behind.");
