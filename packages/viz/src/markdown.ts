/**
 * A very small markdown subset.
 *
 * Deliberately hand-rolled: this repo ships two runtime dependencies and a
 * slide deck isn't a good reason for a third. Supports what the slides use —
 * headings, bullets, tables, block quotes, rules, fenced code, and inline
 * bold / italic / code.
 *
 * Lives apart from slideDeck.ts (which loads the files with
 * `import.meta.glob`, a Vite-only thing) so a terminal can render every slide
 * and check it. That is not hypothetical tidiness: the fenced-code branch
 * below shipped for days with a `while` loop that never advanced its index,
 * and it went unnoticed because no slide had a code fence in it. `npm run
 * slides` now parses all of them.
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type Block =
  | { kind: "h1" | "h2" | "h3" | "p" | "quote"; spans: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "hr" };

export function parseInline(text: string): Inline[] {
  const spans: Inline[] = [];
  // One pass over **bold**, *italic* and `code`; nesting isn't needed by these
  // slides. **bold** must be tried before *italic* or the double asterisks are
  // consumed as two italic runs — and an unsupported marker leaks its asterisks
  // onto the screen, which is exactly the kind of thing you notice on stage.
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) spans.push({ text: m[3], italic: true });
    else if (m[4] !== undefined) spans.push({ text: m[4], code: true });
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
      // A `for` with its own increment, not a `while` over the shared index:
      // the previous version's body never advanced `i`, so it pushed the same
      // line until the array hit its length limit and threw `RangeError:
      // Invalid array length`. Written this way it cannot fail to advance.
      // (It survived because no slide had a code fence — nothing ran it.)
      for (i++; i < lines.length; i++) {
        if ((lines[i] ?? "").trim().startsWith("```")) break;
        buf.push(lines[i] ?? "");
      }
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
    // Ordered and unordered lists share everything but their marker. Ordered
    // is here because a stage walkthrough is inherently numbered, and without
    // it "1. do this  2. then this" renders as one run-on paragraph — which is
    // exactly how it shipped on the two-shapes slide.
    const ORDERED = /^\d{1,2}[.)]\s+/;
    const marker = (line: string): number =>
      line.startsWith("- ") ? 2 : (ORDERED.exec(line)?.[0].length ?? 0);
    const width = marker(t);
    if (width > 0) {
      flush();
      const ordered = !t.startsWith("- ");
      const items = [t.slice(width)];
      while (i + 1 < lines.length) {
        const raw = lines[i + 1] ?? "";
        const next = raw.trim();
        const w = marker(next);
        // Only continue a list with its OWN marker kind: a numbered step
        // following bullets starts a new list rather than joining theirs.
        if (w > 0 && !next.startsWith("- ") === ordered) {
          items.push(next.slice(w));
          i++;
          continue;
        }
        // An indented continuation line belongs to the item above it.
        if (next !== "" && raw.startsWith("  ")) {
          items[items.length - 1] += ` ${next}`;
          i++;
          continue;
        }
        break;
      }
      out.push({ kind: ordered ? "ol" : "ul", items: items.map(parseInline) });
      continue;
    }
    para.push(t);
  }
  flush();
  return out;
}
