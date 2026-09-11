/**
 * Run control for the viewer: start, step and stop agent runs from the page.
 *
 *   POST /control/start   { script, goal, goalId, mode, step, headed, viewport, url, args, replay }
 *   POST /control/step    advance one turn (writes a newline to the run's stdin)
 *   POST /control/go      release the gate; the run finishes unattended
 *   POST /control/stop    kill the run
 *   GET  /control/state?since=N   status + output lines produced after N
 *   GET  /control/pins            slide file name → traces added by live runs
 *   POST /control/pin     { slide, trace }   remember a recording on a slide
 *   POST /control/unpin   { slide, trace }   forget one
 *
 * Why this doesn't undo the file-based design: the server SPAWNS THE SAME CLI
 * the terminal runs. The agent loop still contains zero UI code, the trace is
 * still the only channel the viewer reads for context anatomy, and everything
 * keeps working with this server switched off. This adds a remote control, not
 * a coupling.
 *
 * Plain .mjs on purpose: Node loads a Vite config outside Vite's bundler, so a
 * config that imports workspace TypeScript fails with ERR_UNKNOWN_FILE_EXTENSION.
 *
 * Stepping works because `stepped()` reads stdin: the child is spawned with a
 * piped stdin that stays open, and a newline is exactly what the gate waits
 * for. The pipe must NOT be closed early — an EOF reads as "go".
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_SCRIPT = "examples/browse.ts";
/**
 * The only scripts that can be spawned. A slide is authored content and a
 * browser can POST anything, so what is runnable is decided here rather than
 * taken from the request — the difference between a remote control and an
 * arbitrary command runner.
 */
const SCRIPTS = new Set([
  "examples/browse.ts",
  "examples/ladder.ts",
  "examples/rerun.ts",
  "examples/spike.ts",
]);
const TRACES_DIR = path.join(REPO_ROOT, "traces");
const PINS_FILE = path.join(REPO_ROOT, "slides", "pins.json");
const MAX_LINES = 500;

/** The one running child, if any. */
let current = null;

function pushLine(run, text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === "") continue;
    run.lines.push({ n: ++run.counter, text: line });
  }
  if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
}

/** Trace files present right now, so new ones can be attributed to a run. */
function traceNames() {
  try {
    return new Set(fs.readdirSync(TRACES_DIR).filter((f) => f.endsWith(".json")));
  } catch {
    return new Set();
  }
}

function buildArgs(body) {
  const wanted = typeof body.script === "string" ? body.script.trim() : "";
  const script = SCRIPTS.has(wanted) ? wanted : DEFAULT_SCRIPT;
  const args = [script];
  // Every value is pushed as its own argv entry and the child is spawned
  // WITHOUT a shell, so a goal containing spaces or quotes arrives intact.
  if (body.step !== false) args.push("--step");
  if (body.headed !== false) args.push("--headed");
  const viewport = typeof body.viewport === "string" ? body.viewport.trim() : "";
  if (/^\d{3,4}x\d{3,4}$/.test(viewport)) args.push("--viewport", viewport);

  if (body.replay) {
    args.push("--replay", String(body.replay));
  } else if (body.mode === "accuracy") {
    args.push("--mode", "accuracy");
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url) args.push("--url", url);

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal) {
    args.push("--goal", goal);
    const id = typeof body.goalId === "string" ? body.goalId.trim() : "";
    args.push("--goal-id", id || "custom");
  }

  // One editable value, as two argv entries. Unlike `args` below this may
  // contain SPACES — a product name has to — which is safe because the child is
  // spawned without a shell and each entry is passed separately. Control
  // characters and absurd lengths are still refused.
  const paramFlag = typeof body.paramFlag === "string" ? body.paramFlag.trim() : "";
  const paramValue = typeof body.paramValue === "string" ? body.paramValue.trim() : "";
  if (/^--[\w-]{1,40}$/.test(paramFlag) && paramValue && paramValue.length <= 200) {
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u001f]/.test(paramValue)) args.push(paramFlag, paramValue);
  }

  // Script-specific flags a slide can carry, e.g. `--scenario pdc --rung 3`.
  // Restricted to flag-shaped tokens: this arrives in a POST body, and the
  // point of the allowlist above is not to hand a child a free-form string.
  if (Array.isArray(body.args)) {
    for (const raw of body.args) {
      const token = String(raw).trim();
      if (token && /^[\w.:/=-]+$/.test(token)) args.push(token);
    }
  }
  return args;
}

function start(body) {
  if (current && current.running) return { error: "a run is already going — stop it first" };

  const args = buildArgs(body);
  const run = {
    id: `run_${Date.now().toString(36)}`,
    args,
    lines: [],
    counter: 0,
    running: true,
    exitCode: null,
    gateReleased: false,
    // Snapshot the directory rather than compare timestamps: "which files
    // appeared" is exact, where "modified since" is a guess about clock
    // granularity — and one run can write four traces (the ladder does).
    before: traceNames(),
    newTraces: [],
    slide: typeof body.slide === "string" ? body.slide : undefined,
  };

  // node <tsx-cli> examples/browse.ts … — spawning the resolved .mjs directly
  // avoids the npx/.cmd shim, which on Windows needs shell:true, and shell:true
  // re-joins argv without quoting (a goal with spaces would arrive truncated).
  const child = spawn(process.execPath, [require.resolve("tsx/cli"), ...args], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  child.stdout.on("data", (d) => pushLine(run, d));
  child.stderr.on("data", (d) => pushLine(run, d));
  child.on("error", (err) => {
    pushLine(run, `failed to start: ${err.message}`);
    run.running = false;
  });
  child.on("exit", (code) => {
    run.running = false;
    run.exitCode = code;
    // live.json is the run in progress, not a recording, and pinned.json is a
    // copy of one — neither is something to bind to a slide.
    run.newTraces = [...traceNames()].filter(
      (n) => !run.before.has(n) && n !== "live.json" && n !== "pinned.json",
    );
    pushLine(run, `— run finished (exit ${code ?? 0}) —`);
    if (run.newTraces.length > 0) pushLine(run, `recorded ${run.newTraces.join(", ")}`);
    // Bind what it recorded to the slide it was started from, HERE rather than
    // in the page: the server is what knows which slide launched this run, and
    // doing it server-side means a reload — or a closed tab — can't lose it.
    if (run.slide && run.newTraces.length > 0) {
      pin({ slide: run.slide, trace: run.newTraces }, true);
      pushLine(run, `pinned to ${run.slide}`);
    }
  });

  run.child = child;
  current = run;
  // Quote the entries that contain spaces. They are separate argv entries and
  // arrive intact, but an unquoted echo of `--items Down Sleeping Bag` reads
  // as three arguments and invites someone to paste it into a shell that way.
  pushLine(run, `$ tsx ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  return { ok: true, id: run.id };
}

// --- slide pins -----------------------------------------------------------
// Runtime bindings: slide file name → trace file names. Authored bindings live
// in each slide's frontmatter; this file is what live runs added. Both are
// committed — a rehearsal's recordings are the offline stage fallback — but
// they differ in who writes them, which is why the viewer can remove a pin and
// not a frontmatter binding.

function readPins() {
  try {
    const raw = JSON.parse(fs.readFileSync(PINS_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePins(pins) {
  fs.mkdirSync(path.dirname(PINS_FILE), { recursive: true });
  fs.writeFileSync(PINS_FILE, `${JSON.stringify(pins, null, 2)}\n`);
}

function pin(body, add) {
  const slide = typeof body.slide === "string" ? path.basename(body.slide) : "";
  const traces = [
    ...new Set(
      (Array.isArray(body.trace) ? body.trace : [body.trace])
        .filter((t) => typeof t === "string")
        .map((t) => path.basename(t))
        // live.json is whatever ran most recently and pinned.json is a copy of
        // another run: binding a slide to either would point it at something
        // different every time.
        .filter((t) => t.endsWith(".json") && t !== "live.json" && t !== "pinned.json"),
    ),
  ];
  if (!slide || traces.length === 0) return { error: "need a slide and at least one recording" };

  const pins = readPins();
  const have = Array.isArray(pins[slide]) ? pins[slide] : [];
  pins[slide] = add
    ? [...have, ...traces.filter((t) => !have.includes(t))]
    : have.filter((t) => !traces.includes(t));
  if (pins[slide].length === 0) delete pins[slide];
  writePins(pins);
  return { ok: true, pins };
}

function write(text) {
  if (!current || !current.running) return { error: "nothing is running" };
  current.child.stdin.write(text);
  return { ok: true };
}

function stop() {
  if (!current || !current.running) return { error: "nothing is running" };
  current.child.kill();
  return { ok: true };
}

function state(since) {
  if (!current) return { running: false, lines: [], cursor: 0, exitCode: null, newTraces: [] };
  return {
    running: current.running,
    id: current.id,
    exitCode: current.exitCode,
    gateReleased: current.gateReleased,
    slide: current.slide,
    newTraces: current.newTraces,
    cursor: current.counter,
    lines: current.lines.filter((l) => l.n > since),
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function controlApi() {
  const handler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = url.pathname.replace(/\/$/, "") || "/";

    try {
      if (route === "/state") {
        return res.end(JSON.stringify(state(Number(url.searchParams.get("since") ?? 0))));
      }
      if (route === "/pins") return res.end(JSON.stringify(readPins()));
      if (req.method !== "POST") {
        res.statusCode = 405;
        return res.end(JSON.stringify({ error: "POST required" }));
      }
      if (route === "/start") return res.end(JSON.stringify(start(await readBody(req))));
      if (route === "/step") return res.end(JSON.stringify(write("\n")));
      if (route === "/go") {
        const out = write("go\n");
        if (current && !out.error) current.gateReleased = true;
        return res.end(JSON.stringify(out));
      }
      if (route === "/stop") return res.end(JSON.stringify(stop()));
      if (route === "/pin") return res.end(JSON.stringify(pin(await readBody(req), true)));
      if (route === "/unpin") return res.end(JSON.stringify(pin(await readBody(req), false)));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return {
    name: "cadence-control-api",
    configureServer(server) {
      server.middlewares.use("/control", handler);
      // A dev-server restart must not orphan a headed Chromium.
      server.httpServer?.on("close", () => {
        if (current?.running) current.child.kill();
      });
    },
  };
}

export const _internal = { buildArgs, readPins, pin, path };
