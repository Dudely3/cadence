import fs from "node:fs";
import path from "node:path";
import {
  InMemoryTracer,
  type Goal,
  type Observation,
  type RunOutcome,
  type RunResult,
  type Session,
  type SessionContext,
  type Turn,
} from "@cadence/core";

/**
 * A Tracer that persists the Session to disk as it grows.
 *
 * Writes `<dir>/live.json` after every state change (context recorded, turn
 * closed, run finished) and `<dir>/<sessionId>.json` once at the end. The live
 * file is what the context viewer tails; the final file is the durable replay
 * artifact — and the demo-insurance copy.
 *
 * File-based on purpose: the loop carries zero UI code, and the viewer works
 * identically on a live run and a recording.
 */

/** What lands on disk. `result` appears once the run finishes. */
export interface TraceEnvelope {
  version: 1;
  session: Session;
  result?: RunResult;
  writtenAt: number;
}

export interface FileTracerOptions {
  /** Directory for trace files. Default: `traces` under the current working directory. */
  dir?: string;
  /** Name of the tailed file. Default: `live.json`. */
  liveFileName?: string;
  /**
   * Only maintain the live file; skip the final `<sessionId>.json`. For
   * replaying a recording on the viz — the durable artifact already exists,
   * and a re-run shouldn't mint a duplicate.
   */
  liveOnly?: boolean;
}

export class FileTracer extends InMemoryTracer {
  private readonly dir: string;
  private readonly liveFile: string;
  private readonly liveOnly: boolean;
  private result: RunResult | undefined;

  constructor(opts: FileTracerOptions = {}) {
    super();
    this.dir = path.resolve(opts.dir ?? "traces");
    this.liveFile = path.join(this.dir, opts.liveFileName ?? "live.json");
    this.liveOnly = opts.liveOnly ?? false;
  }

  /** Where the finished trace was written. Available after finish(). */
  get finalPath(): string | undefined {
    if (this.liveOnly) return undefined;
    return this.session && this.result ? path.join(this.dir, `${this.session.id}.json`) : undefined;
  }

  get livePath(): string {
    return this.liveFile;
  }

  override start(goal: Goal, mode: string): Session {
    const session = super.start(goal, mode);
    this.result = undefined;
    this.flush();
    return session;
  }

  override recordContext(ctx: SessionContext): void {
    super.recordContext(ctx);
    this.flush();
  }

  override closeTurn(turn: Turn): void {
    super.closeTurn(turn);
    this.flush();
  }

  override finish(
    outcome: RunOutcome,
    finalObservation: Observation,
    extra?: { error?: string; completionStatus?: string },
  ): RunResult {
    this.result = super.finish(outcome, finalObservation, extra);
    this.flush();
    if (this.session && !this.liveOnly) {
      this.write(path.join(this.dir, `${this.session.id}.json`));
    }
    return this.result;
  }

  private flush(): void {
    this.write(this.liveFile);
  }

  private write(file: string): void {
    if (!this.session) return;
    const envelope: TraceEnvelope = {
      version: 1,
      session: this.session,
      ...(this.result ? { result: this.result } : {}),
      writtenAt: Date.now(),
    };

    fs.mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify(sanitize(envelope, []), null, 2);

    // Write-then-rename so a tailing reader never sees a half-written file.
    // If Windows blocks the rename (reader mid-read), fall back to a direct
    // write — a rare torn read of live.json self-heals on the next poll.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, "utf8");
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, text, "utf8");
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Load a previously written trace — the input to replayMode and the viewer's
 * recording fallback.
 */
export function loadTrace(file: string): TraceEnvelope {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as TraceEnvelope;
  if (raw.version !== 1 || !raw.session) {
    throw new Error(`${file} is not a Cadence trace envelope`);
  }
  return raw;
}

/**
 * Observation.raw is `unknown` — a future environment could stash something
 * circular there (a Playwright page, say). The trace must never die for that.
 *
 * IMPORTANT: only a genuine cycle (a value containing itself) is replaced.
 * The Session legitimately holds SHARED references — the same tool-use input
 * object appears in assistantBlocks, toolUses, and the recorded action — and
 * those must serialize normally. A naive seen-once WeakSet replacer stomps the
 * second occurrence with "[circular]" and corrupts the trace's display copies.
 */
function sanitize(value: unknown, ancestors: object[]): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.includes(value)) return "[circular]";

  ancestors.push(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((v) => sanitize(v, ancestors));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "function" || v === undefined) continue;
      obj[k] = sanitize(v, ancestors);
    }
    out = obj;
  }
  ancestors.pop();
  return out;
}
