/**
 * Overview of the recordings on disk: what each run was, what it did, and what
 * it cost — so you can tell them apart without opening files.
 *
 *   npm run traces
 *
 * The visualizer shows the same overview with a click-to-open list
 * (`npm run viz` → Sessions).
 */
import fs from "node:fs";
import path from "node:path";
import { relativeTime } from "@cadence/core";
import { listTraces, PINNED_FILE, type TraceInfo } from "./flags";

const traces = listTraces();
if (traces.length === 0) {
  console.log("No recordings in traces/ yet — a finished run writes one.");
  process.exit(0);
}

console.log(`\n${traces.length} recording(s), newest first:\n`);
for (const t of traces) console.log(renderTrace(t, marksFor(traces)));
console.log(`Pin the one to fall back to on stage:  npm run pin`);
console.log(`Replay a specific one:  npx tsx examples/browse.ts --step --headed --replay <id>\n`);

/** Which id is pinned, and which trace is `latest` for each goal. */
function marksFor(all: TraceInfo[]): (t: TraceInfo) => string[] {
  const pinnedPath = path.resolve("traces", PINNED_FILE);
  let pinnedId: string | undefined;
  try {
    if (fs.existsSync(pinnedPath)) {
      pinnedId = (JSON.parse(fs.readFileSync(pinnedPath, "utf8")) as { session?: { id?: string } })
        .session?.id;
    }
  } catch {
    /* unreadable pin — just don't mark anything */
  }
  const latestByGoal = new Map<string, string>();
  for (const t of all) {
    if (t.outcome === "completed" && !latestByGoal.has(t.goalId)) latestByGoal.set(t.goalId, t.id);
  }
  return (t) =>
    [
      t.id === pinnedId ? "PINNED" : "",
      latestByGoal.get(t.goalId) === t.id ? "latest" : "",
    ].filter(Boolean);
}

export function renderTrace(t: TraceInfo, marks: (t: TraceInfo) => string[]): string {
  const status =
    t.outcome === "completed" ? (t.success ? "OK" : "completed*") : t.outcome.toUpperCase();
  const tag = marks(t);
  const cost = t.costUsd > 0 ? `$${t.costUsd.toFixed(4)}` : "free";
  const secs = t.wallMs > 0 ? `${(t.wallMs / 1000).toFixed(1)}s` : "—";
  return (
    `  ${t.goalId}  ·  ${t.mode}  ·  ${relativeTime(t.startedMs)}` +
    `${tag.length ? `  [${tag.join(" · ")}]` : ""}\n` +
    `    ${t.id}\n` +
    `    ${status} · ${t.turns} turns · ${t.llmCalls} calls · ${secs} · ${cost}` +
    `${t.cacheReadTokens > 0 ? ` · ${t.cacheReadTokens} cache-read` : ""}\n` +
    `    ${t.storyline}\n`
  );
}
