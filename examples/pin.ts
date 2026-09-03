/**
 * Pin the recording that `npm run demo:replay` should use — your stage
 * fallback, chosen deliberately instead of by "whatever ran last".
 *
 *   npm run pin
 *
 * Interactive on purpose: a command taking an argument would have to be run as
 * `npm run pin -- <id>`, and that silently loses its arguments on PowerShell
 * (see examples/flags.ts). Pick from a numbered list instead.
 *
 * Pinning COPIES the trace to traces/pinned.json, so later cleanup of old
 * recordings can't break the fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { relativeTime } from "@cadence/core";
import { ask } from "./ask";
import { listTraces, PINNED_FILE } from "./flags";

const traces = listTraces().filter((t) => t.outcome === "completed");
if (traces.length === 0) {
  console.error("No completed recordings in traces/ — record a successful live run first.");
  process.exit(1);
}

const pinnedPath = path.resolve("traces", PINNED_FILE);
let currentId: string | undefined;
try {
  if (fs.existsSync(pinnedPath)) {
    currentId = (JSON.parse(fs.readFileSync(pinnedPath, "utf8")) as { session?: { id?: string } })
      .session?.id;
  }
} catch {
  /* unreadable pin — treat as none */
}

console.log(
  currentId
    ? `\nCurrently pinned: ${currentId}\n`
    : "\nNothing pinned yet — demo:replay is falling back to the newest completed run.\n",
);
traces.forEach((t, i) => {
  const cost = t.costUsd > 0 ? `$${t.costUsd.toFixed(4)}` : "free";
  console.log(
    `  ${String(i + 1).padStart(2)}. ${t.goalId} · ${t.mode} · ${relativeTime(t.startedMs)}` +
      `${t.id === currentId ? "   [currently pinned]" : ""}\n` +
      `      ${t.turns} turns · ${t.llmCalls} calls · ${cost}   ${t.id}\n` +
      `      ${t.storyline}`,
  );
});

const answer = await ask(`\nPin which? [1-${traces.length}, or Enter/q to cancel] `);
const text = answer.trim().toLowerCase();

if (text === "" || text === "q" || text === "quit" || text === "cancel") {
  console.log("Cancelled — nothing changed.");
  process.exit(0);
}

const choice = Number(text);
if (!Number.isInteger(choice) || choice < 1 || choice > traces.length) {
  console.error(`"${answer.trim()}" isn't one of 1-${traces.length}. Cancelled — nothing changed.`);
  process.exit(1);
}

const picked = traces[choice - 1]!;
fs.copyFileSync(path.resolve(picked.path), pinnedPath);
console.log(
  `\nPinned ${picked.id} — ${picked.goalId} · ${picked.mode} · ${picked.turns} turns\n` +
    `  copied to traces/${PINNED_FILE}; 'npm run demo:replay' will use it.`,
);
