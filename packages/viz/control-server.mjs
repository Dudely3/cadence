/**
 * Run control for the viewer: start, step and stop agent runs from the page.
 *
 *   POST /control/start   { goal, goalId, mode, step, headed, viewport, replay }
 *   POST /control/step    advance one turn (writes a newline to the run's stdin)
 *   POST /control/go      release the gate; the run finishes unattended
 *   POST /control/stop    kill the run
 *   GET  /control/state?since=N   status + output lines produced after N
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
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = "examples/browse.ts";
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

function buildArgs(body) {
  const args = [SCRIPT];
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

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal) {
    args.push("--goal", goal);
    const id = typeof body.goalId === "string" ? body.goalId.trim() : "";
    args.push("--goal-id", id || "custom");
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
    pushLine(run, `— run finished (exit ${code ?? 0}) —`);
  });

  run.child = child;
  current = run;
  pushLine(run, `$ tsx ${args.join(" ")}`);
  return { ok: true, id: run.id };
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
  if (!current) return { running: false, lines: [], cursor: 0, exitCode: null };
  return {
    running: current.running,
    id: current.id,
    exitCode: current.exitCode,
    gateReleased: current.gateReleased,
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

export const _internal = { buildArgs, path };
