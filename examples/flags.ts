/**
 * Demo options from CLI flags, with the environment as a fallback.
 *
 *   npm run browse -- --step --headed --viewport 940x820
 *
 * Flags exist because `VAR=1 npm run browse` is bash-only: PowerShell has no
 * inline env-var prefix, and `$env:VAR = 1` leaks into the rest of the session
 * (your next run is still stepping and you can't see why). Flags work the same
 * in every shell and expire with the command.
 *
 * Env vars still work — CI and bash habits shouldn't break — but an explicit
 * flag always wins over one.
 */

import fs from "node:fs";
import path from "node:path";
import { summarizeSession, type RunResult, type Session, type SessionSummary } from "@cadence/core";

export interface DemoFlags {
  step: boolean;
  headed: boolean;
  viewport?: { width: number; height: number };
  mode?: string;
  replay?: string;
  /** A goal written at the command line, replacing the example's built-in one. */
  goal?: string;
  /** Id recorded with a custom goal; only matters for grouping recordings. */
  goalId?: string;
  /** Page to start on. Defaults to the bundled local shop. */
  url?: string;
}

export function demoFlags(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): DemoFlags {
  let step: boolean | undefined;
  let headed: boolean | undefined;
  let viewportRaw: string | undefined;
  let mode: string | undefined;
  let replay: string | undefined;
  let goal: string | undefined;
  let goalId: string | undefined;
  let url: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      console.warn(`ignoring unexpected argument "${arg}"`);
      continue;
    }
    // Accept both `--flag=value` and `--flag value`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        console.warn(`--${name} needs a value; ignoring it`);
        return undefined;
      }
      i++;
      return next;
    };

    switch (name) {
      case "step":
        step = true;
        break;
      case "no-step":
        step = false;
        break;
      case "headed":
        headed = true;
        break;
      case "no-headed":
        headed = false;
        break;
      case "viewport":
        viewportRaw = takeValue() ?? viewportRaw;
        break;
      case "mode":
        mode = takeValue() ?? mode;
        break;
      case "replay":
        replay = takeValue() ?? replay;
        break;
      case "goal":
        goal = takeValue() ?? goal;
        break;
      case "goal-id":
        goalId = takeValue() ?? goalId;
        break;
      case "url":
        url = takeValue() ?? url;
        break;
      default:
        console.warn(`ignoring unknown flag "--${name}"`);
    }
  }

  const flags: DemoFlags = {
    step: step ?? env["STEP"] === "1",
    headed: headed ?? env["HEADED"] === "1",
  };
  const viewport = parseViewport(viewportRaw ?? env["VIEWPORT"]);
  if (viewport) flags.viewport = viewport;
  const resolvedMode = mode ?? env["MODE"];
  if (resolvedMode) flags.mode = resolvedMode;
  const resolvedReplay = replay ?? env["REPLAY"];
  if (resolvedReplay) flags.replay = resolvedReplay;
  const resolvedGoal = goal ?? env["GOAL"];
  if (resolvedGoal) flags.goal = resolvedGoal;
  const resolvedGoalId = goalId ?? env["GOAL_ID"];
  if (resolvedGoalId) flags.goalId = resolvedGoalId;
  const resolvedUrl = url ?? env["URL"];
  if (resolvedUrl) flags.url = resolvedUrl;
  return flags;
}

/** Filename the pin command writes; `--replay pinned` reads it. */
export const PINNED_FILE = "pinned.json";

export interface TraceInfo extends SessionSummary {
  /** File name, e.g. "sess_abc_1.json". */
  name: string;
  /** Path relative to the repo root, e.g. "traces/sess_abc_1.json". */
  path: string;
  mtimeMs: number;
}

/** Read every readable recording in `dir`, newest first. Skips live/pinned. */
export function listTraces(dir = "traces"): TraceInfo[] {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return [];
  const out: TraceInfo[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    if (name === "live.json" || name === PINNED_FILE) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as {
        session?: Session;
        result?: RunResult;
      };
      if (!raw.session) continue;
      out.push({
        ...summarizeSession(raw.session, raw.result),
        name,
        path: path.join(dir, name),
        mtimeMs: fs.statSync(path.join(root, name)).mtimeMs,
      });
    } catch {
      /* unreadable or half-written — not a candidate */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Turn a `--replay` value into a file path. Accepted forms:
 *
 *   pinned                 the trace pinned by `npm run pin` (falls back to latest)
 *   latest                 newest COMPLETED recording of this goal
 *   traces/sess_x.json     an explicit path
 *   sess_x                 a bare session id — resolved inside traces/
 *
 * "Newest that actually completed" is what a fallback means: a crashed or
 * half-finished run is exactly what you don't want to fall back to on stage.
 */
export function resolveReplayPath(replay: string, goalId: string, dir = "traces"): string {
  const pinnedPath = path.join(dir, PINNED_FILE);

  if (replay === "pinned") {
    if (fs.existsSync(path.resolve(pinnedPath))) {
      console.log(`--replay pinned → ${pinnedPath}${describe(pinnedPath)}`);
      return pinnedPath;
    }
    console.log(`no pinned trace (run \`npm run pin\` to choose one) — using latest instead`);
    return resolveReplayPath("latest", goalId, dir);
  }

  if (replay === "latest") {
    const hit = listTraces(dir).find((t) => t.goalId === goalId && t.outcome === "completed");
    if (!hit) {
      throw new Error(
        `--replay latest found no completed recording of "${goalId}" in ${dir}/. ` +
          "Record one with a successful live run first.",
      );
    }
    console.log(`--replay latest → ${hit.path} (${hit.mode}, ${hit.turns} turns)`);
    return hit.path;
  }

  // An explicit path wins if it exists; otherwise treat it as a bare id.
  if (fs.existsSync(path.resolve(replay))) return replay;
  for (const candidate of [path.join(dir, replay), path.join(dir, `${replay}.json`)]) {
    if (fs.existsSync(path.resolve(candidate))) {
      console.log(`--replay ${replay} → ${candidate}`);
      return candidate;
    }
  }
  throw new Error(
    `--replay "${replay}" matched no file. Try \`npm run traces\` to see what's available.`,
  );
}

/** " (accuracy, 3 turns)" for a resolved path, or "" if it can't be read. */
function describe(file: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as { session?: Session };
    return ` (${raw.session?.mode ?? "?"}, ${raw.session?.turns.length ?? 0} turns)`;
  } catch {
    return "";
  }
}

/** `940x820` → {width:940,height:820}. Anything else warns and falls back to the default. */
function parseViewport(raw: string | undefined): { width: number; height: number } | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const m = /^(\d{3,4})x(\d{3,4})$/i.exec(text);
  if (!m) {
    console.warn(`ignoring viewport "${text}" — expected WIDTHxHEIGHT, e.g. 940x820`);
    return undefined;
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}
