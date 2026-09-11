/**
 * Format lab: how much does the SHAPE of the context cost, and does the model
 * care? Measures both, on the same page, with real numbers.
 *
 *   npm run formatlab
 *   URL=… QUESTION=… EXPECTED=… npm run formatlab   (bash) — any page
 *
 * Seven representations of one page, from raw markup down to a bare element
 * list. For each: exact input tokens from the count-tokens endpoint (never an
 * estimate), and — for the ones that could contain the answer — whether Haiku
 * still answers a factual question about the page correctly.
 *
 * The claim under test: structure is mostly for OUR benefit. The model reads a
 * stripped, reformatted page about as well as pretty markup, which makes the
 * markup a cost you can choose not to pay.
 *
 * Defaults to the local shop page — offline, deterministic, known answers.
 */
import "./env";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";

const MODEL = "claude-haiku-4-5";
// Overridable so the lab works on any page, not just the bundled shop.
const QUESTION =
  process.env["QUESTION"] ??
  "What is the exact price of the Titanium Tent Stakes? Reply with just the price.";
const EXPECTED = process.env["EXPECTED"] ?? "11.50";

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("Needs ANTHROPIC_API_KEY (counts tokens and makes a few Haiku calls).");
  process.exit(1);
}

const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"];
const client = new Anthropic({
  ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
});

const url = process.env["URL"] ?? pathToFileURL(path.resolve("examples/site/shop.html")).href;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultNavigationTimeout(30_000);
// tsx/esbuild's keepNames decorates functions with a __name helper that doesn't
// exist inside the browser — page.evaluate callbacks throw without this shim.
// Same reason BrowserEnv installs it.
await page.addInitScript("window.__name = (fn) => fn;");
await page.goto(url, { waitUntil: "load" });

/** Every representation is derived from the SAME loaded page, in the browser. */
const reps = await page.evaluate(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "HEAD", "LINK", "META"]);
  const KEEP_ATTRS = ["href", "aria-label", "value", "placeholder"];

  // 1. raw markup, exactly as served
  const rawHtml = document.documentElement.outerHTML;

  // 2. same tree, attributes dropped except the few that carry meaning
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,noscript,svg,iframe,head,link,meta").forEach((n) => n.remove());
  clone.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (!KEEP_ATTRS.includes(a.name)) el.removeAttribute(a.name);
    }
  });
  const leanHtml = clone.outerHTML;

  // 3. the naive approach: whole-document innerText
  const innerText = document.body.innerText ?? "";

  // 4. cleaned text — headings kept, repeated chrome dropped (what BrowserEnv sends)
  const BREAK = "\u0001br";
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
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return;
    if (/^H[1-6]$/.test(el.tagName)) {
      const t = (el.innerText ?? "").replace(/\s+/g, " ").trim();
      if (t) lines.push("#".repeat(Number(el.tagName[1])) + " " + t);
      return;
    }
    for (const c of Array.from(el.childNodes)) walk(c);
    if (st.display.startsWith("block") || el.tagName === "LI" || el.tagName === "TR") lines.push(BREAK);
  };
  walk(document.body);
  const out: string[] = [];
  for (const l of lines) {
    if (l === BREAK) {
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (out[out.length - 1] === l) continue;
    out.push(l);
  }
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // 5. interactive elements only — no prose at all
  const els = Array.from(
    document.querySelectorAll("a[href], button, input, select, textarea, [role='button']"),
  ).map((el, i) => ({
    id: i,
    tag: el.tagName.toLowerCase(),
    label: (el.getAttribute("aria-label") || (el.textContent ?? "").trim().replace(/\s+/g, " ")).slice(0, 80),
  }));

  return { rawHtml, leanHtml, innerText, cleaned, els };
});
await browser.close();

const elementsPretty = JSON.stringify(reps.els, null, 2);
const elementsMin = JSON.stringify(reps.els);
const elementsLines = reps.els
  .map((e) => "[" + e.id + "] <" + e.tag + "> " + e.label)
  .join("\n");

interface Variant {
  name: string;
  text: string;
  /** Only quiz the model on representations that could contain the answer. */
  ask: boolean;
}

const variants: Variant[] = [
  { name: "raw HTML", text: reps.rawHtml, ask: true },
  { name: "HTML, attrs stripped", text: reps.leanHtml, ask: true },
  { name: "body.innerText", text: reps.innerText, ask: true },
  { name: "cleaned text", text: reps.cleaned, ask: true },
  { name: "elements, JSON pretty", text: elementsPretty, ask: false },
  { name: "elements, JSON minified", text: elementsMin, ask: false },
  { name: "elements, plain lines", text: elementsLines, ask: false },
];

async function countTokens(text: string): Promise<number> {
  const res = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: "user", content: text }],
  });
  return res.input_tokens;
}

async function askAbout(text: string): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 32,
    system: "Answer strictly from the page content given. Reply with the value only.",
    messages: [{ role: "user", content: text + "\n\n---\n" + QUESTION }],
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

console.log("page: " + url);
console.log("model: " + MODEL);
console.log("question: " + QUESTION + "\n");

const rows: Array<{ v: Variant; tokens: number; answer?: string; ok?: boolean }> = [];
for (const v of variants) {
  const tokens = await countTokens(v.text);
  const row: (typeof rows)[number] = { v, tokens };
  if (v.ask) {
    const answer = await askAbout(v.text);
    row.answer = answer;
    row.ok = answer.includes(EXPECTED);
  }
  rows.push(row);
}

const baseline = rows[0]?.tokens ?? 1;
console.log("  representation            |  tokens | vs raw | answered correctly");
console.log("  --------------------------|---------|--------|-------------------");
for (const r of rows) {
  const pct = Math.round((r.tokens / baseline) * 100) + "%";
  const verdict = r.ok === undefined ? "—" : r.ok ? "yes (" + r.answer + ")" : "NO (" + r.answer + ")";
  console.log(
    "  " + r.v.name.padEnd(25) + " | " + String(r.tokens).padStart(7) +
      " | " + pct.padStart(6) + " | " + verdict,
  );
}

const asked = rows.filter((r) => r.ok !== undefined);
const allRight = asked.every((r) => r.ok);
const cheapest = asked.reduce((a, b) => (a.tokens <= b.tokens ? a : b));
console.log("\n──────── verdict ────────");
console.log("every prose representation answered correctly: " + (allRight ? "YES" : "no"));
console.log(
  "cheapest correct one: " + cheapest.v.name + " at " + cheapest.tokens + " tokens — " +
    Math.round((1 - cheapest.tokens / baseline) * 100) + "% cheaper than raw HTML",
);
const pretty = rows.find((r) => r.v.name.includes("pretty"))?.tokens ?? 0;
const plain = rows.find((r) => r.v.name.includes("plain lines"))?.tokens ?? 0;
if (pretty && plain) {
  console.log(
    "same element data: pretty JSON " + pretty + " tok → plain lines " + plain + " tok (" +
      Math.round((1 - plain / pretty) * 100) + "% cheaper, identical information)",
  );
}
