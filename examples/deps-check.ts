/**
 * Deterministic dependency-tracking check: scripted model, no API key, free.
 * Proves update_plan blocks out-of-order completion and the critic tail works.
 *
 *   npm run deps
 */
import { run, InMemoryTracer, ToolRegistry, completionTool, type Goal } from "@cadence/core";
import { accuracyMode } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";
import { ScriptedModelClient, call, step } from "@cadence/testkit";

const GOAL: Goal = { id: "dep-test", description: "Write two lines in order." };

// The scripted client answers EVERY model call in sequence — planner and
// critic included (they ignore toolChoice; the canned call is returned).
const SCRIPT = [
  // prepare(): planner call
  step("planning", call("create_plan", { steps: [
    { id: "s1", title: "Write line one" },
    { id: "s2", title: "Write line two", dependsOn: ["s1"] },
  ]})),
  // turn 0 decide: try to complete s2 FIRST — must be blocked
  step("skipping ahead", call("update_plan", { stepId: "s2", status: "done" })),
  // turn 1 critic reviews turn 0
  step("critic", call("verdict", { ok: false, feedback: "s2 attempted before s1" })),
  // turn 1 decide: do it properly
  step("fixing order", call("append_line", { line: "one" }), call("update_plan", { stepId: "s1", status: "done" })),
  // turn 2 critic
  step("critic", call("verdict", { ok: true })),
  // turn 2 decide: now s2 is legal
  step("second line", call("append_line", { line: "two" }), call("update_plan", { stepId: "s2", status: "done" })),
  // turn 3 critic
  step("critic", call("verdict", { ok: true })),
  // turn 3 decide: complete
  step("done", call("complete", { status: "success", summary: "both lines written in order" })),
];

const env = new NotepadEnv();
const tools = new ToolRegistry([...env.availableTools(), completionTool(GOAL)]);
const tracer = new InMemoryTracer();

const result = await run({
  goal: GOAL, env, tools,
  model: new ScriptedModelClient(SCRIPT),
  mode: accuracyMode({ maxSteps: 10 }),
  tracer,
});

const session = tracer.session!;
const t0Results = session.turns[0]!.toolResults;
const blocked = t0Results.some(
  (b) => b.type === "tool_result" && b.isError && b.content.includes("s1"),
);
const t2ok = session.turns[2]!.toolResults.every((b) => b.type !== "tool_result" || !b.isError);
const criticRecorded = session.turns[1]!.critic?.ok === false;
const tailHasCritic = (session.turns[1]!.tail ?? "").includes("[critic]");

console.log("blocked out-of-order done:", blocked ? "PASS" : "FAIL");
console.log("in-order done accepted:   ", t2ok ? "PASS" : "FAIL");
console.log("critic verdict recorded:  ", criticRecorded ? "PASS" : "FAIL");
console.log("critic feedback in tail:  ", tailHasCritic ? "PASS" : "FAIL");
console.log("outcome:", result.outcome, result.completionStatus ?? "");
if (!blocked || !t2ok || !criticRecorded || !tailHasCritic || result.outcome !== "completed") process.exit(1);
