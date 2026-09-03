/**
 * Failure drill. Runs the same notepad task under a series of injected faults
 * and reports how each run ended.
 *
 * Costs nothing and needs no API key — every run is scripted. The output is the
 * artifact: which failures the harness absorbs, and how.
 *
 * The model is wrapped in resilient() here, same as examples/spike.ts. Remove
 * that wrapper and the transport faults go back to killing the run — which is
 * the point of having the drill.
 *
 *   npm run drill
 */
import {
  run,
  InMemoryTracer,
  ToolRegistry,
  completionTool,
  resilient,
  type Environment,
  type Goal,
  type ModelClient,
  type RunResult,
} from "@cadence/core";
import { speedMode } from "@cadence/modes";
import { NotepadEnv } from "@cadence/env-notepad";
import { ScriptedModelClient, chaos, chaosEnv, call, step } from "@cadence/testkit";

const GOAL: Goal = {
  id: "drill-haiku",
  description: "Write a three-line haiku about the ocean to the notepad, one line per call. Then call complete.",
};

/** The happy path, recorded from a real Haiku run. */
const SCRIPT = [
  step("I'll write the first line.", call("append_line", { line: "Waves crash on the shore" })),
  step("Now the second line.", call("append_line", { line: "Salt spray dancing in the wind" })),
  step("Now the third line.", call("append_line", { line: "Blue depths call to us" })),
  step(
    "Done — completing.",
    call("complete", { status: "success", summary: "Wrote a three-line ocean haiku." }),
  ),
];

const scripted = (): ModelClient => new ScriptedModelClient(SCRIPT);

/** Short timings so the drill stays fast; production defaults are in resilient(). */
const guard = (inner: ModelClient, onRetry: () => void): ModelClient =>
  resilient(inner, { timeoutMs: 500, baseDelayMs: 25, maxDelayMs: 100, onRetry });

interface Scenario {
  name: string;
  expectation: string;
  build(notepad: NotepadEnv, onRetry: () => void): { env: Environment; model: ModelClient };
}

const SCENARIOS: Scenario[] = [
  {
    name: "(baseline)",
    expectation: "completes cleanly",
    build: (n, r) => ({ env: n, model: guard(scripted(), r) }),
  },
  {
    name: "rateLimit @2",
    expectation: "429 mid-run, should be retried",
    build: (n, r) => ({ env: n, model: guard(chaos(scripted(), { at: 2, inject: "rateLimit" }), r) }),
  },
  {
    name: "overloaded @2",
    expectation: "529 mid-run, should be retried",
    build: (n, r) => ({ env: n, model: guard(chaos(scripted(), { at: 2, inject: "overloaded" }), r) }),
  },
  {
    name: "hang @2",
    expectation: "no response; timeout should fire, then retry",
    build: (n, r) => ({
      env: n,
      model: guard(chaos(scripted(), { at: 2, inject: "hang", hangMs: 30_000 }), r),
    }),
  },
  {
    name: "unknownTool @2",
    expectation: "invented tool; error goes back to the model",
    build: (n, r) => ({ env: n, model: guard(chaos(scripted(), { at: 2, inject: "unknownTool" }), r) }),
  },
  {
    name: "invalidArgs @2",
    expectation: "real tool, junk args; error goes back to the model",
    build: (n, r) => ({ env: n, model: guard(chaos(scripted(), { at: 2, inject: "invalidArgs" }), r) }),
  },
  {
    name: "bareText @2",
    expectation: "model gives up; must NOT report success",
    build: (n, r) => ({ env: n, model: guard(chaos(scripted(), { at: 2, inject: "bareText" }), r) }),
  },
  {
    name: "toolThrows @1",
    expectation: "tool throws as Playwright does; loop must survive",
    build: (n, r) => ({
      env: chaosEnv(n, { at: 1, inject: "throwOnExecute" }),
      model: guard(scripted(), r),
    }),
  },
  {
    name: "observeThrows @0",
    expectation: "environment dead before turn 0; clean failure, no crash",
    build: (n, r) => ({
      env: chaosEnv(n, { at: 0, inject: "throwOnObserve" }),
      model: guard(scripted(), r),
    }),
  },
];

type Outcome =
  | { kind: "settled"; result: RunResult }
  | { kind: "crashed"; error: string }
  | { kind: "hung" };

const DEADLINE_MS = 5_000;

async function runScenario(s: Scenario): Promise<{ outcome: Outcome; lines: number; retries: number }> {
  const notepad = new NotepadEnv();
  let retries = 0;
  const { env, model } = s.build(notepad, () => {
    retries += 1;
  });

  const attempt = run({
    goal: GOAL,
    env,
    tools: new ToolRegistry([...env.availableTools(), completionTool(GOAL)]),
    model,
    mode: speedMode(),
    tracer: new InMemoryTracer(),
  })
    .then((result): Outcome => ({ kind: "settled", result }))
    .catch((err: unknown): Outcome => ({
      kind: "crashed",
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }));

  const deadline = new Promise<Outcome>((resolve) => {
    setTimeout(() => {
      resolve({ kind: "hung" });
    }, DEADLINE_MS);
  });

  const outcome = await Promise.race([attempt, deadline]);
  const observed = await notepad.observe();
  const lines = (observed.raw as { lines: string[] }).lines.length;
  return { outcome, lines, retries };
}

interface Verdict {
  label: string;
  detail: string;
  /** Did the harness behave correctly, regardless of whether the goal was met? */
  harnessOk: boolean;
}

function judge(outcome: Outcome, lines: number, retries: number): Verdict {
  const suffix = retries > 0 ? ` retries=${retries}` : "";

  switch (outcome.kind) {
    case "settled": {
      const r = outcome.result;
      const stats = `steps=${r.steps} lines=${lines}${suffix}`;

      if (r.outcome === "completed") {
        // The agent signalled done. Whether it was RIGHT is a model question,
        // not a harness question — the loop reported exactly what happened.
        return lines >= 3
          ? { label: "completed", detail: stats, harnessOk: true }
          : { label: "completed (agent was wrong)", detail: stats, harnessOk: true };
      }
      if (r.outcome === "error") {
        return { label: "error (clean)", detail: `${stats} — ${r.error ?? ""}`, harnessOk: true };
      }
      // stopped / max_steps
      return { label: r.outcome, detail: stats, harnessOk: true };
    }
    case "crashed":
      return { label: "CRASHED", detail: outcome.error, harnessOk: false };
    case "hung":
      return { label: "HUNG", detail: `no result after ${DEADLINE_MS}ms`, harnessOk: false };
  }
}

async function main(): Promise<void> {
  console.log("Cadence failure drill — scripted, no API calls\n");

  let harnessFailures = 0;
  let goalsMet = 0;

  for (const s of SCENARIOS) {
    const { outcome, lines, retries } = await runScenario(s);
    const v = judge(outcome, lines, retries);
    if (!v.harnessOk) harnessFailures += 1;
    if (outcome.kind === "settled" && outcome.result.success && lines >= 3) goalsMet += 1;

    console.log(`  ${v.label.padEnd(26)} ${s.name.padEnd(17)} ${v.detail}`);
    console.log(`  ${"".padEnd(26)} ${"".padEnd(17)} (${s.expectation})\n`);
  }

  console.log("────────────────────────────────────────────");
  console.log(`harness held in ${SCENARIOS.length - harnessFailures}/${SCENARIOS.length} scenarios`);
  console.log(`goal actually achieved in ${goalsMet}/${SCENARIOS.length}`);
  console.log("\nNote: a scripted model cannot read an error and adapt — only a real");
  console.log("model can. Rows where the harness held but the goal was missed are");
  console.log("script limitations, not harness bugs.");

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
