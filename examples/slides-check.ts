/**
 * Free check: does every slide's binding still resolve?
 *
 *   npm run slides
 *
 * A slide names the recordings it is about and the run it can launch. Both are
 * references to things outside the markdown — trace files on disk, a script the
 * control server is willing to spawn — and both rot silently. A slide pointing
 * at a deleted recording looks fine until you are standing in front of a room
 * and the pane is empty.
 *
 * No API key, no model calls, no cost. It reads files and asks the real code:
 * the same frontmatter parser the viewer uses, the same MARKDOWN parser it
 * renders with, and the control server's own `buildArgs` for the command — so
 * a script the server would refuse to spawn, a flag its filter would drop, or
 * a slide that crashes the renderer fails here instead of on stage.
 *
 * That last one is not hypothetical. The renderer's fenced-code branch had a
 * loop that never advanced its index; it threw `RangeError: Invalid array
 * length` on any slide with a code fence, and shipped unnoticed because no
 * slide had one until slide 24.
 */
import fs from "node:fs";
import path from "node:path";
import { parseSlide, type SlideRun } from "../packages/viz/src/slideMeta";
import { parseMarkdown } from "../packages/viz/src/markdown";
// The server's own argv builder, including the script allowlist and the
// flag-shape filter. Checking against a copy of those rules would prove
// nothing about what actually runs.
// @ts-expect-error - plain .mjs helper, no type declarations
import { _internal } from "../packages/viz/control-server.mjs";

const buildArgs = _internal.buildArgs as (body: Record<string, unknown>) => string[];

const SLIDES_DIR = "slides";
const TRACES_DIR = "traces";
const PINS = path.join(SLIDES_DIR, "pins.json");

const problems: string[] = [];

/** Widest code line a slide can hold without scrolling sideways. */
const CODE_COLS = 46;
const notes: string[] = [];

/** A readable trace, described — or a reason it isn't one. */
function describeTrace(name: string): { ok: boolean; text: string } {
  const file = path.join(TRACES_DIR, name);
  if (!fs.existsSync(file)) return { ok: false, text: `${name} — NOT IN ${TRACES_DIR}/` };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      session?: { goal?: { id?: string }; mode?: string; turns?: unknown[] };
      result?: { outcome?: string };
    };
    if (!raw.session) return { ok: false, text: `${name} — no session in the file` };
    return {
      ok: true,
      text: `${name} — ${raw.session.goal?.id ?? "?"} · ${raw.session.mode ?? "?"} · ${
        raw.session.turns?.length ?? 0
      } turns · ${raw.result?.outcome ?? "unfinished"}`,
    };
  } catch (err) {
    return { ok: false, text: `${name} — unreadable (${(err as Error).message})` };
  }
}

/** What the control server would actually spawn for this slide's run. */
function checkRun(slide: string, run: SlideRun): void {
  const body: Record<string, unknown> = {
    goal: run.goal ?? "",
    mode: run.mode === "accuracy" ? "accuracy" : "speed",
    ...(run.mode === "replay" ? { replay: run.replay ?? "pinned" } : {}),
    step: run.step !== false,
    headed: run.headed !== false,
    viewport: run.viewport ?? "940x820",
    ...(run.script ? { script: run.script } : {}),
    ...(run.args ? { args: run.args } : {}),
    ...(run.url ? { url: run.url } : {}),
    ...(run.goalId ? { goalId: run.goalId } : {}),
    ...(run.paramFlag && run.paramValue
      ? { paramFlag: run.paramFlag, paramValue: run.paramValue }
      : {}),
    slide,
  };
  const args = buildArgs(body);
  const spawned = args[0];

  if (run.script && spawned !== run.script) {
    problems.push(
      `${slide}: run.script "${run.script}" is not on the server's allowlist — it would run ${spawned} instead`,
    );
  }
  if (run.script && !fs.existsSync(run.script)) {
    problems.push(`${slide}: run.script "${run.script}" does not exist`);
  }
  for (const token of run.args ?? []) {
    if (!args.includes(token)) {
      problems.push(`${slide}: run.args token "${token}" is dropped by the server's filter`);
    }
  }
  // The editable value goes through a different, looser filter (it may contain
  // spaces). Check the default actually survives it, or the field on that slide
  // silently does nothing when you press start.
  if (run.paramFlag) {
    if (!args.includes(run.paramFlag)) {
      problems.push(`${slide}: run.paramFlag "${run.paramFlag}" is rejected by the server`);
    } else if (run.paramValue && !args.includes(run.paramValue)) {
      problems.push(`${slide}: run.paramValue "${run.paramValue}" is rejected by the server`);
    }
  }
  notes.push(`      would run: tsx ${args.join(" ")}`);
}

// Canary: exercise the renderer's harder branches whether or not a slide
// currently uses them. A parser bug that only fires on a construct nobody has
// written yet is a bug that ships.
const CANARIES: Array<[string, string, (b: ReturnType<typeof parseMarkdown>) => boolean]> = [
  ["fenced code", "# t\n\n```\na\nb\n```\n\ntail\n", (b) => b.some((x) => x.kind === "code")],
  ["unclosed fence", "# t\n\n```\na\n", (b) => b.some((x) => x.kind === "code")],
  ["table", "# t\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", (b) => b.some((x) => x.kind === "table")],
  ["bullets", "# t\n\n- one\n- two\n", (b) => b.some((x) => x.kind === "ul")],
  ["numbered list", "# t\n\n1. one\n2. two\n", (b) => b.some((x) => x.kind === "ol")],
  ["block quote", "# t\n\n> quoted\n> more\n", (b) => b.some((x) => x.kind === "quote")],
];
for (const [name, src, ok] of CANARIES) {
  try {
    if (!ok(parseMarkdown(src))) problems.push(`renderer canary "${name}": produced no such block`);
  } catch (err) {
    problems.push(`renderer canary "${name}": threw ${(err as Error).message}`);
  }
}

const files = fs
  .readdirSync(SLIDES_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

if (files.length === 0) {
  console.error(`no slides in ${SLIDES_DIR}/`);
  process.exit(1);
}

console.log(`checking ${files.length} slides\n`);

let bound = 0;
let runnable = 0;

for (const [i, name] of files.entries()) {
  const raw = fs.readFileSync(path.join(SLIDES_DIR, name), "utf8");
  const slide = parseSlide(name, raw, (m) => problems.push(`${name}: ${m}`));

  const bits: string[] = [];
  if (slide.sessions.length > 0) bits.push(`${slide.sessions.length} session(s)`);
  if (slide.run) bits.push("run");
  console.log(
    `${String(i + 1).padStart(2)}. ${slide.title}${bits.length ? `  [${bits.join(", ")}]` : ""}`,
  );

  // A body that starts with `---` means the frontmatter fence never closed and
  // the parser handed the whole file back as prose. The slide still renders,
  // which is exactly why this needs saying out loud.
  if (slide.body.trimStart().startsWith("---") && raw.trimStart().startsWith("---")) {
    problems.push(`${name}: frontmatter block is not closed by a second "---"`);
  }
  if (slide.title === name) {
    problems.push(`${name}: no "# " heading, so the slide list shows the file name`);
  }

  // Render it. The viewer would do this on arrival, in front of people.
  try {
    const blocks = parseMarkdown(slide.body);
    if (blocks.length === 0) problems.push(`${name}: renders to nothing`);
    // Code doesn't wrap — a `pre` scrolls sideways instead, so a long line
    // simply leaves the room's view. Measured in the viewer: the slides pane
    // is 460px at its default width and fits about 49 monospace characters,
    // and it is narrower than that whenever someone drags it.
    for (const b of blocks) {
      if (b.kind !== "code") continue;
      const over = b.text.split("\n").filter((l) => l.length > CODE_COLS);
      if (over.length > 0) {
        problems.push(
          `${name}: ${over.length} code line(s) over ${CODE_COLS} cols — ` +
            `they scroll off the slide (longest ${Math.max(...over.map((l) => l.length))}): ` +
            `${(over[0] ?? "").slice(0, 40)}…`,
        );
      }
    }
  } catch (err) {
    problems.push(`${name}: the renderer threw — ${(err as Error).message}`);
  }

  for (const trace of slide.sessions) {
    bound++;
    const d = describeTrace(trace);
    console.log(`      ${d.ok ? "·" : "✕"} ${d.text}`);
    if (!d.ok) problems.push(`${name}: ${d.text}`);
  }
  if (slide.run) {
    runnable++;
    checkRun(name, slide.run);
    console.log(notes[notes.length - 1]);
  }
}

// Runtime pins are written by the viewer, so a stale one here means a recording
// was deleted after a run bound it. Not fatal — the viewer greys it out — but
// worth knowing, because you cannot see it without opening the slide.
if (fs.existsSync(PINS)) {
  try {
    const pins = JSON.parse(fs.readFileSync(PINS, "utf8")) as Record<string, string[]>;
    const stale: string[] = [];
    for (const [slide, traces] of Object.entries(pins)) {
      if (!files.includes(slide)) stale.push(`${slide} (no such slide)`);
      for (const t of traces) {
        if (!fs.existsSync(path.join(TRACES_DIR, t))) stale.push(`${slide} → ${t}`);
      }
    }
    console.log(`\n${PINS}: ${Object.keys(pins).length} slide(s) with live-run pins`);
    for (const s of stale) console.log(`  ✕ stale: ${s}`);
    if (stale.length > 0) {
      problems.push(`${PINS} has ${stale.length} stale pin(s) — remove them in the slide's session strip`);
    }
  } catch {
    problems.push(`${PINS} is not readable JSON`);
  }
}

console.log(`\n${bound} bound recordings · ${runnable} slides can launch a run`);

if (problems.length > 0) {
  console.error(`\n✕ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ every slide binding resolves");
