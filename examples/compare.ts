/**
 * The money table: the SAME goals run under speed, accuracy, and replay, with
 * real wall-clock / calls / cost / outcome side by side.
 *
 *   npm run compare                        both goals, one run each
 *   npx tsx examples/compare.ts --goals a  just the bill
 *   npx tsx examples/compare.ts --goals b --modes speed --runs 3
 *
 * Two goals, because a cost ratio on its own is a bad argument.
 *
 *   A. THE BILL — "add the cheapest Camping item". Both modes get this right
 *      every time, so the only thing the columns differ by is price. That is
 *      the honest headline: on an easy step, accuracy's plan and critic are
 *      pure overhead.
 *
 *   B. THE TRAP THAT CAUGHT NOBODY — "add every Camping and Climbing item,
 *      then report the cart's total". Ten items trips a $5 bundle discount that
 *      is NOT printed on the product cards, so summing the prices you already
 *      saw gives $690.08 while the cart charges $685.08.
 *
 *      MEASURED (2026-09-11, 3 runs each, on the fixed step cap): speed 3/3
 *      and accuracy 3/3 both reported $685.08. The trap fires on nobody, and
 *      the reason is the point of the whole talk — the cart total is
 *      re-observed into EVERY request, so there is no stale number to be fooled
 *      by. Kept because a negative result that survives three runs per mode is
 *      worth more than the gotcha it was built to be.
 *
 *      What it did find is in the cost column, across every completed accuracy
 *      run of this goal: four batched their ten clicks into 3-4 turns and cost
 *      $0.147-$0.188; two clicked one at a time, took 12 turns, and cost $0.379
 *      and $0.387. Nothing in the goal or the harness picks that — a per-turn
 *      critic just multiplies whatever turn count the model lands on.
 *
 *      And a harness lesson worth more than either: MAX_STEPS_B used to be 12,
 *      one turn above this task's floor, so two one-at-a-time runs ended at the
 *      cap with a full cart and no answer. Same 10 clicks, same 3 update_plan
 *      calls, zero tool errors as the runs that finished — the only difference
 *      was one bookkeeping turn. A cap at the minimum measures your config, not
 *      the mode.
 *
 * Goal B is run `--runs` times per mode, because "did it verify?" is a HIT
 * RATE, not a single result. One run proves nothing about a coin. The DEFAULT
 * is 1 run, though: at 3 runs a full `npm run compare` is about a dollar, which
 * is not a button you want to lean on by accident. The recorded hit rates came
 * from `--runs 3`.
 *
 * Every claim here is checked against the world — the cart's rendered total —
 * never against the model's summary prose. The summary is only inspected to
 * see WHICH number it chose to report, which is the whole experiment.
 *
 * Runs against examples/site/shop.html over file://, so it is deterministic
 * and needs no network. Costs real money: speed is Haiku, accuracy is Opus
 * with a planner and a per-turn critic.
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
  costOfSession,
  type ExecutionMode,
  type Goal,
  type RunResult,
  type Session,
} from "@cadence/core";
import { FileTracer } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import {
  speedMode,
  accuracyMode,
  replayMode,
  legacyMode,
  SCRATCH_PARSE_FAILURES,
  SCRATCH_REPAIRS,
} from "@cadence/modes";
import { BrowserEnv } from "@cadence/env-browser";
import { demoFlags } from "./flags";

const START_URL = pathToFileURL(path.resolve("examples/site/shop.html")).href;

/** What the page actually charges for all ten items, and the trap beside it. */
const TRUE_TOTAL = "685.08";
const SUBTOTAL_TRAP = "690.08";
/** The one right answer for goal A. */
const CHEAPEST_CAMPING = "Titanium Tent Stakes";

/**
 * Step cap for goal B, with real headroom on purpose.
 *
 * The floor is 11 turns if the model clicks one item at a time (10 clicks +
 * complete), and accuracy spends further turns on update_plan bookkeeping. At
 * 12 — which is what this was — a single update_plan that did not ride along
 * with a click was the difference between `completed` and `max_steps`,
 * measured: two runs finished on turn 12 and two identical ones (same 10
 * clicks, same 3 update_plan calls, zero tool errors) ran out. A cap set at
 * the minimum viable turn count does not measure the mode, it measures
 * whether the model happened to batch.
 */
const MAX_STEPS_B = 18;

const GOAL_A: Goal = {
  id: "compare-cheapest",
  description:
    "You are on the Trailhead Supply store page. Add the cheapest item in the " +
    'Camping category to the cart (exactly one item), then call complete with status "success". ' +
    "Read prices from the page; do not guess.",
  successCriteria: "The cart contains exactly one item: the cheapest Camping product.",
};

const GOAL_B: Goal = {
  id: "compare-cart-total",
  description:
    "You are on the Trailhead Supply store page. Add every item in the Camping category " +
    "and every item in the Climbing category to the cart — ten items in total. Then call " +
    "complete, reporting the cart's total exactly as the cart shows it. Read the total from " +
    "the cart itself; do not add up the prices yourself.",
  successCriteria:
    "The cart holds all ten Camping and Climbing items, and the reported total is the " +
    "total the cart displays.",
};

// --- flags -----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = demoFlags(argv, process.env, ["runs", "modes", "goals"]);
const valueOf = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Math.max(1, Math.min(10, Number(valueOf("runs") ?? 1) || 1));
const MODES = (valueOf("modes") ?? "speed,accuracy").split(",").map((s) => s.trim());
const GOALS = (valueOf("goals") ?? "a,b").split(",").map((s) => s.trim().toLowerCase());

function newEnv(): BrowserEnv {
  return new BrowserEnv({
    startUrl: START_URL,
    headless: !flags.headed,
    ...(flags.viewport ? { viewport: flags.viewport } : {}),
    representation: "cleaned",
    pageTextLimit: 4_000,
    maxElements: 60,
  });
}

/** A mode fresh each time: accuracy keeps plan state on the instance. */
function modeFor(name: string, maxSteps: number): ExecutionMode {
  if (name === "accuracy") return accuracyMode({ maxSteps });
  // Same loop, same tools — the pre-native-tool-use protocol. Included here so
  // it is measured on the SAME goals and the same verification as the rest,
  // rather than on a bench of its own where it could be flattered.
  if (name === "legacy") return legacyMode({ maxSteps });
  return speedMode({ maxSteps });
}

interface Outcome {
  goal: string;
  mode: string;
  result: RunResult;
  cost: number;
  /** What the world looked like afterwards. */
  cartItems: number;
  cartTotal: string;
  /** The number the model chose to report, if we can find one. */
  reported: "read" | "inferred" | "other" | "none";
  correct: boolean;
  session: Session;
  /** legacy only: replies that could not be parsed, and repairs that worked. */
  parseFailures: number;
  repairs: number;
}

/** Pull "Total: $685.08" out of the page the model was looking at. */
function readCart(summary: string): { items: number; total: string } {
  const total = /Total:\s*\$([\d,]+\.\d\d)/.exec(summary)?.[1] ?? "?";
  const items = Number(/Cart \((\d+) items?\)/.exec(summary)?.[1] ?? "0");
  return { items, total };
}

function completionSummary(session: Session): string {
  const args = session.turns
    .flatMap((t) => t.actions)
    .find((a) => a.tool === "complete")?.args as { summary?: string } | undefined;
  return args?.summary ?? "";
}

async function once(goal: Goal, modeName: string, maxSteps: number): Promise<Outcome> {
  const env = newEnv();
  const tracer = new FileTracer();
  // Modes keep their private counters here; passing one in is how a caller
  // reads them back without reimplementing the loop.
  const scratch: Record<string, unknown> = {};
  try {
    const result = await run({
      scratch,
      goal,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode: modeFor(modeName, maxSteps),
      tracer,
      onEvent: (e) => {
        if (e.type === "action") process.stdout.write(".");
      },
    });
    const world = await env.observe();
    const cart = readCart(world.summary);
    const said = completionSummary(tracer.session!);

    let reported: Outcome["reported"] = "none";
    if (said.includes(TRUE_TOTAL)) reported = "read";
    else if (said.includes(SUBTOTAL_TRAP)) reported = "inferred";
    else if (/\$[\d,]+\.\d\d/.test(said)) reported = "other";

    const correct =
      goal.id === GOAL_A.id
        ? cart.items === 1 && world.summary.includes(CHEAPEST_CAMPING)
        : cart.items === 10 && reported === "read";

    return {
      goal: goal.id,
      mode: modeName,
      result,
      cost: costOfSession(tracer.session!),
      cartItems: cart.items,
      cartTotal: cart.total,
      reported,
      correct,
      session: tracer.session!,
      parseFailures: Number(scratch[SCRATCH_PARSE_FAILURES] ?? 0),
      repairs: Number(scratch[SCRATCH_REPAIRS] ?? 0),
    };
  } finally {
    await env.dispose();
  }
}

/** Replay the recorded speed run of goal A — no model, no tokens, no cost. */
async function replayOf(source: Session): Promise<Outcome> {
  const env = newEnv();
  // liveOnly: the durable recording already exists; replaying it on stage
  // shouldn't mint a near-duplicate trace every time.
  const tracer = new FileTracer({ liveOnly: true });
  try {
    const result = await run({
      goal: GOAL_A,
      env,
      tools: new ToolRegistry([...env.availableTools(), completionTool(GOAL_A)]),
      model: resilient(new AnthropicModelClient()),
      mode: replayMode(source),
      tracer,
    });
    const world = await env.observe();
    const cart = readCart(world.summary);
    return {
      goal: GOAL_A.id,
      mode: "replay",
      result,
      cost: costOfSession(tracer.session!),
      cartItems: cart.items,
      cartTotal: cart.total,
      reported: "none",
      correct: cart.items === 1 && world.summary.includes(CHEAPEST_CAMPING),
      session: tracer.session!,
      parseFailures: 0,
      repairs: 0,
    };
  } finally {
    await env.dispose();
  }
}

// --- run it ----------------------------------------------------------------
if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("Set ANTHROPIC_API_KEY before running the comparison (speed + accuracy are live).");
  process.exit(1);
}

const pad = (s: string, n: number): string => s.padEnd(n);
const money = (n: number): string => `$${n.toFixed(4)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const billRows: Outcome[] = [];
if (GOALS.includes("a")) {
  console.log("\n════════ A. the bill — same goal, one right answer ════════");
  for (const mode of MODES) {
    process.stdout.write(`  ${pad(mode, 9)}`);
    const out = await once(GOAL_A, mode, 8);
    billRows.push(out);
    console.log(
      ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
        `${money(out.cost)} · cart ${out.correct ? "correct" : "WRONG"}`,
    );
  }
  // Replay walks whichever speed run we just recorded.
  const speedRun = billRows.find((r) => r.mode === "speed");
  if (speedRun) {
    process.stdout.write(`  ${pad("replay", 9)}`);
    const out = await replayOf(speedRun.session);
    billRows.push(out);
    console.log(
      ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
        `${money(out.cost)} · cart ${out.correct ? "correct" : "WRONG"}`,
    );
  }
}

const verifyRows: Outcome[] = [];
if (GOALS.includes("b")) {
  console.log(
    `\n════════ B. the reason — did it read the total, or add it up? (${RUNS} runs each) ════════`,
  );
  console.log(`  the cart charges $${TRUE_TOTAL}; the prices on the cards sum to $${SUBTOTAL_TRAP}\n`);
  for (const mode of MODES) {
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${pad(`${mode} #${i + 1}`, 13)}`);
      const out = await once(GOAL_B, mode, MAX_STEPS_B);
      verifyRows.push(out);
      const verdict =
        out.reported === "read"
          ? `read the cart ($${TRUE_TOTAL})`
          : out.reported === "inferred"
            ? `ADDED IT UP ($${SUBTOTAL_TRAP})`
            : out.reported === "other"
              ? "some other number"
              : "no number at all";
      console.log(
        ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
          `${money(out.cost)} · ${out.cartItems}/10 in cart · ${verdict}`,
      );
    }
  }
}

// --- the tables ------------------------------------------------------------
if (billRows.length > 0) {
  console.log("\n\n## A. Same goal, three execution modes\n");
  console.log("| Mode | Turns | Calls | Wall | Cost | Cart |");
  console.log("|---|---|---|---|---|---|");
  for (const r of billRows) {
    console.log(
      `| ${r.mode} | ${r.result.steps} | ${r.result.totals.llmCalls} | ${secs(r.result.totals.wallMs)} | ` +
        `${money(r.cost)} | ${r.correct ? "✓" : "✗"} |`,
    );
  }
  const speed = billRows.find((r) => r.mode === "speed");
  const acc = billRows.find((r) => r.mode === "accuracy");
  if (speed && acc && speed.cost > 0) {
    console.log(
      `\n${(acc.cost / speed.cost).toFixed(1)}× the cost and ` +
        `${(acc.result.totals.wallMs / speed.result.totals.wallMs).toFixed(1)}× the wall clock ` +
        `for the same one item in the cart.`,
    );
  }
}

if (verifyRows.length > 0) {
  console.log("\n\n## B. Did it report a number it read, or one it worked out?\n");
  console.log("| Mode | Runs | Read the cart | Added it up | Other | Cost each |");
  console.log("|---|---|---|---|---|---|");
  for (const mode of MODES) {
    const rows = verifyRows.filter((r) => r.mode === mode);
    if (rows.length === 0) continue;
    const n = (k: Outcome["reported"]): number => rows.filter((r) => r.reported === k).length;
    const avg = rows.reduce((a, r) => a + r.cost, 0) / rows.length;
    console.log(
      `| ${mode} | ${rows.length} | **${n("read")}** | ${n("inferred")} | ` +
        `${n("other") + n("none")} | ${money(avg)} |`,
    );
  }
  const wrongCarts = verifyRows.filter((r) => r.cartItems !== 10);
  if (wrongCarts.length > 0) {
    console.log(
      `\n${wrongCarts.length} run(s) didn't even get ten items in the cart: ` +
        wrongCarts.map((r) => `${r.mode} (${r.cartItems})`).join(", "),
    );
  }
  console.log(
    "\nJudge these by the cart, not by the sentence. The trap is not arithmetic —" +
      "\nboth numbers are correct sums of something. It is whether the model went back" +
      "\nand looked after it acted.",
  );
}

// The failure class native tool use cannot have. Printed whenever a legacy
// run is in the set, including when it is zero — "it never failed to parse"
// is the interesting number, and it only means something if it was looked for.
const legacyRows = [...billRows, ...verifyRows].filter((r) => r.mode === "legacy");
if (legacyRows.length > 0) {
  const failed = legacyRows.reduce((a, r) => a + r.parseFailures, 0);
  const fixed = legacyRows.reduce((a, r) => a + r.repairs, 0);
  const calls = legacyRows.reduce((a, r) => a + r.result.totals.llmCalls, 0);
  console.log(
    `
json-in-text parsing: ${failed} unparseable repl${failed === 1 ? "y" : "ies"} ` +
      `across ${calls} model call(s) in ${legacyRows.length} run(s); ` +
      `${fixed} recovered by a repair round-trip.`,
  );
}

console.log("\ntraces written to traces/ — bind the interesting ones to the slide.");
