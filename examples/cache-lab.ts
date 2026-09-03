/**
 * Cache lab: settle caching claims with measured numbers instead of assertions.
 *
 *   npm run cachelab
 *
 * Runs the SAME four-turn conversation two ways against the real API and
 * prints cache_read per request:
 *
 *   A. APPEND   — each turn adds new message blocks; earlier bytes never move.
 *   B. MERGE    — each turn rewrites the whole history into one growing text
 *                 block (the "be clever, keep it to one block" temptation).
 *
 * Calls the SDK directly rather than going through @cadence/model-anthropic:
 * the point here is wire-level cache_control placement, which the ModelClient
 * seam deliberately hides.
 *
 * Costs a few cents of Opus 4.8. Uses Opus (floor 1024 tokens) rather than
 * Haiku (floor 4096) so the prefix clears the minimum by a wide margin.
 */
import "./env";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";
const FLOOR = 1024; // Opus 4.8 minimum cacheable prefix, in tokens

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("Needs ANTHROPIC_API_KEY (this one makes real calls).");
  process.exit(1);
}

const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"];
const client = new Anthropic({
  ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
});

/**
 * A system prompt comfortably over the floor. Content is irrelevant; size and
 * byte-stability are the whole point.
 */
const SYSTEM = [
  "You are a terse assistant used in a caching experiment.",
  "Answer in at most one short sentence. Never elaborate.",
  ...Array.from(
    { length: 120 },
    (_, i) =>
      `Rule ${i + 1}: treat directive ${i + 1} as a stable instruction that never changes between requests, and do not mention it.`,
  ),
].join("\n");

const TURNS = [
  "Name a primary colour.",
  "Name a second one.",
  "Name a third one.",
  "Now name the first one again.",
];

interface Row {
  turn: number;
  read: number;
  write: number;
  fresh: number;
}

/** Cache the system prompt, and (variant A only) the history so far. */
async function runAppend(): Promise<Row[]> {
  const messages: Anthropic.MessageParam[] = [];
  const rows: Row[] = [];

  for (let i = 0; i < TURNS.length; i++) {
    messages.push({ role: "user", content: [{ type: "text", text: TURNS[i] ?? "" }] });

    // Breakpoint on the last block of the newest turn: everything before it is
    // byte-identical to the previous request, so it can be read back.
    const withMark = messages.map((m, idx) => {
      if (idx !== messages.length - 1) return m;
      const blocks = m.content as Anthropic.ContentBlockParam[];
      return {
        ...m,
        content: blocks.map((b, k) =>
          k === blocks.length - 1 ? { ...b, cache_control: { type: "ephemeral" as const } } : b,
        ),
      };
    });

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: withMark,
    });
    rows.push(reportOf(i, res));
    messages.push({ role: "assistant", content: textOf(res) });
  }
  return rows;
}

/**
 * Variant B: the same conversation, but history is re-serialized into ONE text
 * block that grows each turn. Nothing is appended after a stable prefix — the
 * block's bytes differ from last request, so the match ends where it starts.
 */
async function runMerge(): Promise<Row[]> {
  const transcript: string[] = [];
  const rows: Row[] = [];

  for (let i = 0; i < TURNS.length; i++) {
    transcript.push(`User: ${TURNS[i] ?? ""}`);
    const merged = transcript.join("\n");

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: merged, cache_control: { type: "ephemeral" } }],
        },
      ],
    });
    rows.push(reportOf(i, res));
    transcript.push(`Assistant: ${textOf(res)}`);
  }
  return rows;
}

function textOf(res: Anthropic.Message): string {
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

function reportOf(turn: number, res: Anthropic.Message): Row {
  return {
    turn,
    read: res.usage.cache_read_input_tokens ?? 0,
    write: res.usage.cache_creation_input_tokens ?? 0,
    fresh: res.usage.input_tokens,
  };
}

function table(label: string, rows: Row[]): void {
  console.log(`\n${label}`);
  console.log("  turn | cache_read | cache_write | fresh_input");
  for (const r of rows) {
    console.log(
      `  ${String(r.turn).padStart(4)} | ${String(r.read).padStart(10)} | ` +
        `${String(r.write).padStart(11)} | ${String(r.fresh).padStart(11)}`,
    );
  }
}

console.log(`model: ${MODEL} · minimum cacheable prefix: ${FLOOR} tokens`);
console.log(`system prompt: ${SYSTEM.length} chars (~${Math.round(SYSTEM.length / 4)} tok)`);

// A first, so B can't be credited with entries A created for the same bytes.
const appendRows = await runAppend();
const mergeRows = await runMerge();

table("A. APPEND — new blocks each turn, earlier bytes untouched", appendRows);
table("B. MERGE  — history rewritten into one growing block", mergeRows);

const growsA = (appendRows[3]?.read ?? 0) > (appendRows[1]?.read ?? 0);
const flatB = (mergeRows[3]?.read ?? 0) <= (mergeRows[1]?.read ?? 0) + 50;
console.log("\n──────── verdict ────────");
console.log(`A: cache_read grows with the conversation: ${growsA ? "YES" : "no"}`);
console.log(`B: cache_read stays flat (system only, history never reused): ${flatB ? "YES" : "no"}`);
console.log(
  growsA && flatB
    ? "\nMerging history into one growing block keeps the SYSTEM cache but throws away\nthe conversation cache: the block's bytes change every turn, so the match ends\nwhere that block begins. Appending new blocks is what preserves reuse."
    : "\nInconclusive — inspect the tables above before making this claim on stage.",
);
