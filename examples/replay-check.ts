/**
 * Deterministic replay checks: scripted model, no API key, free.
 *
 *   npm run replay
 *
 * Covers two bugs that both reported `outcome: completed` while broken, so
 * every assertion here inspects the TURNS, never just the outcome:
 *
 *  1. Replaying an accuracy recording failed every `update_plan` with
 *     "unknown tool" — accuracy registers that tool in its own prepare(),
 *     which replay never runs.
 *  2. Skipping those calls naively empties any turn made only of them, and a
 *     turn with zero tool calls is how the loop recognizes "the model
 *     stopped" — so the replay ended early and never reached `complete`.
 */
import { run, InMemoryTracer, ToolRegistry, completionTool, type Goal, type Session } from "@cadence/core";
import { accuracyMode, replayMode, speedMode } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";
import { ScriptedModelClient, call, step } from "@cadence/testkit";

const GOAL: Goal = { id: "replay-test", description: "Write two lines, tracking the plan." };

const SCRIPT = [
  // prepare(): the planner call
  step("planning", call("create_plan", { steps: [
    { id: "s1", title: "Write line one" },
    { id: "s2", title: "Write line two" },
  ]})),
  // turn 0: work AND bookkeeping in one turn — the PARTIAL-skip case
  step("first line", call("append_line", { line: "one" }), call("update_plan", { stepId: "s1", status: "done" })),
  step("critic", call("verdict", { ok: true })),
  // turn 1: bookkeeping ONLY — the WHOLE-TURN-skip case
  step("just tracking", call("update_plan", { stepId: "s2", status: "failed", note: "reconsidered" })),
  step("critic", call("verdict", { ok: true })),
  // turn 2: finish
  step("done", call("append_line", { line: "two" }), call("complete", { status: "success", summary: "both lines" })),
];

/** Fresh registry WITHOUT update_plan — exactly what a replay run starts with. */
const registryFor = (env: NotepadEnv): ToolRegistry =>
  new ToolRegistry([...env.availableTools(), completionTool(GOAL)]);

// --- 1. Record an accuracy run -------------------------------------------
const recEnv = new NotepadEnv();
const recTracer = new InMemoryTracer();
await run({
  goal: GOAL, env: recEnv, tools: registryFor(recEnv),
  model: new ScriptedModelClient(SCRIPT),
  mode: accuracyMode({ maxSteps: 8 }),
  tracer: recTracer,
});
const recorded = recTracer.session!;
const toolsOf = (s: Session) => s.turns.map((t) => t.actions.map((a) => a.tool));
const recTools = toolsOf(recorded);
const hasMixedTurn = recTools.some((t) => t.includes("update_plan") && t.some((x) => x !== "update_plan"));
const hasBookkeepingOnlyTurn = recTools.some((t) => t.length > 0 && t.every((x) => x === "update_plan"));

// --- 2. Replay it (default policy: skip) ---------------------------------
const repEnv = new NotepadEnv();
const repTracer = new InMemoryTracer();
const result = await run({
  goal: GOAL, env: repEnv, tools: registryFor(repEnv),
  model: new ScriptedModelClient([]), // must never be consulted
  mode: replayMode(recorded),
  tracer: repTracer,
});
const replayed = repTracer.session!;
const errors = replayed.turns.flatMap((t) =>
  (t.toolResults ?? []).filter((b) => b.type === "tool_result" && b.isError),
);
// Every tool_use block must have a matching tool_result, or the message pair
// is malformed for any later render or re-replay.
const balanced = replayed.turns.every(
  (t) => t.assistantBlocks.filter((b) => b.type === "tool_use").length === (t.toolResults ?? []).length,
);

// --- 3. Replay again with the "stub" policy ------------------------------
const stubEnv = new NotepadEnv();
const stubTracer = new InMemoryTracer();
const stubResult = await run({
  goal: GOAL, env: stubEnv, tools: registryFor(stubEnv),
  model: new ScriptedModelClient([]),
  mode: replayMode(recorded, { unknownTools: "stub" }),
  tracer: stubTracer,
});
const stubbed = stubTracer.session!;
const stubErrors = stubbed.turns.flatMap((t) =>
  (t.toolResults ?? []).filter((b) => b.type === "tool_result" && b.isError),
);

// --- 4. Re-pointed replay: same program, different values ----------------
// A recording that names what it was about can be replayed FOR SOMETHING ELSE:
// every occurrence of the recorded value is swapped in the arguments the replay
// passes. The completion summary is deliberately exempt — it is narration from
// a model that is not running, and rewriting it would manufacture a sentence
// nobody wrote.
const PARAM_GOAL: Goal = { id: "param-test", description: "Log the subject." };
const PARAM_SCRIPT = [
  step(
    "logging Ada",
    call("append_line", { line: "subject: Ada Lovelace" }),
    call("complete", { status: "success", summary: "logged Ada Lovelace" }),
  ),
];
const paramRecEnv = new NotepadEnv();
const paramRecTracer = new InMemoryTracer();
await run({
  goal: PARAM_GOAL,
  env: paramRecEnv,
  tools: new ToolRegistry([...paramRecEnv.availableTools(), completionTool(PARAM_GOAL)]),
  model: new ScriptedModelClient(PARAM_SCRIPT),
  mode: speedMode({ maxSteps: 4 }),
  tracer: paramRecTracer,
  params: { subject: "Ada Lovelace" },
});
const paramRecorded = paramRecTracer.session!;

const paramEnv = new NotepadEnv();
const paramTracer = new InMemoryTracer();
const paramResult = await run({
  goal: PARAM_GOAL,
  env: paramEnv,
  tools: new ToolRegistry([...paramEnv.availableTools(), completionTool(PARAM_GOAL)]),
  model: new ScriptedModelClient([]),
  mode: replayMode(paramRecorded, { params: { subject: "Grace Hopper" } }),
  tracer: paramTracer,
});
const paramWorld = (await paramEnv.observe()).summary;
const replayedArgs = paramTracer.session!.turns.flatMap((t) => t.actions);
const appended = replayedArgs.find((a) => a.tool === "append_line");
const completed = replayedArgs.find((a) => a.tool === "complete");

// Sanity: an unchanged replay must still produce the recorded value, or the
// two assertions above prove nothing about substitution.
const sameEnv = new NotepadEnv();
const sameTracer = new InMemoryTracer();
await run({
  goal: PARAM_GOAL,
  env: sameEnv,
  tools: new ToolRegistry([...sameEnv.availableTools(), completionTool(PARAM_GOAL)]),
  model: new ScriptedModelClient([]),
  mode: replayMode(paramRecorded),
  tracer: sameTracer,
});
const sameWorld = (await sameEnv.observe()).summary;

const checks: Array<[string, boolean, string?]> = [
  ["recording has a mixed turn", hasMixedTurn, "test would be vacuous"],
  ["recording has a bookkeeping-only turn", hasBookkeepingOnlyTurn, "test would be vacuous"],
  ["skip: no 'unknown tool' errors", !errors.some((b) => b.type === "tool_result" && b.content.includes("unknown tool"))],
  ["skip: zero tool errors at all", errors.length === 0, `${errors.length} errors`],
  ["skip: update_plan fully absent", !toolsOf(replayed).flat().includes("update_plan")],
  ["skip: real work preserved", toolsOf(replayed).flat().filter((t) => t === "append_line").length === 2],
  ["skip: reached complete (no early end)", toolsOf(replayed).flat().includes("complete")],
  ["skip: bookkeeping-only turn dropped", replayed.turns.length === recorded.turns.length - 1,
    `${replayed.turns.length} vs recorded ${recorded.turns.length}`],
  ["skip: tool_use/tool_result balanced", balanced],
  ["skip: outcome completed", result.outcome === "completed", result.outcome],
  ["skip: zero model calls", result.totals.llmCalls === 0],
  ["stub: keeps update_plan", toolsOf(stubbed).flat().includes("update_plan")],
  ["stub: zero tool errors", stubErrors.length === 0, `${stubErrors.length} errors`],
  ["stub: outcome completed", stubResult.outcome === "completed", stubResult.outcome],
  ["params: recording carries its params", paramRecorded.params?.["subject"] === "Ada Lovelace"],
  ["params: unchanged replay reproduces the recorded value", sameWorld.includes("Ada Lovelace")],
  ["params: re-pointed arg was substituted",
    String(appended?.args["line"] ?? "") === "subject: Grace Hopper", String(appended?.args["line"])],
  ["params: the WORLD holds the new value", paramWorld.includes("Grace Hopper")],
  ["params: the world does NOT hold the recorded value", !paramWorld.includes("Ada Lovelace")],
  ["params: completion summary left as recorded",
    String(completed?.args["summary"] ?? "").includes("Ada Lovelace"), String(completed?.args["summary"])],
  ["params: zero model calls", paramResult.totals.llmCalls === 0],
];

let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
if (failed) {
  for (const e of errors) if (e.type === "tool_result") console.error("  error:", e.content.slice(0, 200));
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall replay checks passed");
