import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import type {
  ActionResult,
  ArgSource,
  Environment,
  Observation,
  Tool,
} from "@cadence/core";

/**
 * BrowserEnv — Playwright behind the same Environment interface the notepad
 * implements. The loop cannot tell the difference; that's the thesis.
 *
 * Observation model: each snapshot tags every visible interactive element with
 * a data-cad-id and lists them as [id] <tag> label. Tools act by element id,
 * and every tool result carries a FRESH snapshot, so the model always holds
 * current ids (the loop never re-observes on its own — state rides tool
 * results, PLAN.md open-question resolved in favor of tool-results-carry-state).
 *
 * argSources: element-id args are reported as {kind:"dom", selector:"<tag>|<label>"}
 * — the tool knows its arg was a handle into a page that can shift. On replay,
 * resolveArg() re-finds the element by that signature on the LIVE page, so a
 * recorded click survives reordering. This is the first real producer for the
 * re-resolution engine.
 */

interface ElementInfo {
  id: number;
  tag: string;
  label: string;
  value: string;
}

export interface BrowserEnvOptions {
  /** Page to open on first observe. */
  startUrl?: string;
  /** Default true. Set false to watch it live (great on stage). */
  headless?: boolean;
  /**
   * Cap on listed interactive elements per snapshot. Default 200.
   *
   * A cap is a backstop, not a strategy: the extraction above cleans the page
   * so the real content fits, and this only stops a pathological page (a table
   * of 5000 links) from filling the context. Set it low and a demo silently
   * loses the element it needed — on a conference site, 60 slots went entirely
   * to speaker links before any session link appeared.
   */
  maxElements?: number;
  /** Characters of page text shown in the state block. Default 6000. */
  pageTextLimit?: number;
  /**
   * Restrict which of this environment's tools are offered, by name. Default:
   * all of them.
   *
   * The environment owns this rather than the caller filtering
   * availableTools() afterwards, because the system hint and the state block
   * both talk about the tools — a hint that says "use find_in_page" when
   * find_in_page was filtered out is a prompt telling the model to call
   * something that does not exist.
   */
  tools?: string[];
  /**
   * What the state block carries for page content.
   *
   *   "cleaned" (default) — the extracted text: markup gone, headings kept
   *   "raw"               — document.outerHTML, every tag and attribute
   *
   * "raw" exists to be measured against, not used: it's the naive choice the
   * context ladder starts from (examples/ladder.ts).
   */
  representation?: "cleaned" | "raw";
  /**
   * Page viewport. Default 1280x900. Shrink it when the headed window has to
   * share the screen with something else (the context viewer, on stage).
   */
  viewport?: { width: number; height: number };
  /** Per-action Playwright timeout, ms. Default 5000 — fail fast, as an observation. */
  actionTimeoutMs?: number;
  /**
   * Navigation timeout, ms. Default 30000. Separate from actionTimeoutMs on
   * purpose: clicking a missing element should fail in seconds, but a real
   * website legitimately takes longer than that to load, and the action
   * timeout also governs page.goto — a 5s cap fails on live sites.
   */
  navigationTimeoutMs?: number;
}

const PAGE_TEXT_LIMIT = 6_000;

/**
 * A preview of a long page: the head AND the tail, not just the head.
 *
 * Pages put navigation and headings at the top and the things that change —
 * carts, totals, status, results — at the BOTTOM. A head-only preview hides
 * exactly the part a task usually needs to read back, and the model burns
 * turns hunting for a total that was cut off. Measured: with a head-only
 * window the ladder's explore rung added the right items and then thrashed
 * for six turns trying to read the cart total.
 */
function previewOf(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.7);
  const tail = limit - head;
  const skipped = text.length - limit;
  const gap = `\n\n… ${skipped} characters not shown — use find_in_page to search them …\n\n`;
  return text.slice(0, head) + gap + text.slice(text.length - tail);
}

export class BrowserEnv implements Environment {
  name = "browser";
  private browser: Browser | undefined;
  private page: Page | undefined;
  private elements: ElementInfo[] = [];
  /**
   * FULL cleaned page text from the last snapshot. The state block carries a
   * capped preview of this — the tail is re-sent every turn, so its size is a
   * recurring per-turn cost — while find_in_page searches all of it.
   */
  private lastText = "";

  constructor(private readonly opts: BrowserEnvOptions = {}) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? true,
    });
    this.page = await this.browser.newPage({
      viewport: this.opts.viewport ?? { width: 1280, height: 900 },
    });
    this.page.setDefaultTimeout(this.opts.actionTimeoutMs ?? 5000);
    this.page.setDefaultNavigationTimeout(
      this.opts.navigationTimeoutMs ?? 30_000,
    );
    // tsx/esbuild's keepNames decorates functions with a __name helper that
    // doesn't exist inside the browser — page.evaluate callbacks would throw.
    await this.page.addInitScript("window.__name = (fn) => fn;");
    if (this.opts.startUrl) {
      await this.page.goto(this.opts.startUrl, { waitUntil: "load" });
    }
    return this.page;
  }

  async observe(): Promise<Observation> {
    const page = await this.ensurePage();
    const max = this.opts.maxElements ?? 200;

    const snap = await page.evaluate((maxEls: number) => {
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el as HTMLElement);
        return s.visibility !== "hidden" && s.display !== "none";
      };
      // Tag EVERY visible interactive element; the caller decides how many to
      // LIST. Addressability and display are different concerns: capping before
      // tagging makes anything past the cap both unclickable and invisible to
      // find_in_page, so a search can surface a button the model then cannot
      // press. 2000 is only a runaway guard.
      void maxEls;
      const els = Array.from(
        document.querySelectorAll(
          "a[href], button, input, select, textarea, [role='button']",
        ),
      )
        .filter(visible)
        .slice(0, 2000);
      const infos = els.map((el, i) => {
        el.setAttribute("data-cad-id", String(i));
        const tag = el.tagName.toLowerCase();
        const input = el as HTMLInputElement;
        const label =
          el.getAttribute("aria-label") ||
          input.placeholder ||
          (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80) ||
          el.getAttribute("name") ||
          "";
        const hasValue =
          tag === "input" || tag === "textarea" || tag === "select";
        return {
          id: i,
          tag,
          label,
          value: hasValue ? (input.value ?? "") : "",
        };
      });
      // CLEAN the page rather than truncate it (Solo's approach): walk the DOM,
      // skip the parts that are never content, keep headings so structure
      // survives as text, and drop consecutive duplicates — site chrome repeats
      // the same nav labels several times. A blunt character cut silently hides
      // whatever sits below it, which reads to the model as "the page doesn't
      // contain that" and sends it hunting for a scrollbar it doesn't have.
      const SKIP = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "SVG",
        "IFRAME",
        "CANVAS",
        "TEMPLATE",
        "HEAD",
        "META",
        "LINK",
      ]);
      const BREAK = "␀break";
      const lines: string[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t) lines.push(t);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if (SKIP.has(el.tagName)) return;
        if (el.getAttribute("aria-hidden") === "true") return;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;

        if (/^H[1-6]$/.test(el.tagName)) {
          const t = (el.innerText ?? "").replace(/\s+/g, " ").trim();
          // Emitted whole and not re-walked, so the break marker can never end
          // up interleaved with a heading's own text nodes.
          if (t) lines.push(`${"#".repeat(Number(el.tagName[1]))} ${t}`);
          return;
        }
        for (const child of Array.from(el.childNodes)) walk(child);
        if (
          style.display.startsWith("block") ||
          el.tagName === "LI" ||
          el.tagName === "TR"
        ) {
          lines.push(BREAK);
        }
      };
      walk(document.body);

      const cleaned: string[] = [];
      for (const raw of lines) {
        if (raw === BREAK) {
          if (cleaned[cleaned.length - 1] !== "") cleaned.push("");
          continue;
        }
        if (cleaned[cleaned.length - 1] === raw) continue;
        cleaned.push(raw);
      }
      const text = cleaned
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        title: document.title,
        text,
        rawHtml: document.documentElement.outerHTML,
        infos,
      };
    }, max);

    this.elements = snap.infos;
    const raw = this.opts.representation === "raw";
    this.lastText = raw ? snap.rawHtml : snap.text;
    const limit = this.opts.pageTextLimit ?? PAGE_TEXT_LIMIT;
    const content = raw ? snap.rawHtml : snap.text;
    // Say so when the preview is partial. Silent truncation reads to the model
    // as "the page doesn't contain that", and it goes looking for a scrollbar.
    const truncated = content.length > limit;
    // Only advertise a tool that is actually offered. Telling the model to
    // "use find_in_page" when find_in_page was not registered is a prompt
    // pointing at nothing, and it spends turns finding that out.
    const searchable = this.has("find_in_page");
    // Display is capped; addressability is not. Everything tagged above stays
    // clickable and findable, so find_in_page can hand back an [id] the model
    // never saw listed — which is what makes a small window workable.
    const shown = snap.infos.slice(0, max);
    const elementLines =
      shown
        .map(
          (e) =>
            `[${e.id}] <${e.tag}> ${e.label}${e.value ? ` (value: ${JSON.stringify(e.value)})` : ""}`,
        )
        .join("\n") +
      (snap.infos.length > shown.length
        ? `\n… ${snap.infos.length - shown.length} more elements not listed — find_in_page returns their [id]s.`
        : "");

    return {
      summary:
        `URL: ${page.url()}\nTitle: ${snap.title}\n\n--- page ${raw ? "HTML" : "text"}${
          truncated
            ? ` (first ${limit} of ${content.length} chars${
                searchable
                  ? " — use find_in_page to search the rest"
                  : " — the rest is not available"
              })`
            : " (complete)"
        } ---\n` +
        `${previewOf(content, limit)}` +
        `\n\n--- interactive elements ---\n${elementLines}`,
      raw: { url: page.url(), elements: snap.infos },
    };
  }

  systemHint(): string {
    const parts = [
      "A web browser. Each turn you receive a fresh CURRENT STATE block: the page plus a numbered list of interactive elements. Tool results are brief confirmations only — the state block is where the page is.",
    ];
    // There is no read-the-page tool: the state block already contains the
    // page, so one would hand back what the model was just given. Say so,
    // because a model that cannot find something will otherwise look for one.
    parts.push(
      this.has("find_in_page")
        ? "The page text may be a PREVIEW of a longer page — its header says so when it is. To look for something that isn't in the preview, use find_in_page: it searches the whole page and reports matching lines and elements. There is no tool that re-reads the page; the state block is the page."
        : "The state block's header says whether the page is complete or a preview. There is no tool that re-reads or re-fetches the page — what you are given each turn is all of it there is.",
    );
    parts.push(
      "Act on elements by their [id]. Ids are re-assigned on every state refresh — always use ids from the LATEST current-state block.",
    );
    parts.push(
      "When the goal is met, call complete with an appropriate status.",
    );
    return parts.join(" ");
  }

  /** Signature used for dom argSources: "<tag>|<label>". */
  private signatureOf(id: number): string | undefined {
    const el = this.elements[id];
    return el ? `${el.tag}|${el.label}` : undefined;
  }

  async resolveArg(source: ArgSource): Promise<unknown> {
    if (source.kind !== "dom") return undefined;
    // Re-observe so the signature is matched against the CURRENT page.
    await this.observe();
    const [tag, label] = source.selector.split("|", 2);
    const exact = this.elements.find((e) => e.tag === tag && e.label === label);
    if (exact) return exact.id;
    const fuzzy = this.elements.find(
      (e) =>
        e.tag === tag &&
        label !== undefined &&
        (e.label.includes(label) || label.includes(e.label)),
    );
    return fuzzy?.id;
  }

  availableTools(): Tool[] {
    const all = [
      this.navigateTool(),
      this.clickTool(),
      this.typeTool(),
      this.pressKeyTool(),
      this.hoverTool(),
      this.selectOptionTool(),
      this.findInPageTool(),
      this.readElementTool(),
      this.waitForTextTool(),
      this.scrollTool(),
      this.goBackTool(),
      this.goForwardTool(),
      this.reloadTool(),
    ];
    const wanted = this.opts.tools;
    if (!wanted) return all;
    for (const name of wanted) {
      if (!all.some((t) => t.name === name))
        console.warn(`BrowserEnv: no tool named "${name}"`);
    }
    return all.filter((t) => wanted.includes(t.name));
  }

  /** Is this tool actually offered? The prompt's wording depends on it. */
  private has(name: string): boolean {
    return this.opts.tools ? this.opts.tools.includes(name) : true;
  }

  async dispose(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  // --- tools -----------------------------------------------------------------
  // Tool results are BRIEF outcomes (Solo-style): the full page state is not
  // frozen into history — it arrives via the fresh CURRENT STATE tail each turn.

  private async settle(): Promise<void> {
    const page = await this.ensurePage();
    await page.waitForLoadState("load").catch(() => undefined);
  }

  /**
   * Search the page instead of re-reading it. Cheaper than a full snapshot and
   * it answers the question the model actually has ("is X on this page, and
   * what can I click near it?"), which a page dump only answers by accident.
   */
  /** Matches shown per find_in_page call. The reported count is the true total. */
  private static readonly MAX_HITS = 12;

  private findInPageTool(): Tool<{ text: string; context?: number }> {
    return {
      name: "find_in_page",
      description:
        "Search the current page for text. Returns each matching line with surrounding lines, plus any interactive elements whose label matches. To read a whole section, search for its heading with a large context.",
      schema: z.object({
        text: z
          .string()
          .min(1)
          .describe("Case-insensitive text to search for."),
        context: z
          .number()
          .int()
          .min(0)
          // 10 was too small and the model told us so: asked for a section, hit
          // "too_big", and then re-issued the same search three times instead.
          // A cap that refuses a legitimate request does not save context, it
          // spends turns — reading one section is exactly what this is for.
          .max(80)
          .optional()
          .describe(
            "Lines of surrounding context per match. Default 2. Use 30-80 to read a whole section around its heading.",
          ),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        // Reuse observe() rather than extracting again: one cleaning path means
        // the model can never be told the page says something the state block
        // doesn't. It also refreshes element ids as a side effect.
        // Refresh the snapshot (this also re-tags element ids), then search the
        // FULL cleaned text rather than the capped preview in the state block —
        // otherwise the search tool inherits the preview's blind spot, which is
        // the exact problem it exists to solve.
        await this.observe();
        const lines = this.lastText.split("\n");
        const needle = args.text.toLowerCase();
        const pad = args.context ?? 2;

        const hits: string[] = [];
        // Count every match but show only the first MAX_HITS. Reporting the
        // shown count as the total tells the model "8 matches" when there were
        // 40, and a model that believes it has seen everything stops looking.
        let matched = 0;
        for (let i = 0; i < lines.length; i++) {
          if (!(lines[i] ?? "").toLowerCase().includes(needle)) continue;
          matched += 1;
          if (hits.length >= BrowserEnv.MAX_HITS) continue;
          const from = Math.max(0, i - pad);
          const to = Math.min(lines.length - 1, i + pad);
          // Say which section the match is in. A window of lines around a hit
          // can straddle two entries, and then the neighbour's details read as
          // the match's own — measured: a search that found the right session
          // title returned the NEXT session's speaker inside its window, and
          // the model reported that speaker. Cleaning already marks headings
          // with #, so the nearest one above the match is free to include.
          let heading = "";
          for (let h = i; h >= 0 && h > i - 400; h--) {
            const line = lines[h] ?? "";
            if (line.startsWith("#")) {
              heading = line;
              break;
            }
          }
          const body = lines
            .slice(from, to + 1)
            .map((l, k) => `${from + k === i ? ">" : " "} ${l}`)
            .join("\n");
          hits.push(heading ? `(under ${heading})\n${body}` : body);
        }

        const elementHits = this.elements
          .filter((e) => e.label.toLowerCase().includes(needle))
          .slice(0, 20)
          .map((e) => `[${e.id}] <${e.tag}> ${e.label}`);

        if (hits.length === 0 && elementHits.length === 0) {
          return {
            ok: true,
            observation: {
              summary: `No match for ${JSON.stringify(args.text)} on this page. It may be on another page, or behind a link.`,
            },
          };
        }
        return {
          ok: true,
          observation: {
            summary:
              `${matched} text match(es) for ${JSON.stringify(args.text)}` +
              (matched > hits.length
                ? ` — showing the first ${hits.length}; narrow the search to see the rest`
                : "") +
              `:\n${hits.join("\n---\n")}` +
              (elementHits.length
                ? `\n\nMatching interactive elements:\n${elementHits.join("\n")}`
                : ""),
          },
        };
      },
    };
  }

  private scrollTool(): Tool<{ direction: "up" | "down" | "top" | "bottom" }> {
    return {
      name: "scroll",
      description:
        "Scroll the page. Page text is already extracted whole, so this is only for pages that load more content as you scroll.",
      schema: z.object({
        direction: z
          .enum(["up", "down", "top", "bottom"])
          .describe("Where to scroll."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        await page.evaluate((dir: string) => {
          const h = window.innerHeight;
          if (dir === "top") window.scrollTo({ top: 0 });
          else if (dir === "bottom")
            window.scrollTo({ top: document.body.scrollHeight });
          else window.scrollBy({ top: dir === "down" ? h * 0.9 : -h * 0.9 });
        }, args.direction);
        // Lazy-loaded content needs a moment to arrive before the next snapshot.
        await page.waitForTimeout(350);
        const y = await page.evaluate(() => Math.round(window.scrollY));
        return {
          ok: true,
          observation: {
            summary: `Scrolled ${args.direction} (now at y=${y}).`,
          },
        };
      },
    };
  }

  private selectOptionTool(): Tool<{ elementId: number; value: string }> {
    return {
      name: "select_option",
      description:
        "Choose an option in a <select> dropdown, by the element's [id].",
      schema: z.object({
        elementId: z
          .number()
          .int()
          .describe("Element id from the latest snapshot."),
        value: z.string().describe("Option value or visible label."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: {
              summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
            },
          };
        }
        const locator = page.locator(`[data-cad-id="${args.elementId}"]`);
        // A <select> takes either the option's value or its visible text; try
        // the label second so either one the model read off the page works.
        try {
          await locator.selectOption({ value: args.value });
        } catch {
          await locator.selectOption({ label: args.value });
        }
        await this.settle();
        return {
          ok: true,
          observation: {
            summary: `Selected ${JSON.stringify(args.value)} in [${args.elementId}].`,
          },
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }

  private goBackTool(): Tool<Record<string, never>> {
    return {
      name: "go_back",
      description: "Go back to the previous page in browser history.",
      schema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      execute: async (): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const res = await page.goBack({ waitUntil: "load" }).catch(() => null);
        if (!res) {
          return {
            ok: false,
            error: "no history entry to go back to",
            observation: { summary: "Nothing to go back to." },
          };
        }
        return {
          ok: true,
          observation: { summary: `Went back to ${page.url()}.` },
        };
      },
    };
  }

  private goForwardTool(): Tool<Record<string, never>> {
    return {
      name: "go_forward",
      description:
        "Go forward to the next page in browser history. Only works after go_back.",
      schema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      execute: async (): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const res = await page
          .goForward({ waitUntil: "load" })
          .catch(() => null);
        if (!res) {
          return {
            ok: false,
            error: "no history entry to go forward to",
            observation: { summary: "Nothing to go forward to." },
          };
        }
        return {
          ok: true,
          observation: { summary: `Went forward to ${page.url()}.` },
        };
      },
    };
  }

  private reloadTool(): Tool<Record<string, never>> {
    return {
      name: "reload",
      description:
        "Reload the current page. Use when the page looks like it is showing stale content — not to re-read it, since the state block is regenerated every turn regardless.",
      schema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      execute: async (): Promise<ActionResult> => {
        const page = await this.ensurePage();
        await page.reload({ waitUntil: "load" });
        await this.settle();
        return {
          ok: true,
          observation: { summary: `Reloaded ${page.url()}.` },
        };
      },
    };
  }

  private pressKeyTool(): Tool<{ key: string; elementId?: number }> {
    return {
      name: "press_key",
      description:
        "Press a single key, optionally focusing one element first. Use for keys that mean something to the page rather than for entering text: Enter to submit, Escape to dismiss, Tab to move focus, ArrowDown or ArrowUp to move through a list. To type characters, use type_text.",
      schema: z.object({
        key: z
          .string()
          .min(1)
          .describe(
            'One key name, e.g. "Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "PageDown", "Backspace".',
          ),
        elementId: z
          .number()
          .int()
          .optional()
          .describe(
            "Focus this element from the latest state block before pressing.",
          ),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        if (args.elementId !== undefined) {
          const signature = this.signatureOf(args.elementId);
          if (signature === undefined) {
            return {
              ok: false,
              error: `no element [${args.elementId}] in the latest state`,
              observation: {
                summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
              },
            };
          }
          await page
            .locator(`[data-cad-id="${args.elementId}"]`)
            .press(args.key);
          await this.settle();
          return {
            ok: true,
            observation: {
              summary: `Pressed ${args.key} on [${args.elementId}] ${signature.replace("|", " · ")}.`,
            },
            argSources: { elementId: { kind: "dom", selector: signature } },
          };
        }
        await page.keyboard.press(args.key);
        await this.settle();
        return { ok: true, observation: { summary: `Pressed ${args.key}.` } };
      },
    };
  }

  private hoverTool(): Tool<{ elementId: number }> {
    return {
      name: "hover",
      description:
        "Move the pointer over an element without clicking. Use to open a menu or reveal content that only appears on hover; the next state block shows whatever appeared.",
      schema: z.object({
        elementId: z
          .number()
          .int()
          .describe("Element id from the latest state block."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: {
              summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
            },
          };
        }
        await page.locator(`[data-cad-id="${args.elementId}"]`).hover();
        await this.settle();
        return {
          ok: true,
          observation: {
            summary: `Hovered [${args.elementId}] ${signature.replace("|", " · ")}.`,
          },
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }

  private waitForTextTool(): Tool<{ text: string; timeoutMs?: number }> {
    return {
      name: "wait_for_text",
      description:
        "Wait until some text appears on the page, for content that loads after the page itself does. Returns as soon as it appears, or reports that it did not within the timeout. Do not use it to re-check something the state block already shows.",
      schema: z.object({
        text: z
          .string()
          .min(1)
          .describe("Text to wait for. Case-sensitive substring."),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(30000)
          .optional()
          .describe("How long to wait. Default 5000."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const timeout = args.timeoutMs ?? 5000;
        const started = Date.now();
        try {
          // getByText matches a substring of rendered text by default, which is
          // what "appears on the page" means from the model's side.
          await page
            .getByText(args.text, { exact: false })
            .first()
            .waitFor({ timeout });
        } catch {
          return {
            ok: false,
            error: `"${args.text}" did not appear within ${timeout}ms`,
            observation: {
              summary: `Waited ${timeout}ms and ${JSON.stringify(args.text)} did not appear. It may be spelled differently, or below a preview cut — the state block says when it is partial.`,
            },
          };
        }
        return {
          ok: true,
          observation: {
            summary: `${JSON.stringify(args.text)} appeared after ${Date.now() - started}ms.`,
          },
        };
      },
    };
  }

  private readElementTool(): Tool<{ elementId: number }> {
    return {
      name: "read_element",
      description:
        "Read one element in full: its complete text, its value, and its link target. The state block truncates long labels to keep the list readable, so use this when a label is cut off and the rest of it matters.",
      schema: z.object({
        elementId: z
          .number()
          .int()
          .describe("Element id from the latest state block."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: {
              summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
            },
          };
        }
        const detail = await page
          .locator(`[data-cad-id="${args.elementId}"]`)
          .evaluate((el) => {
            const input = el as HTMLInputElement & { href?: string };
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
              value: typeof input.value === "string" ? input.value : "",
              href: typeof input.href === "string" ? input.href : "",
              disabled: (el as HTMLButtonElement).disabled === true,
            };
          })
          .catch(() => null);
        if (!detail) {
          return {
            ok: false,
            error: `element [${args.elementId}] is no longer in the page`,
            observation: {
              summary: `[${args.elementId}] was in the last state block but is not in the page now. Act on ids from the newest block.`,
            },
          };
        }
        const lines = [
          `[${args.elementId}] <${detail.tag}>${detail.disabled ? " (disabled)" : ""}`,
          `text: ${detail.text || "(none)"}`,
        ];
        if (detail.value) lines.push(`value: ${detail.value}`);
        if (detail.href) lines.push(`href: ${detail.href}`);
        return {
          ok: true,
          observation: { summary: lines.join("\n") },
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }

  private navigateTool(): Tool<{ url: string }> {
    return {
      name: "navigate",
      description: "Navigate the browser to a URL.",
      schema: z.object({
        url: z.string().describe("Absolute URL, including protocol."),
      }),
      execute: async (_env, args) => {
        const page = await this.ensurePage();
        await page.goto(args.url, { waitUntil: "load" });
        return {
          ok: true,
          observation: { summary: `Navigated to ${page.url()}.` },
        };
      },
    };
  }

  private clickTool(): Tool<{ elementId: number }> {
    return {
      name: "click",
      description:
        "Click an interactive element from the latest snapshot, by its [id].",
      schema: z.object({
        elementId: z
          .number()
          .int()
          .describe("Element id from the latest snapshot."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: {
              summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
            },
          };
        }
        await page.locator(`[data-cad-id="${args.elementId}"]`).click();
        await this.settle();
        return {
          ok: true,
          observation: {
            summary: `Clicked [${args.elementId}] ${signature.replace("|", " · ")}.`,
          },
          // The id was a handle into a page that can shift — dom-sourced.
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }

  private typeTool(): Tool<{
    elementId: number;
    text: string;
    pressEnter?: boolean;
  }> {
    return {
      name: "type_text",
      description:
        "Type into an input/textarea from the latest snapshot, replacing its contents.",
      schema: z.object({
        elementId: z
          .number()
          .int()
          .describe("Element id from the latest snapshot."),
        text: z.string(),
        pressEnter: z
          .boolean()
          .optional()
          .describe("Press Enter after typing."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: {
              summary: `No element [${args.elementId}] in the latest CURRENT STATE block.`,
            },
          };
        }
        const locator = page.locator(`[data-cad-id="${args.elementId}"]`);
        await locator.fill(args.text);
        if (args.pressEnter) await locator.press("Enter");
        await this.settle();
        return {
          ok: true,
          observation: {
            summary: `Typed ${JSON.stringify(args.text)} into [${args.elementId}] ${signature.replace("|", " · ")}${args.pressEnter ? " and pressed Enter" : ""}.`,
          },
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }
}
