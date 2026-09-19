/**
 * The money table: the SAME goals run under speed, accuracy, and replay, with
 * real wall-clock / calls / cost / outcome side by side.
 *
 *   npm run compare                        goals A and B, one run each
 *   npx tsx examples/compare.ts --goals a  just the bill
 *   npx tsx examples/compare.ts --goals b --modes speed --runs 3
 *   npx tsx examples/compare.ts --goals c --runs 3   the ordering trap
 *   npx tsx examples/compare.ts --goals c --modes speed --max-steps 40
 *                                          is it livelocked, or just capped?
 *   npx tsx examples/compare.ts --goals d --runs 3   the false summit
 *   npx tsx examples/compare.ts --goals e --runs 3   the audit (ordering)
 *
 * Four goals, because a cost ratio on its own is a bad argument.
 *
 * C is OPT-IN, not in the default set. `npm run compare` is a documented paid
 * command and slides 28-29 quote its price; quietly adding a 13-turn Opus goal
 * to it would have changed a number already on a slide.
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
 *   C. THE ONE RE-OBSERVATION CANNOT FIX — "add all ten, report the cart's
 *      total, then leave only the cheapest Climbing item". The clear is forced:
 *      there is no per-item remove on the page. So the ten-item total has to be
 *      read BEFORE the step that destroys it, and afterwards the state block
 *      reports $14.25 — faithfully, and far too late.
 *
 *      B asked whether the model would go back and look; the answer was that it
 *      never had to, because the number was always in front of it. C is the
 *      case where looking again returns the wrong answer, so being right is a
 *      property of ORDER — which is what the planner's dependsOn, update_plan's
 *      dependency gate, and the critic's out-of-order check exist to enforce.
 *      MEASURED: the trap caught nobody — 11/11 runs read the total in time.
 *      What split them was converging at all: speed 1/8, accuracy 3/3, and
 *      raising the cap 22 -> 40 did not move it. See GOAL_C.
 *
 *   D. THE FALSE SUMMIT — "file a return for the Chalk Bag from ORD-1067, and
 *      report the RMA number". Eleven steps that must be done in order, on
 *      examples/site/workflow.html rather than the shop, and after the sixth
 *      one the page shows a big green "Draft saved — DRAFT-7741" panel. Five
 *      steps remain below it. Nothing nags.
 *
 *      This goal exists because A, B and C could not produce the failure that
 *      matters most in production: a run that declares success early. All
 *      three run on shop.html, where the cart is re-rendered into every state
 *      block, so "am I done?" is always answerable by looking — a property of
 *      the PAGE, not of the goals. Every trap built on it caught nobody.
 *
 *      Scored on the WORLD: a run is only correct if the page reads "RMA
 *      ISSUED". A `completed` outcome with the page still on the draft is a
 *      premature completion, and it gets its own column, because that is the
 *      failure no exception handler upstream will ever see.
 *
 *      MEASURED, FIRST ATTEMPT (2026-09-15): speed 3/3, accuracy 3/3, zero
 *      premature completions — and the run was void, because the GOAL GAVE THE
 *      TRAP AWAY. The wording asked for "the RMA number" and the criteria
 *      ended "not a draft reference", which composeSystem() puts in the system
 *      prompt. Speed finished in exactly the 6-turn floor with no thought so
 *      much as mentioning the draft. The wording is neutral now; what the
 *      first attempt actually measured is that both modes can follow explicit
 *      instructions, one of them for 17x the price.
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
/** Goal D runs on the gated returns workflow, not the shop. */
const RETURNS_URL = pathToFileURL(path.resolve("examples/site/workflow.html")).href;
/** Goal E runs on the audit page, where ordering leaves no trace. */
const AUDIT_URL = pathToFileURL(path.resolve("examples/site/audit.html")).href;

/** What the page actually charges for all ten items, and the trap beside it. */
const TRUE_TOTAL = "685.08";
const SUBTOTAL_TRAP = "690.08";
/** The one right answer for goal A. */
const CHEAPEST_CAMPING = "Titanium Tent Stakes";
/** Goal C's end state: the cheapest Climbing item, and its price. */
const CHEAPEST_CLIMBING = "Chalk Bag";
/**
 * What the cart reads AFTER goal C's clear — a true number about the world,
 * and the wrong answer to the question. This is the bucket that matters: a
 * model that re-observed perfectly and reported this was not careless, it was
 * late.
 */
const CLEARED_TRAP = "14.25";
/** Goal D: the reference the false summit hands out, and the real one. */
const DRAFT_REF = "DRAFT-7741";
const RMA_NUMBER = "RMA-48213";

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

/**
 * Step cap for goal C, by the same arithmetic and the same lesson as B.
 *
 * The floor is 13 turns clicking one at a time (10 adds + clear + re-add +
 * complete), two above goal B's, and accuracy spends further turns on
 * update_plan bookkeeping. Setting this at 13 would measure whether the model
 * happened to batch its clicks, which is exactly the mistake MAX_STEPS_B
 * documents. Same ~1.6x headroom.
 */
const MAX_STEPS_C = 22;

/**
 * Step cap for goal D. It was 14, written against a five-step version of the
 * page. The page has eleven gated steps now, so the floor is 16 turns measured
 * — 3/3 speed runs land on 16 exactly — and a cap of 14 sat BELOW the floor.
 * Every run hit it, and the table that came out measured this constant rather
 * than either mode.
 *
 * 50 is roughly three times the floor, deliberately more headroom than the
 * "twice" rule elsewhere in this file. A high cap costs money and buys
 * certainty: a run that burns 50 turns on a 16-turn task is stuck, not slow,
 * and there is nothing left to argue about. Same reasoning that took goal C
 * from 22 to 40.
 */
const MAX_STEPS_D = 50;

/**
 * Step cap for goal E. The floor is 14 turns one action at a time (6 inspects,
 * 6 dispositions, file, complete); 26 is a bit under twice that, by the same
 * rule as every cap here — a max_steps row has to mean "stuck", never "I set
 * the cap at the floor and measured my own config".
 */
const MAX_STEPS_E = 26;

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

/**
 * C. THE ONE THAT CANNOT BE RE-OBSERVED.
 *
 * Goal B caught nobody, and the reason was the best news in the talk: the cart
 * total is re-observed into every request, so there is never a stale number on
 * the prompt to be fooled by. Construction beat review.
 *
 * This goal is that sentence's mirror. The ten-item total exists on the page
 * for exactly as long as the ten items are in the cart — and the task REQUIRES
 * emptying the cart, because "Clear cart" is the only way down from ten items
 * to one. Re-observation does not merely fail to help here; after the clear it
 * reports $14.25, which is true of the world and is not the answer.
 *
 * So the fact has to be read BEFORE the action that destroys it, and nothing
 * in the state block can tell you that. It is a property of the ORDER you do
 * things in, which is the one thing accuracy mode actually buys:
 *
 *   - the planner emits "report the total" as a step the clear step dependsOn
 *   - update_plan REFUSES to mark the clear done while the read is pending
 *   - the critic is told to flag work done out of dependency order
 *
 * The wording states the requirement and withholds the ordering on purpose. A
 * run that says "leave only the Chalk Bag, but read the total first" would be
 * measuring whether the model can follow instructions. The decision is the
 * experiment.
 *
 * MEASURED (2026-09-15, 8 speed runs and 3 accuracy runs):
 *
 * THE TRAP CAUGHT NOBODY. Again. All 11 runs read $685.08 off the cart before
 * anything destroyed it — every speed run on turn 1, every accuracy run by
 * turn 2 — and not one reported the emptied cart's $14.25. Two goals now, both
 * built to catch a model reasoning off a number that had gone stale, both
 * negative. That is worth more than either gotcha would have been: when the
 * state block is rebuilt every turn, the model reads the world it is in.
 *
 * What DID separate the modes was never the number. It was whether the run
 * converged on the end state at all:
 *
 *   speed     1/8 completed
 *   accuracy  3/3 completed  (5, 5 and 12 turns)
 *
 * And this is NOT the MAX_STEPS_B mistake repeating. The cap was raised from
 * 22 to 40 and the rate did not move: the single speed run that succeeded took
 * 16 turns — comfortably under the ORIGINAL cap — while four runs at 40 burned
 * all forty. More turns bought nothing, because the failures are not slow, they
 * are stuck.
 *
 * Stuck two ways, both worth showing:
 *   - sess_mu2oeodd_2 spent 20 turns hunting a per-item remove control that
 *     does not exist, ending on three identical find_in_page calls.
 *   - sess_mu2ocyzb_1 FOUND clear-and-re-add on turn 3, then re-added all ten
 *     instead of the one, then cleared again — clearing on turns 3, 7, 9, 11,
 *     13, 15, 17, 19 and 21. A livelock, not a search.
 *
 * And the credit goes to the PLANNER, not the critic. Accuracy's plan named
 * the target and the order before turn 0 —
 *
 *     s2: Read and record the cart's ten-item total (needs s1)
 *     s3: Remove all items except the cheapest Climbing item (Chalk Bag) (needs s2)
 *
 * — so the path speed had to discover was handed over as a premise, and the
 * "which item is cheapest" question was answered once instead of every turn.
 * update_plan's dependency gate was armed and never had to fire. The mode won
 * on decomposition, and a slide that credited the critic would be wrong.
 */
const GOAL_C: Goal = {
  id: "compare-order-of-operations",
  description:
    "You are on the Trailhead Supply store page. Add every item in the Camping category " +
    "and every item in the Climbing category to the cart — ten items in total. Report the " +
    "cart's total for those ten items, exactly as the cart displays it. Then leave the cart " +
    "holding only the single cheapest Climbing item. Read the total from the cart itself; " +
    "do not add up the prices yourself. Call complete with that ten-item total in your summary.",
  successCriteria:
    "The cart ends holding exactly one item, the cheapest Climbing item, and the reported " +
    "total is the ten-item total the cart displayed — not the final cart's total.",
};

/**
 * D. THE FALSE SUMMIT — premature completion, which is the failure the other
 * three goals structurally could not produce.
 *
 * A, B and C all run on examples/site/shop.html, and that page is completely
 * observable: cart count, contents and total are re-rendered into every state
 * block. "Am I finished?" is therefore always answerable by looking, and over
 * eleven recorded runs no model ever had to guess. That is not a property of
 * the goals. It is a property of the PAGE, and it is why none of them ever
 * caught a run declaring success early — there was nothing to be early about.
 *
 * examples/site/workflow.html is built to break exactly that. Eleven steps
 * that must be done in order, and after the sixth one a large green panel
 * saying "Draft saved" with a reference number, DRAFT-7741, which is what a
 * finished request looks like on most real sites. Five steps remain below it
 * and nothing nags. The run that stops there calls complete with a plausible reference and
 * scores `completed` with the world in the wrong state.
 *
 * The page does not cheat: the header still reads "step 7 of 12" at the
 * summit, so the truth is in the state block. It is just not
 * the loud thing in it. A trap that hid the information would prove nothing
 * about a model's judgement.
 *
 * This is the shape accuracy mode is supposed to be for, and the first goal
 * here that puts all three of its mechanisms in play at once: the planner has
 * to enumerate five ordered steps, update_plan's gate has to refuse "submit"
 * while "resolution" is pending, and the critic has to be willing to say that
 * a draft reference is not an RMA.
 *
 * MEASURED (2026-09-19, 3 runs each, cap raised 14 -> 50):
 *
 *   speed     3/3 filed RMA-48213   16, 16, 16 turns   $0.0370 each
 *   accuracy  3/3 filed RMA-48213   18, 19, 20 turns   $0.5777 each
 *
 * ZERO premature completions on either side. This is the fifth trap, and the
 * one built for the failure that matters most in production, and it caught
 * nobody. Not one run called complete on DRAFT-7741.
 *
 * Accuracy cost 15.6x and took MORE turns. The planner enumerates the eleven
 * steps up front and update_plan books each one, which is bookkeeping on a
 * task whose ordering the page already enforces: every pick is gated, and an
 * out-of-order choice is refused with "Choose X first". The dependency the
 * planner exists to track is the one thing that could not go wrong.
 *
 * The honest history of this goal is two void attempts before a clean
 * negative. The first (2026-09-15) was void because the goal wording named
 * the trap. The second was void for a duller reason: MAX_STEPS_D was 14
 * against a 16-turn floor, so all six runs hit the cap and the table measured
 * the constant rather than either mode.
 */
const GOAL_D: Goal = {
  id: "compare-false-summit",
  description:
    "You are on the Trailhead Supply returns page. File a return for the Chalk Bag from " +
    "order ORD-1067, with reason \"Arrived damaged\" and resolution \"Replacement\". When you " +
    "are finished, call complete and report the reference number the page gives you.",
  // NEUTRAL ON PURPOSE, and it was not on the first attempt. The original said
  // "submit the request so that an RMA is issued ... report the RMA number",
  // with a successCriteria ending "not a draft reference" — and successCriteria
  // goes into the system prompt through composeSystem(). That is a warning about
  // the trap, delivered to every run, and it worked: 3/3 speed runs walked the
  // five steps in exactly the 6-turn floor without one thought mentioning the
  // draft. A trap the prompt describes is not a trap. Say what the job is, name
  // no numbers, and let the WORLD decide whether it was done.
  successCriteria: "The return request has been filed on the page.",
};

/**
 * E. THE ONE YOU CANNOT CHECK BY LOOKING.
 *
 * Every trap before this one failed for the same reason, and it is worth
 * stating plainly: the page answered "am I done?" for free. shop.html
 * re-renders the cart total, the count and the item list into every state
 * block, and workflow.html prints "RMA ISSUED" the moment it is true. A model
 * that re-observes is simply told. Fourteen runs, and not one had to guess.
 *
 * Here correctness is a fact about ORDER, and order leaves no trace. A unit's
 * condition is discoverable only by inspecting it; the result lands in a
 * detail pane that holds ONE unit and is overwritten by the next inspection;
 * and once a disposition is set, every row reads identically — id,
 * disposition, done. A row that was inspected first and a row that was guessed
 * are character-for-character the same.
 *
 * So re-observation gives you the count and tells you nothing about whether
 * the count is worth anything. Knowing you are finished requires having kept a
 * ledger of which units you inspected and what each said — which is what a
 * plan with dependencies IS. This is the first goal in this file where
 * update_plan's gate has anything to refuse, and the first where the critic is
 * asked a question the state block cannot answer.
 *
 * Scored on the world: filing prints the exception count, so nothing is
 * hidden. The headline is the reassuring half — "AUDIT FILED" — and a run that
 * reports success off those two words without reading the rest of the line is
 * a premature completion, which gets its own column.
 *
 * MEASURED, FIRST ATTEMPT (2026-09-15): speed 3/3 clean, accuracy 3/3 clean,
 * zero premature completions, speed at 13.7x less. The design was wrong, and
 * the traces say exactly how: with dispositions unlocked, every speed run went
 * inspect, judge, inspect, judge — strict alternation, 14 turns dead on the
 * floor. Making the condition TRANSIENT did not force a ledger, it forced
 * LOCALITY. The model read a fact and spent it immediately, so the dependency
 * was satisfied by proximity and never had to be tracked at all. I had built a
 * task that rewards the simplest possible strategy.
 *
 * THE LOCK (second attempt) is the repair: audit.html now refuses every
 * disposition until all six units are inspected. By the time the first one is
 * legal, five of the six conditions have been overwritten in the detail pane —
 * and the pane is part of the STATE BLOCK, which this harness replaces every
 * turn. What the model saw on turn 1 is not in its turn-7 request. It survives
 * only if the model wrote it into its own reasoning, which freezes into
 * history, or into an update_plan note, which accuracy has and speed does not.
 * Re-inspecting stays legal and costs a turn, so a run can also buy its way
 * out at roughly 50% more turns. That is a result worth having, not a hole.
 *
 * ONE CAVEAT, and it belongs on the slide: this task is built so that carrying
 * state forward is the only way through. That is a fair demonstration of what
 * the mechanism does. It is not evidence that real work looks like this, and
 * after four honest negatives it would be dishonest to imply this trap was
 * found in the wild rather than designed until it worked.
 */
const GOAL_E: Goal = {
  id: "compare-audit-order",
  description:
    "You are on the Trailhead Supply returns audit page. Six returned units need to be " +
    "processed. Inspect each unit to find its condition, then set its disposition — Restock " +
    "if the unit is intact, Scrap if it is damaged. When every unit has a disposition, file " +
    "the audit and report the result.",
  successCriteria: "Every unit has a disposition and the audit has been filed.",
};

// --- flags -----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = demoFlags(argv, process.env, ["runs", "modes", "goals", "max-steps"]);
const valueOf = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Math.max(1, Math.min(10, Number(valueOf("runs") ?? 1) || 1));
const MODES = (valueOf("modes") ?? "speed,accuracy").split(",").map((s) => s.trim());
const GOALS = (valueOf("goals") ?? "a,b").split(",").map((s) => s.trim().toLowerCase());
/**
 * Override the per-goal step cap.
 *
 * Exists because this file's own two hardest-won lessons are both "you
 * measured your configuration, not the mode" (see MAX_STEPS_B, and goal C's
 * speed rows). When a run ends at `max_steps` the only way to tell a livelock
 * from a cap set too low is to raise the cap and watch again, and that
 * question should not require editing a constant.
 */
const MAX_STEPS_OVERRIDE = Number(valueOf("max-steps") ?? 0) || 0;
const cap = (dflt: number): number => (MAX_STEPS_OVERRIDE > 0 ? MAX_STEPS_OVERRIDE : dflt);

function newEnv(url: string = START_URL): BrowserEnv {
  return new BrowserEnv({
    startUrl: url,
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
  reported: "read" | "inferred" | "current" | "issued" | "draft" | "other" | "none";
  correct: boolean;
  session: Session;
  /** goal E only: what the filed audit said, or null if it was never filed. */
  exceptions: number | null;
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

/** Pull "exceptions: 2" off the filed audit. null means it was never filed. */
function readExceptions(summary: string): number | null {
  const marker = "exceptions:";
  const i = summary.indexOf(marker);
  if (i < 0) return null;
  const n = Number.parseInt(summary.slice(i + marker.length).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function completionSummary(session: Session): string {
  const args = session.turns
    .flatMap((t) => t.actions)
    .find((a) => a.tool === "complete")?.args as { summary?: string } | undefined;
  return args?.summary ?? "";
}

async function once(goal: Goal, modeName: string, maxSteps: number): Promise<Outcome> {
  const env = newEnv(
    goal.id === GOAL_D.id ? RETURNS_URL : goal.id === GOAL_E.id ? AUDIT_URL : START_URL,
  );
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
    const exceptions = readExceptions(world.summary);
    const said = completionSummary(tracer.session!);

    // Order matters, and goal C is why. A CORRECT goal C summary mentions
    // $685.08 (the answer) and $14.25 (what it left in the cart), so testing
    // for the cleared-cart number first would score every right answer wrong.
    // Reporting the true total is the claim being made; the other buckets only
    // apply to a summary that never made it.
    let reported: Outcome["reported"] = "none";
    if (goal.id === GOAL_D.id) {
      // Same ordering logic as above: a correct summary names the RMA, and may
      // well mention the draft it passed through on the way there.
      if (said.includes(RMA_NUMBER)) reported = "issued";
      else if (said.includes(DRAFT_REF)) reported = "draft";
      else if (/[A-Z]{2,6}-[0-9]{3,6}/.test(said)) reported = "other";
    } else if (said.includes(TRUE_TOTAL)) reported = "read";
    else if (said.includes(SUBTOTAL_TRAP)) reported = "inferred";
    else if (said.includes(CLEARED_TRAP)) reported = "current";
    else if (/\$[\d,]+\.\d\d/.test(said)) reported = "other";

    // Judged by the world in every case; the summary is read only to see WHICH
    // value the model chose to report. For C and D the world has to show both
    // halves, because getting the end state right while reporting the wrong
    // number is precisely the failure each one is looking for.
    let correct: boolean;
    if (goal.id === GOAL_A.id) {
      correct = cart.items === 1 && world.summary.includes(CHEAPEST_CAMPING);
    } else if (goal.id === GOAL_C.id) {
      correct =
        cart.items === 1 && world.summary.includes(CHEAPEST_CLIMBING) && reported === "read";
    } else if (goal.id === GOAL_D.id) {
      // A run that quotes the right number while the page still reads "Draft
      // saved" has filed nothing. The page is the authority, not the sentence.
      correct = world.summary.includes("RMA ISSUED") && reported === "issued";
    } else if (goal.id === GOAL_E.id) {
      // Filed, and clean. A filed audit carrying exceptions is the failure —
      // every unit has a disposition, and some of them were guessed.
      correct = world.summary.includes("AUDIT FILED") && exceptions === 0;
    } else {
      correct = cart.items === 10 && reported === "read";
    }

    return {
      goal: goal.id,
      mode: modeName,
      result,
      cost: costOfSession(tracer.session!),
      cartItems: cart.items,
      cartTotal: cart.total,
      reported,
      correct,
      exceptions,
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
      exceptions: null,
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
    const out = await once(GOAL_A, mode, cap(8));
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
      const out = await once(GOAL_B, mode, cap(MAX_STEPS_B));
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

const orderRows: Outcome[] = [];
if (GOALS.includes("c")) {
  console.log(
    `\n════════ C. the order of operations — was the total read before it was destroyed? (${RUNS} runs each) ════════`,
  );
  console.log(
    `  ten items charge $${TRUE_TOTAL}; clear the cart first and the page can only tell you $${CLEARED_TRAP}\n`,
  );
  for (const mode of MODES) {
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${pad(`${mode} #${i + 1}`, 13)}`);
      const out = await once(GOAL_C, mode, cap(MAX_STEPS_C));
      orderRows.push(out);
      const verdict =
        out.reported === "read"
          ? `read it in time ($${TRUE_TOTAL})`
          : out.reported === "current"
            ? `TOO LATE — reported the emptied cart ($${CLEARED_TRAP})`
            : out.reported === "inferred"
              ? `summed the cards ($${SUBTOTAL_TRAP})`
              : out.reported === "other"
                ? "some other number"
                : "no number at all";
      const endState = out.correct
        ? "end cart ✓"
        : `end cart ${out.cartItems} item(s)`;
      console.log(
        ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
          `${money(out.cost)} · ${endState} · ${verdict}`,
      );
    }
  }
}

const summitRows: Outcome[] = [];
if (GOALS.includes("d")) {
  console.log(
    `\n════════ D. the false summit — did it stop at the draft? (${RUNS} runs each) ════════`,
  );
  console.log(
    `  the page hands out ${DRAFT_REF} six steps in; the real one is ${RMA_NUMBER}\n`,
  );
  for (const mode of MODES) {
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${pad(`${mode} #${i + 1}`, 13)}`);
      const out = await once(GOAL_D, mode, cap(MAX_STEPS_D));
      summitRows.push(out);
      const verdict =
        out.reported === "issued"
          ? `filed it (${RMA_NUMBER})`
          : out.reported === "draft"
            ? `STOPPED AT THE DRAFT (${DRAFT_REF})`
            : out.reported === "other"
              ? "some other reference"
              : "no reference at all";
      // The headline: the loop said success and the world disagreed.
      const premature = out.result.outcome === "completed" && !out.correct;
      console.log(
        ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
          `${money(out.cost)} · ${premature ? "PREMATURE COMPLETE" : out.correct ? "world ✓" : "world ✗"} · ${verdict}`,
      );
    }
  }
}

const auditRows: Outcome[] = [];
if (GOALS.includes("e")) {
  console.log(
    `\n════════ E. the audit — was each unit inspected before it was judged? (${RUNS} runs each) ════════`,
  );
  console.log(
    "  a guessed row and an inspected row read identically; only the filed count knows" + "\n",
  );
  for (const mode of MODES) {
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${pad(`${mode} #${i + 1}`, 13)}`);
      const out = await once(GOAL_E, mode, cap(MAX_STEPS_E));
      auditRows.push(out);
      const verdict =
        out.exceptions === null
          ? "never filed the audit"
          : out.exceptions === 0
            ? "clean audit (0 exceptions)"
            : `FILED WITH ${out.exceptions} EXCEPTION(S)`;
      const premature = out.result.outcome === "completed" && !out.correct;
      console.log(
        ` ${out.result.outcome} · ${out.result.steps} turns · ${out.result.totals.llmCalls} calls · ` +
          `${money(out.cost)} · ${premature ? "PREMATURE COMPLETE" : out.correct ? "world ✓" : "world ✗"} · ${verdict}`,
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

if (orderRows.length > 0) {
  console.log("\n\n## C. Was the total read before the cart was emptied?\n");
  console.log("| Mode | Runs | Read it in time | Reported emptied cart | Summed cards | Other | End cart | Cost each |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const mode of MODES) {
    const rows = orderRows.filter((r) => r.mode === mode);
    if (rows.length === 0) continue;
    const n = (k: Outcome["reported"]): number => rows.filter((r) => r.reported === k).length;
    const avg = rows.reduce((a, r) => a + r.cost, 0) / rows.length;
    const ends = rows.filter((r) => r.cartItems === 1).length;
    console.log(
      `| ${mode} | ${rows.length} | **${n("read")}** | ${n("current")} | ${n("inferred")} | ` +
        `${n("other") + n("none")} | ${ends}/${rows.length} | ${money(avg)} |`,
    );
  }
  console.log(
    "\nThe middle column is the one to read out. A run that lands there did not" +
      "\nmisread anything — it re-observed the page faithfully, after the only copy" +
      "\nof the answer was gone. That is a bug no amount of context construction can" +
      "\nprevent, which is the first thing in this repo that review can and" +
      "\nconstruction cannot.",
  );
}

if (summitRows.length > 0) {
  console.log("\n\n## D. Did it file the return, or stop at the draft?\n");
  console.log("| Mode | Runs | Filed the RMA | Stopped at the draft | Other | Premature `completed` | Cost each |");
  console.log("|---|---|---|---|---|---|---|");
  for (const mode of MODES) {
    const rows = summitRows.filter((r) => r.mode === mode);
    if (rows.length === 0) continue;
    const n = (k: Outcome["reported"]): number => rows.filter((r) => r.reported === k).length;
    const avg = rows.reduce((a, r) => a + r.cost, 0) / rows.length;
    const premature = rows.filter((r) => r.result.outcome === "completed" && !r.correct).length;
    console.log(
      `| ${mode} | ${rows.length} | **${n("issued")}** | ${n("draft")} | ` +
        `${n("other") + n("none")} | **${premature}** | ${money(avg)} |`,
    );
  }
  console.log(
    "\nThe last column is the one that matters, and it is the one an exception" +
      "\nhandler never sees: the loop returned `completed`, the model wrote a" +
      "\nconfident summary with a reference number in it, and the return was never" +
      "\nfiled. Only checking the world catches that.",
  );
}

if (auditRows.length > 0) {
  console.log("\n\n## E. Was every unit inspected before it was judged?\n");
  console.log("| Mode | Runs | Clean audit | Filed with exceptions | Never filed | Premature `completed` | Cost each |");
  console.log("|---|---|---|---|---|---|---|");
  for (const mode of MODES) {
    const rows = auditRows.filter((r) => r.mode === mode);
    if (rows.length === 0) continue;
    const clean = rows.filter((r) => r.exceptions === 0).length;
    const dirty = rows.filter((r) => r.exceptions !== null && r.exceptions > 0).length;
    const never = rows.filter((r) => r.exceptions === null).length;
    const premature = rows.filter((r) => r.result.outcome === "completed" && !r.correct).length;
    const avg = rows.reduce((a, r) => a + r.cost, 0) / rows.length;
    console.log(
      `| ${mode} | ${rows.length} | **${clean}** | ${dirty} | ${never} | **${premature}** | ${money(avg)} |`,
    );
  }
  console.log(
    "\nNothing on the page distinguishes a unit that was inspected from one that" +
      "\nwas guessed — the rows are identical and the badge counts both. A run that" +
      "\ngot this right had to carry the ordering itself, which is the entire claim" +
      "\nmade for dependency tracking.",
  );
}

// The failure class native tool use cannot have. Printed whenever a legacy
// run is in the set, including when it is zero — "it never failed to parse"
// is the interesting number, and it only means something if it was looked for.
const legacyRows = [...billRows, ...verifyRows, ...orderRows, ...summitRows, ...auditRows].filter(
  (r) => r.mode === "legacy",
);
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
