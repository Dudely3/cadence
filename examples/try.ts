/**
 * Write a goal and watch the agent attempt it — no file editing, no flags.
 *
 *   npm run try
 *
 * Asks for a goal, then runs it against the shop page stepped and headed,
 * exactly like `npm run demo`. This is the "the loop is domain-agnostic" beat
 * made interactive: same loop, same tools, different words.
 *
 * A run started this way records a trace like any other, so it shows up in
 * `npm run traces`, the viewer's Sessions view, and can be replayed or pinned.
 */
import { ask } from "./ask";

const EXAMPLES = [
  "Add the two cheapest Camping items to the cart.",
  "Add the most expensive item on the page to the cart.",
  "Find the cheapest item overall and add it, then tell me what category it is in.",
];

console.log("\nWrite a goal for the agent. It starts on the Trailhead Supply shop page.");
console.log("Ideas:");
for (const e of EXAMPLES) console.log(`  · ${e}`);

const goal = (await ask("\nGoal (Enter to cancel): ")).trim();
if (!goal) {
  console.log("Cancelled — nothing run.");
  process.exit(0);
}

const modeAnswer = (await ask('Mode — "s" for speed (Haiku, fast) or "a" for accuracy [s]: '))
  .trim()
  .toLowerCase();
const mode = modeAnswer.startsWith("a") ? "accuracy" : "speed";

console.log(`\nRunning in ${mode} mode. Enter advances each turn; "go" runs to the end.\n`);

// Run the SAME script the demo uses, in THIS process: set the argv it parses,
// then import it. Spawning a child looked tidier but breaks on Windows — a
// .cmd shim needs shell:true, and shell:true re-joins the argv without quoting,
// so a goal with spaces arrives truncated at the first word. Staying in-process
// also means the presenter gate keeps the real terminal, so stepping behaves
// exactly as it does in `npm run demo`.
process.argv = [
  process.argv[0] ?? "node",
  "examples/browse.ts",
  "--step",
  "--headed",
  "--viewport",
  "940x820",
  "--mode",
  mode,
  "--goal",
  goal,
  "--goal-id",
  "custom",
];
await import("./browse");
