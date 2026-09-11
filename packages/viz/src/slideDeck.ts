import type { Session } from "@cadence/core";
import { costOfSession } from "@cadence/core";
import { parseSlide, type SlideMeta } from "./slideMeta";

export type { SlideRun, SlideMeta } from "./slideMeta";
export { parseFrontmatter, parseSlide } from "./slideMeta";
export { parseInline, parseMarkdown, type Block, type Inline } from "./markdown";

/**
 * Slides for the talk: markdown files in `slides/`, loaded at build time so
 * editing one hot-reloads the page.
 *
 * Three things make these worth having in the viewer rather than in Keynote:
 * they sit beside the live anatomy, `{{...}}` placeholders resolve against the
 * trace that's currently open — so a caching claim is illustrated with the
 * numbers from the run on screen, not numbers from a rehearsal — and a slide
 * can name the recordings and the run that belong to it, so moving to a slide
 * also moves the viewer to the evidence for it.
 */

export interface Slide extends SlideMeta {
  /** File-order index, 0-based. */
  index: number;
  /** Source file name, e.g. "07-the-floor.md". */
  name: string;
}

const files = import.meta.glob("../../../slides/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const SLIDES: Slide[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, raw], index) => {
    const name = path.split("/").pop() ?? path;
    return { index, name, ...parseSlide(name, raw, (m) => console.warn(`${name}: ${m}`)) };
  });

/**
 * Which slides are about this recording — the reverse of a slide's `sessions`.
 *
 * Not one-to-one: one agent run backs seven different slides here, because the
 * same trace illustrates the goal message, the cache line, stability, the
 * lookback and more. So this returns all of them and the caller decides; only
 * an unambiguous single match is safe to act on automatically.
 */
export function slidesForTrace(trace: string, pins: Record<string, string[]> = {}): Slide[] {
  return SLIDES.filter(
    (s) => s.sessions.includes(trace) || (pins[s.name] ?? []).includes(trace),
  );
}

/**
 * Values a slide can interpolate with `{{name}}`. Everything comes from the
 * trace the viewer currently has open, so the slide and the anatomy beside it
 * can never disagree.
 */
export function slideValues(session: Session | undefined): Record<string, string> {
  if (!session) return {};
  const approx = (chars: number): number => Math.round(chars / 4);
  const usages = [
    ...session.turns.flatMap((t) => (t.usage ? [t.usage] : [])),
    ...(session.auxUsage ?? []),
  ];
  const sum = (pick: (u: (typeof usages)[number]) => number | undefined): number =>
    usages.reduce((n, u) => n + (pick(u) ?? 0), 0);

  const toolChars = JSON.stringify(session.tools ?? []).length;
  const systemChars = (session.system ?? "").length;
  const goalChars = session.goal.description.length;
  // The tail is replaced each turn, so the last one is the current cost.
  const tailChars = [...session.turns].reverse().find((t) => t.tail)?.tail?.length ?? 0;

  return {
    goal: session.goal.description,
    mode: session.mode,
    model: usages.find((u) => u.model && u.model !== "replay")?.model ?? "—",
    turns: String(session.turns.length),
    prefix_tokens: String(approx(toolChars + systemChars + goalChars)),
    tool_tokens: String(approx(toolChars)),
    system_tokens: String(approx(systemChars)),
    tail_tokens: String(approx(tailChars)),
    tools: String((session.tools ?? []).length),
    cache_read: sum((u) => u.cacheReadTokens).toLocaleString(),
    cache_write: sum((u) => u.cacheWriteTokens).toLocaleString(),
    fresh_input: sum((u) => u.inputTokens).toLocaleString(),
    output: sum((u) => u.outputTokens).toLocaleString(),
    calls: String(usages.length),
    cost: `$${costOfSession(session).toFixed(4)}`,
  };
}

/** Replace `{{name}}` with a live value; unknown names are left visible. */
export function resolvePlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}
