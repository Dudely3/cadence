/**
 * Free check: the pre-native-tool-use protocol actually works.
 *
 * legacyMode describes its tools in prose, sends no `tools` parameter, and
 * recovers calls by parsing one JSON blob of text. That is a real protocol with
 * real failure modes, so it gets a real check rather than a slide claiming it
 * would work if anyone ran it.
 *
 * Scripted, offline, no API key, no cost. The model client returns text-only
 * turns — which is exactly what the API returns when no tools are declared —
 * so the parse path here is the same one a live run takes.
 */
import "./env";
import {
  ToolRegistry,
  buildMessages,
  completionTool,
  parseLegacyReply,
  renderToolCatalogue,
  run,
  InMemoryTracer,
} from "@cadence/core";
import type { Goal, Session } from "@cadence/core";
import { legacyMode, SCRATCH_PARSE_FAILURES, SCRATCH_REPAIRS } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";
import { ScriptedModelClient, say } from "@cadence/testkit";

const GOAL: Goal = {
  id: "legacy-protocol",
  description: "Write two lines into the notepad, then finish.",
  successCriteria: "The notepad holds both lines.",
};

const registryFor = (env: NotepadEnv): ToolRegistry =>
  new ToolRegistry([...env.availableTools(), completionTool(GOAL)]);

const blob = (reasoning: string, ...actions: string[]): string =>
  JSON.stringify({
    current_state: { page_summary: "notepad", evaluation: "ok", next_goal: reasoning },
    reasoning,
    action: actions,
  });

const problems: string[] = [];
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) problems.push(label);
};

// --- 1. a clean run, start to finish -------------------------------------
const env = new NotepadEnv();
const tracer = new InMemoryTracer();
const ctxScratch: Record<string, unknown> = {};
const result = await run({
  goal: GOAL,
  env,
  tools: registryFor(env),
  model: new ScriptedModelClient([
    // TWO calls in one turn: `action` is a list, and a harness that only ever
    // read action[0] would silently drop the second and still look like it
    // worked. Native tool use gets this right for free; here it is a decision.
    say(blob("write both lines", 'append_line("alpha")', 'append_line("beta")')),
    say(blob("done", 'complete("success", "wrote both lines")')),
  ]),
  mode: legacyMode({ maxSteps: 6 }),
  tracer,
  scratch: ctxScratch,
});
const session = tracer.session as Session;

check(result.outcome === "completed", `run completes (got ${result.outcome})`);
const notepad = (await env.observe()).summary;
check(notepad.includes("alpha") && notepad.includes("beta"), "both lines reached the environment");
check(
  session.contextShape?.toolProtocol === "json-in-text",
  "the shape is recorded on the session, not hidden in the mode",
);

// --- 2. positional arguments bound to the right names --------------------
const firstCall = session.turns[0]?.actions[0];
check(firstCall?.tool === "append_line", `first action is append_line (got ${firstCall?.tool})`);
check(
  (session.turns[0]?.actions.length ?? 0) === 2,
  `both calls in one action array were dispatched (got ${session.turns[0]?.actions.length ?? 0})`,
);
check(
  JSON.stringify(firstCall?.args ?? {}).includes("alpha"),
  "the positional argument bound to a named property",
);
const completeCall = session.turns.flatMap((t) => t.actions).find((a) => a.tool === "complete");
check(
  (completeCall?.args as { status?: string } | undefined)?.status === "success",
  "two positional args bound in order (status, summary)",
);

// --- 3. what goes on the wire --------------------------------------------
const blocks = session.turns[0]?.assistantBlocks ?? [];
check(
  blocks.length === 1 && blocks[0]?.type === "text",
  "the assistant turn is ONE text block — no tool_use on the wire",
);
const messages = buildMessages({ ...session, turns: session.turns.slice(0, 1) });
const resultBlocks = messages.at(-1)?.content ?? [];
check(
  resultBlocks.every((b) => b.type === "text"),
  "history carries results as text, not tool_result blocks",
);
// Spelled out deliberately: the neutral block calls the field `toolUseId`, so
// searching for "tool_use" alone passes even when paired blocks ARE being sent.
const wire = JSON.stringify(messages);
check(
  !wire.includes("tool_use") && !wire.includes("tool_result") && !wire.includes("toolUseId"),
  "no pairing of any kind in the rendered request",
);

// --- 4. the failure this protocol has and native tool use cannot ---------
const tools = registryFor(new NotepadEnv()).toModelSchema();
check(parseLegacyReply("I will append a line now.", tools).error !== undefined, "prose-only reply is a parse error");
check(parseLegacyReply('{"action": [', tools).error !== undefined, "truncated JSON is a parse error");
check(parseLegacyReply(blob("x", "append_line(\"y\")"), tools).calls.length === 1, "a good blob parses");
check(
  parseLegacyReply('```json\n' + blob("x", 'append_line("y")') + '\n```', tools).calls.length === 1,
  "a fenced blob parses too (tolerance, so the comparison is fair)",
);
check(
  parseLegacyReply(blob("x", 'append_line(unquoted)'), tools).calls[0]?.input["line"] === "unquoted",
  "an unquoted string argument is taken literally rather than losing the turn",
);

// --- 5. a malformed reply is repaired, and the wasted call is billed ------
const env2 = new NotepadEnv();
const tracer2 = new InMemoryTracer();
const scratch2: Record<string, unknown> = {};
await run({
  goal: GOAL,
  env: env2,
  tools: registryFor(env2),
  model: new ScriptedModelClient([
    say("Sure! I'll append that line for you."),
    say(blob("retrying properly", 'append_line("alpha")')),
    say(blob("done", 'complete("success", "recovered")')),
  ]),
  mode: legacyMode({ maxSteps: 6 }),
  tracer: tracer2,
  scratch: scratch2,
});
check(Number(scratch2[SCRATCH_PARSE_FAILURES] ?? 0) >= 1, "a parse failure is counted");
check(Number(scratch2[SCRATCH_REPAIRS] ?? 0) >= 1, "the repair round-trip recovered the turn");
check((await env2.observe()).summary.includes("alpha"), "the repaired call still reached the environment");

// --- 6. the catalogue is real -------------------------------------------
const catalogue = renderToolCatalogue(tools);
check(catalogue.includes("append_line(line)"), "the catalogue names each tool and its parameters");
check(!catalogue.includes("inputSchema"), "the catalogue is prose, not a JSON schema dump");

console.log(`\ncatalogue: ${catalogue.length} chars of prose in the system prompt`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\n✓ the json-in-text protocol runs, binds, renders and fails as designed");
