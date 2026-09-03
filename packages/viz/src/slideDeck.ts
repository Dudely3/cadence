import type { Session } from "@cadence/core";
import { costOfSession } from "@cadence/core";

/**
 * Slides for the talk: markdown files in `slides/`, loaded at build time so
 * editing one hot-reloads the page.
 *
 * Two things make these worth having in the viewer rather than in Keynote:
 * they sit beside the live anatomy, and `{{...}}` placeholders resolve against
 * the trace that's currently open — so a caching claim is illustrated with the
 * numbers from the run on screen, not numbers from a rehearsal.
 */

export interface Slide {
  /** File-order index, 0-based. */
  index: number;
  /** Source file name, e.g. "07-the-floor.md". */
  name: string;
  /** First heading, used for the slide list. */
  title: string;
  /** Raw markdown, placeholders unresolved. */
  body: string;
}

const files = import.meta.glob("../../../slides/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const SLIDES: Slide[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, body], index) => {
    const name = path.split("/").pop() ?? path;
    const heading = body.split("\n").find((l) => l.startsWith("# "));
    return { index, name, title: heading ? heading.slice(2).trim() : name, body };
  });

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

// --- a very small markdown subset ------------------------------------------
// Deliberately hand-rolled: this repo ships two runtime dependencies and a
// slide deck isn't a good reason for a third. Supports what the slides use —
// headings, bullets, tables, block quotes, rules, fenced code, and inline
// bold / code.

export type Inline = { text: string; bold?: boolean; code?: boolean };

export type Block =
  | { kind: "h1" | "h2" | "h3" | "p" | "quote"; spans: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "hr" };

export function parseInline(text: string): Inline[] {
  const spans: Inline[] = [];
  // One pass over **bold** and `code`; nesting isn't needed by these slides.
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) spans.push({ text: m[3], code: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}

const cells = (row: string): Inline[][] =>
  row
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseMarkdown(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split(/\r?\n/);
  let para: string[] = [];

  const flush = (): void => {
    if (para.length === 0) return;
    out.push({ kind: "p", spans: parseInline(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const t = line.trim();

    if (t === "") { flush(); continue; }
    if (t.startsWith("```")) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) buf.push(lines[i] ?? "");
      out.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    if (/^---+$/.test(t)) { flush(); out.push({ kind: "hr" }); continue; }
    if (t.startsWith("### ")) { flush(); out.push({ kind: "h3", spans: parseInline(t.slice(4)) }); continue; }
    if (t.startsWith("## ")) { flush(); out.push({ kind: "h2", spans: parseInline(t.slice(3)) }); continue; }
    if (t.startsWith("# ")) { flush(); out.push({ kind: "h1", spans: parseInline(t.slice(2)) }); continue; }
    if (t.startsWith("> ")) {
      flush();
      const buf = [t.slice(2)];
      while (i + 1 < lines.length && (lines[i + 1] ?? "").trim().startsWith(">")) {
        buf.push((lines[++i] ?? "").trim().replace(/^>\s?/, ""));
      }
      out.push({ kind: "quote", spans: parseInline(buf.join(" ")) });
      continue;
    }
    if (t.startsWith("| ")) {
      flush();
      const rows = [t];
      while (i + 1 < lines.length && (lines[i + 1] ?? "").trim().startsWith("|")) rows.push((lines[++i] ?? "").trim());
      // A markdown table's second row is the alignment rule — skip it.
      const [head, , ...body] = rows;
      out.push({ kind: "table", head: cells(head ?? ""), rows: body.map(cells) });
      continue;
    }
    if (t.startsWith("- ")) {
      flush();
      const items = [t.slice(2)];
      while (i + 1 < lines.length) {
        const next = (lines[i + 1] ?? "").trim();
        if (next.startsWith("- ")) { items.push(next.slice(2)); i++; continue; }
        // An indented continuation line belongs to the bullet above it.
        if (next !== "" && (lines[i + 1] ?? "").startsWith("  ")) {
          items[items.length - 1] += ` ${next}`;
          i++;
          continue;
        }
        break;
      }
      out.push({ kind: "ul", items: items.map(parseInline) });
      continue;
    }
    para.push(t);
  }
  flush();
  return out;
}
