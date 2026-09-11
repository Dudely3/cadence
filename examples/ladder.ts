/**
 * The context ladder: the same goal, the same loop, the same page — climbed
 * four times, changing only how the context is constructed.
 *
 *   npm run ladder        the local 255-product catalogue (offline, deterministic)
 *   npm run ladder:web    prairiedevcon.com — a real page, 3x bigger
 *
 *   1. naive        chatbot-as-agent. Raw DOM, every turn frozen into history,
 *                   "cache everything" breakpoint at the end. Nothing falls off.
 *   2. tail         move the cache line back: state stops being frozen and
 *                   rides a volatile tail that is REPLACED each turn.
 *   3. cleaned      same, but strip the markup the model was never reading.
 *   4. explore      stop shipping the page at all — send a small preview and
 *                   let the model search it with find_in_page.
 *
 * Each rung writes its own trace, so you can open all four in the viewer and
 * scrub the same task under four different context strategies.
 *
 * Local page on purpose: offline, deterministic, rehearsable. It is the BIG
 * catalogue (23.8K tokens of raw DOM) because the effect is invisible on a
 * 15-product page — every strategy looks fine when nothing is big.
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
  type ExecutionMode,
  type Goal,
  type RunResult,
  type Session,
  type Tool,
} from "@cadence/core";
import { FileTracer } from "@cadence/tracer-file";
import { AnthropicModelClient } from "@cadence/model-anthropic";
import { speedMode, naiveMode } from "@cadence/modes";
import { BrowserEnv } from "@cadence/env-browser";
import { stepped, pressEnter, closeGate } from "./step";

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error(
    "Needs ANTHROPIC_API_KEY — the ladder makes real calls on every rung.",
  );
  process.exit(1);
}

interface Scenario {
  key: string;
  url: string;
  site: string;
  /** Multi-step on purpose: a one-turn task hides the whole effect. */
  goalText: string;
  /**
   * Did it actually get the right answer? `world` is the final observation,
   * `answer` is the summary the model passed to complete(). Shopping is
   * checked against the WORLD; a read-only page can only be checked against
   * the answer.
   */
  verify: (world: string, answer: string) => boolean;
}

const SCENARIOS: Record<string, Scenario> = {
  // Local, offline, deterministic: 255 products generated in-page (23.8K tokens
  // of raw DOM). The rehearsable one.
  shop: {
    key: "shop",
    url: pathToFileURL(path.resolve("examples/site/bigshop.html")).href,
    site: "the Trailhead Supply store page",
    goalText:
      "Add the cheapest Camping item to the cart, then add the most expensive Water item. " +
      "Then report both item names and the cart total.",
    verify: (world) =>
      ["Titanium Tent Stakes", "Packraft"].every((n) => world.includes(n)) &&
      world.includes("360.50"),
  },
  // A real site, three times bigger (76K tokens of raw DOM), and read-only —
  // so the check is on the ANSWER, not on the world.
  pdc: {
    key: "pdc",
    url: "https://www.prairiedevcon.com/",
    site: "the Prairie Dev Con conference page",
    goalText:
      "Find the session about execution modes for agentic workflows. Report its exact " +
      "title and the speaker's name, then report which two days the conference runs.",
    verify: (_world, answer) =>
      /speed\s*vs/i.test(answer) &&
      /rennick/i.test(answer) &&
      /21/.test(answer),
  },
};

// Flags, not env vars: `SCENARIO=pdc npm run ladder` is bash-only, and on
// PowerShell it fails outright. npm run ladder:web passes this for you.
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
};

const wanted = flag("scenario") ?? "shop";
const scenario = SCENARIOS[wanted] ?? SCENARIOS["shop"]!;
if (!SCENARIOS[wanted])
  console.warn(`unknown scenario "${wanted}" — using shop`);
const startUrl = scenario.url;
const GOAL_TEXT = scenario.goalText;

interface Rung {
  key: string;
  label: string;
  note: string;
  representation: "raw" | "cleaned";
  /** Characters of page content in the state block. */
  pageTextLimit: number;
  /** Interactive elements listed in the state block. */
  maxElements: number;
  /**
   * Tool names this rung is allowed to use. Every rung gets the same browser
   * surface except for the two tools that can SEARCH the page — find_in_page
   * and wait_for_text. Those are rung 4's whole point, and wait_for_text
   * counts as one: "wait until this text appears" answers "is this text on the
   * page", which is the question rungs 1-3 are supposed to have no way to ask.
   */
  toolNames: string[];
  mode: () => ExecutionMode;
}

const RUNGS: Rung[] = [
  {
    key: "1-naive",
    label: "1. naive",
    note: "raw DOM, frozen into history, cache-everything",
    representation: "raw",
    pageTextLimit: 200_000,
    maxElements: 400,
    toolNames: [
      "navigate",
      "click",
      "type_text",
      "press_key",
      "hover",
      "select_option",
      "read_element",
      "scroll",
      "go_back",
      "go_forward",
      "reload",
    ],
    mode: () => naiveMode({ maxSteps: 8 }),
  },
  {
    key: "2-tail",
    label: "2. + volatile tail",
    note: "state replaced each turn, past the cache line",
    representation: "raw",
    pageTextLimit: 200_000,
    maxElements: 400,
    toolNames: [
      "navigate",
      "click",
      "type_text",
      "press_key",
      "hover",
      "select_option",
      "read_element",
      "scroll",
      "go_back",
      "go_forward",
      "reload",
    ],
    mode: () => speedMode({ maxSteps: 8 }),
  },
  {
    key: "3-cleaned",
    label: "3. + cleaned page",
    note: "markup dropped, headings kept",
    representation: "cleaned",
    pageTextLimit: 200_000,
    maxElements: 400,
    toolNames: [
      "navigate",
      "click",
      "type_text",
      "press_key",
      "hover",
      "select_option",
      "read_element",
      "scroll",
      "go_back",
      "go_forward",
      "reload",
    ],
    mode: () => speedMode({ maxSteps: 8 }),
  },
  {
    key: "4-explore",
    label: "4. + let it explore",
    note: "small preview, find_in_page for the rest",
    // Ship almost nothing: a short preview and the first few elements. Anything
    // else, the model asks for. find_in_page returns matching ELEMENTS too, so
    // a button outside the listed window is still reachable by searching.
    representation: "cleaned",
    pageTextLimit: 2_500,
    maxElements: 30,
    toolNames: [
      "navigate",
      "click",
      "type_text",
      "press_key",
      "hover",
      "select_option",
      "read_element",
      "scroll",
      "go_back",
      "go_forward",
      "reload",
      "find_in_page",
      "wait_for_text",
    ],
    mode: () => speedMode({ maxSteps: 8 }),
  },
];

/**
 * `--rung 3` runs one rung on its own. The whole ladder is the measurement;
 * a single rung is what you want on stage, where the slide already carries the
 * table and you only need to show one strategy running live. Matches on the
 * number, the key, or the name: `--rung 3`, `--rung 3-cleaned`, `--rung cleaned`.
 */
const has = (name: string): boolean => process.argv.includes(`--${name}`);
// Off by default: the ladder is a measurement, and a headed, stepped browser
// makes it a demo. Both are what you want when running ONE rung on stage.
const headed = has("headed");
const step = has("step");
// Only set when asked for. The rungs are a measurement, and the viewport can
// change which elements count as visible — so the default stays the default
// unless a slide (or you) deliberately sizes the window for a screen.
const viewportRaw = flag("viewport");
const vp = /^(\d{3,4})x(\d{3,4})$/.exec(viewportRaw ?? "");
const viewport = vp
  ? { width: Number(vp[1]), height: Number(vp[2]) }
  : undefined;

const rungArg = flag("rung");
const chosen = rungArg
  ? RUNGS.filter(
      (r) =>
        r.key === rungArg ||
        r.key.split("-")[0] === rungArg ||
        r.key.split("-")[1] === rungArg,
    )
  : RUNGS;
if (chosen.length === 0) {
  console.error(
    `unknown rung "${rungArg}" — expected one of ${RUNGS.map((r) => r.key).join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `ladder · scenario ${scenario.key} · ${chosen.length === RUNGS.length ? "all 4 rungs" : `rung ${chosen[0]!.key} only`}`,
);

interface Row {
  rung: Rung;
  result: RunResult;
  session: Session;
  peakPromptTokens: number;
  /** in + cache read + cache write, summed — the honest "how big was this run". */
  totalPromptTokens: number;
  /** Did it get the right answer? The outcome alone doesn't say. */
  correct: boolean;
  tracePath: string | undefined;
}

/** Total prompt size for one turn: fresh + cache read + cache write. */
function promptTokensOf(session: Session): number[] {
  return session.turns.map((t) => {
    const u = t.usage;
    if (!u) return 0;
    return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  });
}

const rows: Row[] = [];

for (const rung of chosen) {
  console.log(`\n──────── ${rung.label} — ${rung.note} ────────`);

  const env = new BrowserEnv({
    startUrl,
    headless: !headed,
    ...(viewport ? { viewport } : {}),
    representation: rung.representation,
    pageTextLimit: rung.pageTextLimit,
    maxElements: rung.maxElements,
    // The env owns its toolset so systemHint() and the state block can say
    // what is true for THIS rung. Filtering availableTools() afterwards left
    // rungs 1-3 being told to "use find_in_page" when they had no such tool.
    tools: rung.toolNames,
  });
  const goal: Goal = {
    id: `ladder-${scenario.key}-${rung.key}`,
    description: `You are on ${scenario.site}. ${GOAL_TEXT}`,
    successCriteria: GOAL_TEXT,
  };

  const allowed: Tool[] = env.availableTools();
  const tracer = new FileTracer();

  try {
    const result = await run({
      goal,
      env,
      tools: new ToolRegistry([...allowed, completionTool(goal)]),
      model: resilient(new AnthropicModelClient()),
      mode: step ? stepped(rung.mode()) : rung.mode(),
      tracer,
      onEvent: (e) => {
        if (e.type === "action")
          console.log(`  → ${e.tool}(${JSON.stringify(e.args)})`);
        if (e.type === "observation" && !e.ok)
          console.log(`  ✗ ${e.summary.split("\n")[0]}`);
      },
    });
    // Check the WORLD, not the model's summary: a run can report success and
    // leave the cart wrong, and that difference is half the point of the ladder.
    const final = await env.observe();
    const session = tracer.session!;
    // The answer the model handed to complete() — for a read-only page this is
    // the only thing that can be judged.
    const answer = session.turns
      .flatMap((t) => t.actions)
      .filter((a) => a.tool === "complete")
      .map((a) => String((a.args as { summary?: unknown }).summary ?? ""))
      .join(" ");
    const correct = scenario.verify(final.summary, answer);
    const prompts = promptTokensOf(session);
    rows.push({
      rung,
      result,
      session,
      peakPromptTokens: Math.max(0, ...prompts),
      totalPromptTokens: prompts.reduce((a, b) => a + b, 0),
      correct,
      tracePath: tracer.finalPath,
    });
    console.log(
      `  ${result.outcome} · ${result.steps} turns · peak prompt ${Math.max(0, ...prompts)} tok · ` +
        `answer ${correct ? "correct" : "WRONG"}`,
    );
  } finally {
    // Same ordering browse.ts uses: hold the finished page on screen BEFORE
    // tearing the browser down, so the last state is still visible to talk to.
    if (headed && step)
      await pressEnter("\nbrowser still open — Enter to close it ");
    await env.dispose();
  }
}
if (step) closeGate();

// --- the table ------------------------------------------------------------
const pad = (s: string, n: number): string => s.padEnd(n);
const num = (n: number, w: number): string => n.toLocaleString().padStart(w);

console.log("\n\n════════ the context ladder ════════\n");
console.log(
  `${pad("rung", 22)}|${pad(" turns", 7)}|${pad("  peak prompt", 14)}|` +
    `${pad(" total prompt", 14)}|${pad("    cost", 10)}|${pad("  wall", 8)}|${pad(" right?", 8)}| outcome`,
);
console.log("-".repeat(112));
for (const r of rows) {
  const t = r.result.totals;
  console.log(
    `${pad(r.rung.label, 22)}|${num(r.result.steps, 6)} |` +
      `${num(r.peakPromptTokens, 13)} |${num(r.totalPromptTokens, 13)} |` +
      `${("$" + costOfSession(r.session).toFixed(4)).padStart(9)} |` +
      `${(Math.round(t.wallMs / 100) / 10 + "s").padStart(7)} |` +
      `${(r.correct ? "  ✓" : "  ✗").padStart(6)} | ${r.result.outcome}`,
  );
}

const first = rows[0];
const last = rows[rows.length - 1];
// A single rung has nothing to compare against — printing "rung 1 → rung 1,
// 0% smaller" would read as a result rather than an absence of one.
if (first && last && rows.length > 1) {
  const drop = (a: number, b: number): string =>
    a > 0 ? `${Math.round((1 - b / a) * 100)}%` : "—";
  console.log("\n──────── rung 1 → rung 4 ────────");
  console.log(
    `  peak prompt: ${first.peakPromptTokens.toLocaleString()} → ${last.peakPromptTokens.toLocaleString()} tok (${drop(first.peakPromptTokens, last.peakPromptTokens)} smaller)`,
  );
  console.log(
    `  total prompt: ${first.totalPromptTokens.toLocaleString()} → ${last.totalPromptTokens.toLocaleString()} tok (${drop(first.totalPromptTokens, last.totalPromptTokens)} smaller)`,
  );
  console.log(
    `  cost:        $${costOfSession(first.session).toFixed(4)} → $${costOfSession(last.session).toFixed(4)} (${drop(costOfSession(first.session), costOfSession(last.session))} cheaper)`,
  );
  console.log(
    `  wall:        ${(first.result.totals.wallMs / 1000).toFixed(1)}s → ${(last.result.totals.wallMs / 1000).toFixed(1)}s`,
  );
}

console.log("\ntraces (open them in npm run viz → ☰ sessions):");
for (const r of rows)
  console.log(`  ${r.rung.label.padEnd(22)} ${r.tracePath ?? "—"}`);
