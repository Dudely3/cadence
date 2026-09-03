import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
// @ts-expect-error - plain .mjs helper: a Vite config is loaded outside Vite's
// bundler, so it cannot import workspace TypeScript.
import { controlApi } from "./control-server.mjs";

const TRACES_DIR = fileURLToPath(new URL("../../traces", import.meta.url));

/**
 * Serves the repo's traces/ directory to the viewer:
 *   GET /traces            → [{ name, mtimeMs, size }] newest first
 *   GET /traces/<name>     → the trace file
 * No-store headers so tailing live.json always sees the latest write.
 *
 * Deliberately dumb: it serves files and nothing else. Session summaries are
 * computed in the client from the same @cadence/core helper the CLI uses, so
 * there is no second implementation to drift — and the config file stays free
 * of workspace imports, which Node can't load as TypeScript.
 */

function handleTraces(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  const pathname = (req.url ?? "/").split("?")[0] ?? "/";

  if (pathname === "/" || pathname === "") {
    let files: Array<{ name: string; mtimeMs: number; size: number }> = [];
    try {
      files = fs
        .readdirSync(TRACES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((name) => {
          const s = fs.statSync(path.join(TRACES_DIR, name));
          return { name, mtimeMs: s.mtimeMs, size: s.size };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      /* no traces dir yet — empty list is the right answer */
    }
    res.end(JSON.stringify(files));
    return;
  }

  // basename() forbids path traversal; only .json is served.
  const name = path.basename(decodeURIComponent(pathname));
  if (!name.endsWith(".json")) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    res.end(fs.readFileSync(path.join(TRACES_DIR, name)));
  } catch {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  }
}

function tracesApi(): Plugin {
  return {
    name: "cadence-traces-api",
    configureServer(server) {
      server.middlewares.use("/traces", handleTraces);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/traces", handleTraces);
    },
  };
}

export default defineConfig({
  plugins: [react(), tracesApi(), controlApi()],
});
