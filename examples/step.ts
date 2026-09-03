/**
 * Presenter gate — wrap any ExecutionMode so the run pauses before every turn
 * and waits for Enter. Wraps decide(), so it steps speed, accuracy, AND replay
 * (replay's decide is a trace read — no model, still gated).
 *
 * At the pause the previous turn is already flushed to traces/live.json, so
 * the viz is showing exactly the state you're talking about; Enter runs the
 * next turn and the viz picks it up on its next poll (<1s).
 *
 *   Enter  → run one turn
 *   go⏎    → release the gate, finish the run unattended
 *
 * Lives in examples/ on purpose: stdin prompting is presenter UI, and the
 * loop and modes stay UI-free.
 */
import readline from "node:readline";
import type { DecideInput, ExecutionMode, ModelResult } from "@cadence/core";

export function stepped(inner: ExecutionMode): ExecutionMode {
  let released = false;
  return {
    // Keep the inner mode's identity: the trace records mode.name, and a
    // stepped recording must replay exactly like an unattended one.
    name: inner.name,
    maxSteps: inner.maxSteps,
    ...(inner.prepare ? { prepare: inner.prepare.bind(inner) } : {}),
    system: inner.system.bind(inner),
    async decide(input: DecideInput): Promise<ModelResult> {
      if (!released) {
        const answer = await promptLine(
          `\n⏸  turn ${input.ctx.step} ready — Enter to run it, "go" to finish unattended `,
        );
        if (answer.trim().toLowerCase() === "go") {
          released = true;
          console.log("▶  gate released — running to completion");
        }
      }
      return inner.decide(input);
    },
  };
}

/**
 * Wait for Enter outside the loop — for holding a headed browser window open
 * on the final state instead of tearing it down the instant the run ends.
 * Returns immediately once stdin is exhausted, so piped/CI runs never hang.
 */
export async function pressEnter(question: string): Promise<void> {
  await promptLine(question);
}

/**
 * Release stdin so the process can exit. An open readline interface keeps the
 * event loop alive on a TTY, so every example that gates must call this — put
 * it in the same finally that disposes the environment.
 */
export function closeGate(): void {
  const iface = rl;
  rl = null;
  stdinEnded = true;
  iface?.close();
}

// One persistent readline interface for the whole run: a fresh interface per
// prompt would drop input readline has already buffered (piped stdin sends
// everything at once). It is left FLOWING between prompts and only closed by
// closeGate() at teardown.
//
// Two things here are load-bearing, both learned the hard way:
//   - Don't pause() between questions. On a PIPED stdin (the viewer drives runs
//     through a pipe) a paused interface doesn't reliably resume for the next
//     question, and the final "Enter to close" prompt hangs forever.
//   - Don't close() early, e.g. on "go" — that ends stdin and makes every later
//     prompt return instantly.
// Tests that pipe a fixed string hide the first bug, because the EOF that
// follows resolves the prompt as a cancel and looks like success.
let rl: readline.Interface | null = null;
let stdinEnded = false;

function promptLine(question: string): Promise<string> {
  // stdin exhausted: unattended run. "go" is the answer that never blocks.
  if (stdinEnded) return Promise.resolve("go");
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.once("close", () => {
      stdinEnded = true;
      rl = null;
    });
  }
  const iface = rl;
  return new Promise((resolve) => {
    const onClose = (): void => resolve("go");
    iface.once("close", onClose);
    iface.question(question, (answer) => {
      iface.removeListener("close", onClose);
      resolve(answer);
    });
  });
}
