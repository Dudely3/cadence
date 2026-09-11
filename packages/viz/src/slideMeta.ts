/**
 * Slide frontmatter: the binding between a slide, the recordings it is about,
 * and the run it can launch.
 *
 * Split out of slideDeck.ts so it can be read outside a browser — the whole
 * point of a binding that names files on disk is being able to check, from a
 * terminal before a talk, that every one of them is still there. slideDeck.ts
 * loads the markdown with `import.meta.glob`, which only exists inside Vite;
 * this file is plain TypeScript with no imports at all.
 */

/**
 * A run this slide is about, pre-configured. Reaching the slide loads these
 * into the run panel, so running it live is one button rather than a row of
 * fields to fill in under stage lights.
 */
export interface SlideRun {
  /** Button text, e.g. "run rung 1 live". */
  label?: string;
  /** Example to spawn; defaults to the browser demo. Allowlisted server-side. */
  script?: string;
  goal?: string;
  goalId?: string;
  mode?: "speed" | "accuracy" | "replay";
  /** A recording to replay instead of calling a model — `pinned`, or an id. */
  replay?: string;
  url?: string;
  /** Extra argv for scripts with their own flags, e.g. `--scenario shop`. */
  args?: string[];
  step?: boolean;
  headed?: boolean;
  viewport?: string;
  /** One line under the button: what this run needs, costs, or proves. */
  note?: string;
  /**
   * A single value the presenter can EDIT before starting, passed as
   * `<paramFlag> <value>` — two argv entries, so it may contain spaces.
   *
   * This is the difference between demonstrating that a recording can be
   * re-pointed and just asserting it: type a different product, press start,
   * watch the same recording do different work.
   */
  paramFlag?: string;
  /** Field label, e.g. "Product". Defaults to the flag name. */
  paramLabel?: string;
  /** Starting value in the field. */
  paramValue?: string;
}

/**
 * Optional frontmatter: a `---` block at the very top, one `key: value` per
 * line, dotted keys for the run config.
 *
 *     ---
 *     sessions: sess_mtokkqsv_1, sess_mtokl26s_2
 *     run.label: run rung 1 live
 *     run.script: examples/ladder.ts
 *     run.args: --scenario shop --rung 1
 *     ---
 *
 * Flat dotted keys rather than YAML: this repo ships two runtime dependencies
 * and a slide deck isn't a good reason for a third, and indentation-sensitive
 * config is a bad thing to be debugging ten minutes before a talk.
 */
export function parseFrontmatter(src: string): { meta: Map<string, string>; body: string } {
  const meta = new Map<string, string>();
  const lines = src.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return { meta, body: src };

  let closed = false;
  let i = 1;
  for (; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "---") {
      closed = true;
      i++;
      break;
    }
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  // Unclosed fence: keep the whole file as the body. A slide that silently
  // loses its text is a much worse failure than one that ignores its config.
  if (!closed) return { meta: new Map(), body: src };
  return { meta, body: lines.slice(i).join("\n") };
}

/** `sess_x` / `sess_x.json` / `live.json` → a trace file name. */
export function traceFileName(raw: string): string {
  const t = raw.trim();
  return t.endsWith(".json") ? t : `${t}.json`;
}

/** Frontmatter's `run.*` keys → a SlideRun, or nothing if it has none. */
export function readRun(
  meta: Map<string, string>,
  warn: (message: string) => void = () => {},
): SlideRun | undefined {
  const get = (k: string): string | undefined => meta.get(`run.${k}`) || undefined;
  const bool = (k: string): boolean | undefined => {
    const v = get(k);
    return v === undefined ? undefined : !["false", "0", "no"].includes(v);
  };
  if (![...meta.keys()].some((k) => k.startsWith("run."))) return undefined;

  const run: SlideRun = {};
  const label = get("label");
  if (label) run.label = label;
  const script = get("script");
  if (script) run.script = script;
  const goal = get("goal");
  if (goal) run.goal = goal;
  const goalId = get("goalId");
  if (goalId) run.goalId = goalId;
  const mode = get("mode");
  if (mode === "speed" || mode === "accuracy" || mode === "replay") run.mode = mode;
  else if (mode) warn(`run.mode "${mode}" is not a mode — ignoring it`);
  const replay = get("replay");
  if (replay) run.replay = replay;
  const url = get("url");
  if (url) run.url = url;
  const viewport = get("viewport");
  if (viewport) run.viewport = viewport;
  const note = get("note");
  if (note) run.note = note;
  const paramFlag = get("paramFlag");
  if (paramFlag) run.paramFlag = paramFlag;
  const paramLabel = get("paramLabel");
  if (paramLabel) run.paramLabel = paramLabel;
  const paramValue = get("paramValue");
  if (paramValue) run.paramValue = paramValue;
  // Whitespace-split, so anything containing spaces (a goal, a URL with a
  // query) belongs in its own key instead of here.
  const args = get("args");
  if (args) run.args = args.split(/\s+/).filter(Boolean);
  const step = bool("step");
  if (step !== undefined) run.step = step;
  const headed = bool("headed");
  if (headed !== undefined) run.headed = headed;
  return run;
}

/** Everything one slide file declares, without its prose. */
export interface SlideMeta {
  title: string;
  body: string;
  sessions: string[];
  run?: SlideRun;
}

export function parseSlide(
  name: string,
  raw: string,
  warn: (message: string) => void = () => {},
): SlideMeta {
  const { meta, body } = parseFrontmatter(raw);
  const heading = body.split("\n").find((l) => l.startsWith("# "));
  const sessions = (meta.get("sessions") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(traceFileName);
  const run = readRun(meta, warn);
  return {
    title: heading ? heading.slice(2).trim() : name,
    body,
    sessions,
    ...(run ? { run } : {}),
  };
}
