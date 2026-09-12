/**
 * Free check: does the token chart agree with the invoice?
 *
 * The viewer draws a block per piece of the request and labels each with a
 * token count. Those labels used to be `chars / 4` over the readable payload,
 * which left out the per-block protocol envelope entirely — on a real accuracy
 * turn the stack summed to 131 tokens against a cache write the API reported as
 * 585. Two accounts of the same request, 4.5x apart, on the one pane whose
 * whole subject is what things cost.
 *
 * requestAnatomy now scales each region to the usage the API recorded, so the
 * sums are right by construction. That makes the interesting failure a silent
 * one: the estimator could go badly wrong and reconciliation would paper over
 * it, leaving the SHAPE of the chart a lie even while the totals are true.
 *
 * So this checks both halves:
 *   1. every region sums EXACTLY to what the API charged, and
 *   2. the raw estimate is within tolerance of it beforehand — which is the
 *      part that catches a whole cost going unmodelled again.
 *
 * Scripted, offline, no API key, no cost: it reads recordings already on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "@cadence/core";
import { requestAnatomy, type Region } from "../packages/viz/src/anatomy";

const TRACES = fileURLToPath(new URL("../traces", import.meta.url));

/**
 * How far the local estimator may sit from the invoice before this fails.
 * Wide on purpose: the estimator only has to rank blocks sensibly, and a tight
 * bound would turn every model-side tokenizer change into a red build. The
 * `chars / 4` version this replaced scored 0.22 on real accuracy turns, so the
 * band is nowhere near it.
 */
const MIN_RATIO = 0.35;

/** Matches FRAMING_ONLY in anatomy.ts: per-request scaffolding owned by no block. */
const FRAMING_ONLY = 32;
const MAX_RATIO = 2.1;

/**
 * Why the low end is as low as 0.35.
 *
 * One turn per run is charged a cache write well above the content it covers,
 * and it is not estimator error — it is the tool-use preamble being frozen for
 * the first time. Declaring tools makes the API inject a fixed ~317-token block
 * of instructions after the system prompt, outside the reach of a cache line on
 * the system block; it is billed as fresh input every request until a
 * breakpoint further down the prompt finally covers it. Measured on
 * claude-haiku-4-5: 7 tokens fresh with no tools, exactly 324 with 1, 4 or 12.
 *
 * The viewer draws that as its own block, so the region still sums to the
 * invoice. What the ratio check sees is the local estimate of the CONTENT
 * sitting about half the recorded write on those turns, which is correct.
 *
 * The band stays tight enough to catch the failure that prompted this check:
 * chars/4 over the payload alone scored 0.22.
 */

const problems: string[] = [];
let turnsChecked = 0;
let worst = { ratio: 1, where: "", region: "" as Region | "" };

const files = fs
  .readdirSync(TRACES)
  // example-*.json are AUTHORED comparison traces (the RAG chatbot, the legacy
  // Solo shape). Their usage numbers were written to illustrate an architecture,
  // not measured from a request, so holding an estimator to them is meaningless.
  .filter((f) => f.endsWith(".json") && f !== "live.json" && f !== "pins.json" && !f.startsWith("example-"))
  .sort();

for (const file of files) {
  let session: Session;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(TRACES, file), "utf8")) as
      | { session?: Session }
      | Session;
    session = "session" in raw && raw.session ? raw.session : (raw as Session);
  } catch {
    problems.push(`${file}: not readable as a session`);
    continue;
  }
  if (!Array.isArray(session.turns)) continue;

  session.turns.forEach((turn, i) => {
    if (!turn.closed || !turn.usage) return;
    const a = requestAnatomy(session, i);
    turnsChecked += 1;

    // 1. the sums must BE the invoice, not approximately it
    const sums: Array<[Region | "response", number, number | undefined]> = [
      ["cached", sum(a.blocks.filter((b) => b.region === "cached")), turn.usage.cacheReadTokens],
      ["cache-write", sum(a.blocks.filter((b) => b.region === "cache-write")), turn.usage.cacheWriteTokens],
      ["fresh", sum(a.blocks.filter((b) => b.region === "fresh")), turn.usage.inputTokens],
      // Assistant blocks only: tool results share this pane but not this bill.
      ["response", sum(a.response.filter((b) => b.role === "assistant")), turn.usage.outputTokens],
    ];
    for (const [region, drawn, recorded] of sums) {
      if (recorded === undefined || recorded <= 0) continue;
      // A region can legitimately hold no blocks: when a run freezes its entire
      // prompt, the few tokens still billed as fresh are per-request framing,
      // not content. Nothing to draw, nothing to reconcile.
      if (drawn === 0 && recorded <= FRAMING_ONLY) continue;
      if (drawn !== recorded) {
        problems.push(
          `${file} turn ${i}: ${region} draws ${drawn} tokens, API charged ${recorded}`,
        );
      }
    }

    // 2. the estimate behind the scaling must be in the right postal code
    for (const r of a.audit) {
      const ratio = r.estimate / r.recorded;
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worst.ratio))) {
        worst = { ratio, where: `${file} turn ${i}`, region: r.region };
      }
      if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
        problems.push(
          `${file} turn ${i}: ${r.region} estimate ${r.estimate} vs charged ${r.recorded} ` +
            `(${ratio.toFixed(2)}x over ${r.blocks} block(s)) — outside ${MIN_RATIO}-${MAX_RATIO}x`,
        );
      }
    }
  });
}

function sum(blocks: Array<{ tokens: number }>): number {
  return blocks.reduce((a, b) => a + b.tokens, 0);
}

console.log(`token chart vs recorded usage — ${files.length} trace(s), ${turnsChecked} closed turn(s)`);
if (worst.where) {
  console.log(
    `  worst estimator fit: ${worst.ratio.toFixed(2)}x  (${worst.region}, ${worst.where})`,
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`);
  process.exit(1);
}
console.log("\n✓ every drawn region sums to the usage the API reported");
