import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import type { ActionResult, ArgSource, Environment, Observation, Tool } from "@cadence/core";

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
  /** Characters of cleaned page text shown in the state block. Default 6000. */
  pageTextLimit?: number;
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
    this.browser = await chromium.launch({ headless: this.opts.headless ?? true });
    this.page = await this.browser.newPage({
      viewport: this.opts.viewport ?? { width: 1280, height: 900 },
    });
    this.page.setDefaultTimeout(this.opts.actionTimeoutMs ?? 5000);
    this.page.setDefaultNavigationTimeout(this.opts.navigationTimeoutMs ?? 30_000);
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
      const els = Array.from(
        document.querySelectorAll("a[href], button, input, select, textarea, [role='button']"),
      )
        .filter(visible)
        .slice(0, maxEls);
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
        const hasValue = tag === "input" || tag === "textarea" || tag === "select";
        return { id: i, tag, label, value: hasValue ? (input.value ?? "") : "" };
      });
      // CLEAN the page rather than truncate it (Solo's approach): walk the DOM,
      // skip the parts that are never content, keep headings so structure
      // survives as text, and drop consecutive duplicates — site chrome repeats
      // the same nav labels several times. A blunt character cut silently hides
      // whatever sits below it, which reads to the model as "the page doesn't
      // contain that" and sends it hunting for a scrollbar it doesn't have.
      const SKIP = new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "CANVAS",
        "TEMPLATE", "HEAD", "META", "LINK",
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
        if (style.display.startsWith("block") || el.tagName === "LI" || el.tagName === "TR") {
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
      const text = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      return { title: document.title, text, infos };
    }, max);

    this.elements = snap.infos;
    this.lastText = snap.text;
    const limit = this.opts.pageTextLimit ?? PAGE_TEXT_LIMIT;
    // Say so when the preview is partial. Silent truncation reads to the model
    // as "the page doesn't contain that", and it goes looking for a scrollbar.
    const truncated = snap.text.length > limit;
    const elementLines = snap.infos
      .map((e) => `[${e.id}] <${e.tag}> ${e.label}${e.value ? ` (value: ${JSON.stringify(e.value)})` : ""}`)
      .join("\n");

    return {
      summary:
        `URL: ${page.url()}\nTitle: ${snap.title}\n\n--- page text${
          truncated
            ? ` (first ${limit} of ${snap.text.length} chars — use find_in_page to search the rest)`
            : " (complete)"
        } ---\n` +
        `${snap.text.slice(0, limit)}` +
        `\n\n--- interactive elements ---\n${elementLines}`,
      raw: { url: page.url(), elements: snap.infos },
    };
  }

  systemHint(): string {
    return [
      "A web browser. Each turn you receive a fresh CURRENT STATE block: cleaned page text plus a numbered list of interactive elements. Tool results are brief confirmations only.",
      "The page text may be a PREVIEW of a longer page — its header says so when it is. To look for something that isn't in the preview, use find_in_page rather than scrolling or re-reading: it searches the whole page and reports matching lines and elements.",
      "Act on elements by their [id]. Ids are re-assigned on every state refresh — always use ids from the LATEST current-state block.",
      "When the goal is met, call complete with an appropriate status.",
    ].join(" ");
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
      (e) => e.tag === tag && label !== undefined && (e.label.includes(label) || label.includes(e.label)),
    );
    return fuzzy?.id;
  }

  availableTools(): Tool[] {
    return [
      this.navigateTool(),
      this.clickTool(),
      this.typeTool(),
      this.readPageTool(),
      this.findInPageTool(),
      this.scrollTool(),
      this.selectOptionTool(),
      this.goBackTool(),
    ];
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
  private findInPageTool(): Tool<{ text: string; context?: number }> {
    return {
      name: "find_in_page",
      description:
        "Search the current page for text. Returns each matching line with surrounding lines, plus any interactive elements whose label matches.",
      schema: z.object({
        text: z.string().min(1).describe("Case-insensitive text to search for."),
        context: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Lines of surrounding context per match. Default 2."),
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
        for (let i = 0; i < lines.length; i++) {
          if (!(lines[i] ?? "").toLowerCase().includes(needle)) continue;
          const from = Math.max(0, i - pad);
          const to = Math.min(lines.length - 1, i + pad);
          hits.push(
            lines
              .slice(from, to + 1)
              .map((l, k) => `${from + k === i ? ">" : " "} ${l}`)
              .join("\n"),
          );
          if (hits.length >= 8) break; // enough to act on; not a page dump
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
              `${hits.length} text match(es) for ${JSON.stringify(args.text)}:\n${hits.join("\n---\n")}` +
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
        direction: z.enum(["up", "down", "top", "bottom"]).describe("Where to scroll."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        await page.evaluate((dir: string) => {
          const h = window.innerHeight;
          if (dir === "top") window.scrollTo({ top: 0 });
          else if (dir === "bottom") window.scrollTo({ top: document.body.scrollHeight });
          else window.scrollBy({ top: dir === "down" ? h * 0.9 : -h * 0.9 });
        }, args.direction);
        // Lazy-loaded content needs a moment to arrive before the next snapshot.
        await page.waitForTimeout(350);
        const y = await page.evaluate(() => Math.round(window.scrollY));
        return { ok: true, observation: { summary: `Scrolled ${args.direction} (now at y=${y}).` } };
      },
    };
  }

  private selectOptionTool(): Tool<{ elementId: number; value: string }> {
    return {
      name: "select_option",
      description: "Choose an option in a <select> dropdown, by the element's [id].",
      schema: z.object({
        elementId: z.number().int().describe("Element id from the latest snapshot."),
        value: z.string().describe("Option value or visible label."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: { summary: `No element [${args.elementId}] in the latest CURRENT STATE block.` },
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
          observation: { summary: `Selected ${JSON.stringify(args.value)} in [${args.elementId}].` },
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
        return { ok: true, observation: { summary: `Went back to ${page.url()}.` } };
      },
    };
  }

  private navigateTool(): Tool<{ url: string }> {
    return {
      name: "navigate",
      description: "Navigate the browser to a URL.",
      schema: z.object({ url: z.string().describe("Absolute URL, including protocol.") }),
      execute: async (_env, args) => {
        const page = await this.ensurePage();
        await page.goto(args.url, { waitUntil: "load" });
        return { ok: true, observation: { summary: `Navigated to ${page.url()}.` } };
      },
    };
  }

  private clickTool(): Tool<{ elementId: number }> {
    return {
      name: "click",
      description: "Click an interactive element from the latest snapshot, by its [id].",
      schema: z.object({ elementId: z.number().int().describe("Element id from the latest snapshot.") }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: { summary: `No element [${args.elementId}] in the latest CURRENT STATE block.` },
          };
        }
        await page.locator(`[data-cad-id="${args.elementId}"]`).click();
        await this.settle();
        return {
          ok: true,
          observation: { summary: `Clicked [${args.elementId}] ${signature.replace("|", " · ")}.` },
          // The id was a handle into a page that can shift — dom-sourced.
          argSources: { elementId: { kind: "dom", selector: signature } },
        };
      },
    };
  }

  private typeTool(): Tool<{ elementId: number; text: string; pressEnter?: boolean }> {
    return {
      name: "type_text",
      description: "Type into an input/textarea from the latest snapshot, replacing its contents.",
      schema: z.object({
        elementId: z.number().int().describe("Element id from the latest snapshot."),
        text: z.string(),
        pressEnter: z.boolean().optional().describe("Press Enter after typing."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const page = await this.ensurePage();
        const signature = this.signatureOf(args.elementId);
        if (signature === undefined) {
          return {
            ok: false,
            error: `no element [${args.elementId}] in the latest state`,
            observation: { summary: `No element [${args.elementId}] in the latest CURRENT STATE block.` },
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

  private readPageTool(): Tool<Record<string, never>> {
    return {
      name: "read_page",
      description: "Read the current page's full text (less trimmed than the snapshot).",
      schema: z.object({}),
      execute: async () => {
        const page = await this.ensurePage();
        const text = await page.evaluate(() => (document.body.innerText ?? ""));
        return {
          ok: true,
          observation: { summary: `URL: ${page.url()}\n\n${text.slice(0, 6000)}` },
        };
      },
    };
  }
}
