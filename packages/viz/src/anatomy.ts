import { buildMessages, FROZEN_STATE_PREFIX } from "@cadence/core";
import type { ContentBlock, Session, Turn } from "@cadence/core";

/**
 * Turns a Session into the anatomy of the request sent for a given turn —
 * by calling the SAME buildMessages the loop uses over the turns that were
 * closed at that moment. One renderer; what you see is what was sent.
 */

/** Cache role of a block within one request — or the turn's own output. */
export type Region =
  /** Covered by an earlier request's breakpoint — served from cache. */
  | "cached"
  /** Between the previous breakpoint and this one — written to cache now. */
  | "cache-write"
  /** Sent uncached and not yet covered by any breakpoint. */
  | "fresh"
  /** Not part of the request: what the MODEL generated this turn. */
  | "response"
  /**
   * What the ENVIRONMENT sent back. Drawn beside the response because that is
   * when it happened, but it is not output and costs nothing here — the model
   * did not generate it and is not billed for it until the next request, where
   * it arrives as cache write.
   */
  | "result";

export const REGION_LABEL: Record<Region, string> = {
  cached: "cached · read",
  "cache-write": "freezing · cache write",
  fresh: "fresh · after the cache line",
  response: "response · this turn's output",
  result: "environment · free here, charged next request",
};

export interface AnatomyBlock {
  id: string;
  /** Which wire shape this block is — it sets the envelope cost. */
  kind: "text" | "tool_use" | "tool_result";
  /** Short label for the block chip, e.g. "turn 2 · append_line()". */
  label: string;
  role: "tools" | "system" | "user" | "assistant";
  region: Region;
  /** This block carries cache_control on the wire. */
  breakpoint: boolean;
  chars: number;
  /** Raw content for the detail panel. */
  body: string;
  /**
   * The block EXACTLY as it goes on the wire, envelope included. `body` is the
   * readable payload; this is what the model is actually charged for, and it is
   * what `tokens` is computed over.
   */
  wire: string;
  /** Tokens this block costs in the request. See tokensFor(). */
  tokens: number;
  /**
   * True when `tokens` was reconciled against the usage the API reported for
   * this request, false when it is only an estimate (authored traces, and live
   * turns that have not closed yet).
   */
  exact: boolean;
  isError?: boolean;
}

/**
 * What the local estimator produced for one region, next to what the API
 * charged — kept so the fit can be TESTED rather than trusted. The numbers on
 * screen are always the recorded ones; this is how far the estimate was off
 * before scaling, and examples/tokens-check.ts fails when that ratio drifts far
 * enough to mean a whole cost has gone unmodelled again.
 */
export interface RegionAudit {
  region: Region;
  estimate: number;
  recorded: number;
  blocks: number;
}

export interface RequestAnatomy {
  turnIndex: number;
  blocks: AnatomyBlock[];
  /** Index into `blocks` of the last breakpoint (the cache line). -1 if none. */
  cacheLineAt: number;
  /**
   * The request carried a breakpoint and the API honoured none of it — read 0,
   * write 0, everything billed fresh. With cache_control actually on the wire
   * that has one cause: the prefix is under the model's minimum cacheable
   * length (1,024 tokens; 4,096 on Haiku 4.5), so the line is simply ignored.
   *
   * Worth its own flag because the caption over that line otherwise claims
   * "everything above is frozen" across blocks the pane has just painted fresh
   * — the exact contradiction the floor slide exists to explain.
   */
  cacheLineDeclined: boolean;
  /** What came back this turn: thought + tool calls, then their results. */
  response: AnatomyBlock[];
  /** True while the turn exists but hasn't closed (live, in flight). */
  responsePending: boolean;
  /**
   * The `result` blocks below the response are the NEXT request's input, not
   * this turn's output — `SessionPresentation.resultsAreNextInput`. Only the
   * heading over them changes; they are drawn either way, because "the system
   * did this, outside the model" is the same fact in both architectures.
   */
  resultsAreNextInput: boolean;
  /**
   * True when block tokens were scaled to the usage the API reported for this
   * request, so the columns sum to the invoice. False means every number on
   * screen is an estimate — say so rather than letting a reader assume.
   */
  reconciled: boolean;
  /** Estimator-vs-invoice, per region. Empty when the turn has no usage. */
  audit: RegionAudit[];
  /** The turn this request produced, if it exists yet. */
  turn?: Turn;
}

/**
 * What a block costs beyond its visible text, and how densely that text
 * tokenizes. Both measured with count_tokens against claude-opus-4-8
 * (2026-09-12); neither was guessable, and the previous `chars / 4` over the
 * payload alone got the answer wrong by 4.5x.
 *
 * ENVELOPE — a tool call is not its payload. One `click({elementId:5})` and its
 * result cost ~52 tokens before a single character of either, and a pair whose
 * name, arguments and content are all empty still costs 47. That is the price
 * of MAKING A CALL, and no amount of terser tool output removes it. It is the
 * real argument for batching: six clicks in one turn rather than six turns.
 *
 * The `toolu_` id inside that envelope is FREE — `t1`, the real 26-character
 * id, and a 64-character id all count identically, so the API canonicalises the
 * field rather than tokenizing it. Do not shorten ids to save tokens; there is
 * nothing there to save.
 *
 * tool_use and tool_result cannot be priced apart: the API rejects an assistant
 * tool_use without its matching result in the very next message, so the pair is
 * the smallest measurable unit. The 52 is split by where the bytes visibly are
 * — the call carries a name and arguments, the result carries only content.
 *
 * CHARS_PER_TOKEN — measured on this repo's own blocks:
 *   system prompt (prose) ....... 3.26
 *   tool schemas (JSON) ......... 3.02
 *   page-state tail (elements) .. 1.96
 *   tool result lines ........... 2.00
 * Structured text is roughly twice as dense as prose, which is why a single
 * ratio for everything cannot work. These are still only used to divide a
 * region between its blocks — the region's TOTAL comes from the API.
 */
const ENVELOPE: Record<AnatomyBlock["kind"], number> = {
  text: 4,
  tool_use: 30,
  tool_result: 22,
};

/**
 * A request is charged a little framing that belongs to no block — message
 * scaffolding, not content. When a run freezes its whole prompt that residue is
 * all that is left outside the cache: measured at 3 tokens on the ladder
 * recordings. At or under this, it is overhead, not a block we failed to draw.
 */
const FRAMING_ONLY = 32;

/**
 * Smallest output gap worth drawing as thinking rather than absorbing as
 * estimator error. A turn that did no thinking still won't match to the token.
 */
const THINKING_FLOOR = 40;

/**
 * The tool-use preamble: instruction text the API adds to the prompt whenever a
 * request declares tools, which no block of ours contains.
 *
 * It is real, it is billed, and until now it was the one part of the request the
 * anatomy pane could not show, because the pane draws what this client sends and
 * this is not sent — it is added on the way in. count_tokens counts it; the
 * messages array has no trace of it.
 *
 * Placement, measured: a cache_control on the SYSTEM block does not cover it, a
 * breakpoint on the first user message does. So it sits between them.
 *
 * Size, measured as what a system-block breakpoint leaves billed as fresh, with
 * one tool declared and the same one-token message:
 *
 *   claude-haiku-4-5 .... 317
 *   claude-opus-4-8 ......  70
 *   claude-opus-5 ........  70
 *
 * It does not grow with the tool count (1, 4 and 12 tools all leave exactly the
 * same amount outside the line) — the schemas are separate, and they ARE inside
 * the cached prefix. Note the shape of those numbers: the cheap model carries
 * the expensive preamble, 4.5x the Opus one, paid on every request that does not
 * cache it.
 *
 * What it says: asked to quote the text preceding the conversation, Opus 4.8
 * returns a block opening "In this environment you have access to a set of
 * tools you can use to answer the user's question", describing the invocation
 * syntax. That is a self-report and would be worth nothing on its own — but the
 * quote measures 77 tokens against a preamble measured independently at 70, so
 * it is the right text and about the right length.
 */
const TOOL_PREAMBLE_BY_MODEL: Array<[RegExp, number]> = [
  [/haiku/i, 317],
  [/opus|sonnet/i, 70],
];
const TOOL_PREAMBLE_DEFAULT = 70;

function preambleTokens(model: string | undefined): number {
  if (!model) return TOOL_PREAMBLE_DEFAULT;
  for (const [re, n] of TOOL_PREAMBLE_BY_MODEL) if (re.test(model)) return n;
  return TOOL_PREAMBLE_DEFAULT;
}

const CHARS_PER_TOKEN: Record<AnatomyBlock["kind"], number> = {
  text: 3.0,
  tool_use: 2.5,
  tool_result: 2.0,
};

function estimateTokens(kind: AnatomyBlock["kind"], contentChars: number): number {
  return ENVELOPE[kind] + Math.max(1, Math.round(contentChars / CHARS_PER_TOKEN[kind]));
}

/**
 * Scale a region's block estimates so they sum to what the API actually
 * charged for that region. The estimator gets the SHAPE right (which block
 * dominates) but not the total; the recorded usage is the total and is not
 * negotiable. Reconciling means the block stack and the "actual usage" footer
 * can never disagree — before this, the stack summed to 131 tokens on a request
 * whose cache write was 585.
 *
 * Returns false when there is nothing to reconcile against, leaving estimates.
 */
function reconcile(
  blocks: AnatomyBlock[],
  recorded: number | undefined,
  audit: RegionAudit[],
  region: Region,
): boolean {
  if (recorded === undefined || recorded <= 0 || blocks.length === 0) return false;
  const est = blocks.reduce((a, b) => a + b.tokens, 0);
  if (est <= 0) return false;
  audit.push({ region, estimate: est, recorded, blocks: blocks.length });
  const k = recorded / est;
  let running = 0;
  blocks.forEach((b, i) => {
    // Last block absorbs the rounding drift, so the sum is exact rather than
    // exact-ish. A token chart that is off by three is a chart nobody trusts.
    b.tokens = i === blocks.length - 1 ? recorded - running : Math.max(1, Math.round(b.tokens * k));
    b.exact = true;
    running += b.tokens;
  });
  return true;
}

export function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * The block as it is actually sent: envelope, ids and all. The anatomy pane
 * shows `body` because it is readable, but a reader asking "what is going into
 * the model" deserves the literal answer, and the token count must be taken
 * over THIS, not over the payload alone.
 */
function wireOf(b: ContentBlock): string {
  switch (b.type) {
    case "text":
      return JSON.stringify({ type: "text", text: b.text }, null, 2);
    case "tool_use":
      return JSON.stringify({ type: "tool_use", id: b.id, name: b.name, input: b.input }, null, 2);
    case "tool_result":
      return JSON.stringify(
        { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) },
        null,
        2,
      );
  }
}

function bodyOf(b: ContentBlock): string {
  switch (b.type) {
    case "text":
      return b.text;
    case "tool_use":
      return `${b.name}(${JSON.stringify(b.input, null, 2)})`;
    case "tool_result":
      return b.content;
  }
}

/**
 * Authored traces (comparison mocks, non-agent structures) can name a block by
 * starting its text with a [[label]] line. Real traces never contain the
 * marker, so this is inert for live runs.
 */
const LABEL_MARKER = /^\[\[(.{1,80}?)\]\]\n?/;
function extractLabel(body: string): { label?: string; body: string } {
  const m = LABEL_MARKER.exec(body);
  if (!m || m[1] === undefined) return { body };
  return { label: m[1], body: body.slice(m[0].length) };
}

/**
 * Cache-region rules for request N (turns 0..N-1 closed, breakpoint on the
 * last block of turn N-1; the system block always carries a breakpoint):
 *
 *   N = 0: system+tools are WRITTEN (first breakpoint); the goal message sits
 *          after the breakpoint → fresh.
 *   N = 1: system+tools are READ (request 0 wrote them); goal + turn 0 are
 *          WRITTEN (request 0's breakpoint didn't cover them).
 *   N ≥ 2: system+tools+goal+turns 0..N-2 are READ; turn N-1 is WRITTEN.
 */
function regionRules(turnIndex: number, cacheAtEnd: boolean, goalCached: boolean): {
  statics: Region;
  goal: Region;
  turn: (t: number) => Region;
} {
  if (turnIndex === 0) {
    return {
      statics: "cache-write",
      // With a breakpoint of its own the goal is inside request 0's frozen
      // prefix, along with the API's preamble above it. Without one it sits
      // past the only line and is sent raw. Measured on sess_mtyqcsi4_1: the
      // volatile tail counts 768 tokens and request 0 was billed 765 fresh, so
      // everything above the tail was written — nothing else was outside.
      goal: goalCached ? "cache-write" : "fresh",
      turn: () => "fresh",
    };
  }
  // "Cache everything" (cacheAt: "end") puts the breakpoint on the last block,
  // so request N-1 froze its ENTIRE prompt — including the goal, which the
  // default shape leaves outside the first breakpoint. Everything that was in
  // the previous request therefore reads from cache; only what this turn added
  // is written.
  if (cacheAtEnd) {
    if (turnIndex === 0) {
      return { statics: "cache-write", goal: "cache-write", turn: () => "cache-write" };
    }
    return {
      statics: "cached",
      goal: "cached",
      turn: (t) => (t === turnIndex - 1 ? "cache-write" : "cached"),
    };
  }
  return {
    statics: "cached",
    // With a breakpoint of its own, the goal was frozen by request 0 along with
    // the statics, so it reads from cache on turn 1 like everything above it.
    // Without one it sits past the only breakpoint and is written on turn 1.
    goal: goalCached ? "cached" : turnIndex === 1 ? "cache-write" : "cached",
    turn: (t) => (t === turnIndex - 1 ? "cache-write" : "cached"),
  };
}

export function requestAnatomy(session: Session, turnIndex: number): RequestAnatomy {
  // The request for turn N is built over the turns closed before it — the
  // exact call the loop makes, over a prefix of the same session.
  const prior: Session = { ...session, turns: session.turns.slice(0, turnIndex) };
  // `state` is this turn's frozen state — recorded on the turn, sent as the
  // trailing message. Passing it here is what makes the drawn request the sent
  // request for a freezeState run; without it the page copies are invisible.
  const stateAt = session.turns[turnIndex]?.stateAt;
  const messages = buildMessages(prior, stateAt !== undefined ? { state: stateAt } : {});
  const rules = regionRules(
    turnIndex,
    session.contextShape?.cacheAt === "end",
    session.contextShape?.goalCache === true,
  );

  const blocks: AnatomyBlock[] = [];

  // Wire order is tools → system → messages. The system block's breakpoint
  // covers the tool schemas ahead of it — one line freezes both.
  // json-in-text sends NO tools parameter — the catalogue is prose inside the
  // system prompt instead. session.tools is still recorded (the mode reads the
  // schema back off it to bind arguments), but drawing it here would show a
  // block the request never carried, and would invent a tool preamble to go
  // with it. The request is what this pane draws.
  //
  // The same argument rules out an EMPTY tools block. A chatbot declares no
  // tools, so nothing about tools is on its wire — and because block tokens are
  // scaled to the region's recorded total, a block drawn for `[]` does not cost
  // nothing: it takes a share of the statics the system prompt actually paid
  // for (24 of them, on the RAG recording). Same guard the preamble below uses.
  const nativeTools = session.contextShape?.toolProtocol !== "json-in-text";
  const toolCount = session.tools?.length ?? 0;
  const toolsBody = JSON.stringify(nativeTools ? (session.tools ?? []) : [], null, 2);
  if (nativeTools && toolCount > 0) blocks.push({
    id: "tools",
    label: `tool schemas (${toolCount})`,
    role: "tools",
    region: rules.statics,
    breakpoint: false,
    chars: toolsBody.length,
    body: toolsBody,
    kind: "text",
    wire: toolsBody,
    tokens: estimateTokens("text", toolsBody.length),
    exact: false,
  });
  const systemBody = session.system ?? "(system prompt not recorded in this trace)";
  blocks.push({
    id: "system",
    label: "system prompt",
    role: "system",
    region: rules.statics,
    breakpoint: true,
    chars: systemBody.length,
    body: systemBody,
    kind: "text",
    wire: systemBody,
    tokens: estimateTokens("text", systemBody.length),
    exact: false,
  });

  // The API's own tool-use instructions, drawn between the system block and the
  // goal because that is where they land. Not ours, not in `messages`, and the
  // reason a system-block cache line leaves tokens billed fresh every turn.
  if (nativeTools && toolCount > 0) {
    const n = preambleTokens(session.turns[turnIndex]?.usage?.model);
    blocks.push({
      id: "preamble",
      label: "tool-use preamble · added by the API",
      role: "system",
      // Same segment as the goal: it sits directly above it, so whatever
      // breakpoint covers the goal covers this too — and when only the system
      // block carries one, both are outside it.
      region: rules.goal,
      breakpoint: false,
      chars: 0,
      tokens: n,
      exact: false,
      kind: "text",
      body:
        "Declaring tools makes the API add its own instructions to the prompt, " +
        "describing how to invoke them. They are not in any block this client " +
        "sends — count_tokens counts them, the messages array has no trace of " +
        "them — which is why this pane could not show them until now.\n\n" +
        `Measured at ${n} tokens for this model: 317 on Haiku 4.5, 70 on Opus ` +
        "4.8 and Opus 5, and the same whether one tool is declared or twelve.\n\n" +
        "A cache_control on the system block does NOT cover this, so with only " +
        "that breakpoint it is billed fresh on every single request. A " +
        "breakpoint on the goal message does cover it.",
      wire: "(injected by the API — not sent by this client)",
    });
  }

  // Authored comparison traces (e.g. the RAG chatbot mock) can declare that
  // their architecture has no goal message at all — a chatbot's prompt is
  // system → chat, nothing else. Real traces never set this.
  const hideGoal = session.presentation?.hideGoal === true;
  // A chatbot's turn boundary is offset from an agent's: user message in,
  // answer out. Encoded in a Turn, the NEXT user message lands in toolResults,
  // so it must not be numbered or titled as this turn's output.
  //
  // It is still DRAWN here, under its own heading. Hiding it made the retrieval
  // invisible until the turn after — the one moment in the deck where a reader
  // is meant to watch chunks being fetched, and the pane showed an answer
  // appearing from nowhere. An agent's tool results and a chatbot's retrieval
  // are the same kind of thing in this pane: bytes the system produced outside
  // the model, which the next request has to carry.
  const resultsAreNextInput = session.presentation?.resultsAreNextInput === true;

  let turnOfBlock = -1; // increments when an assistant message begins
  messages.forEach((msg, mi) => {
    if (msg.role === "assistant") turnOfBlock += 1;
    const isGoal = mi === 0;
    if (isGoal && hideGoal) return;

    msg.content.forEach((b, bi) => {
      const extracted = extractLabel(bodyOf(b));
      const body = extracted.body;
      let label: string;
      let frozenRegion: Region | undefined;
      // Which request does this block belong to? For an agent, a turn's tool
      // results are that turn's own output, so `turnOfBlock` is right. When the
      // trace says its results are the NEXT request's input, they belong to the
      // turn after — otherwise the newest user message reads as "turn 1" while
      // sitting in the request for turn 2, which is exactly one off.
      const isResultSlot = msg.role === "user" && !isGoal;
      const at = isResultSlot && resultsAreNextInput ? turnOfBlock + 1 : turnOfBlock;
      if (isGoal) {
        label = "goal";
      } else if (b.type === "text" && body.startsWith(FROZEN_STATE_PREFIX)) {
        // Self-describing: the block says which turn's world it holds, so both
        // the label and the cache region come from the wire text rather than
        // from the block's position. A frozen state block sits BEFORE the
        // assistant message it answered, so the turn-level rule above would
        // mark the newest one as freshly written when it was frozen a turn ago.
        const frozenAt = Number(body.slice(FROZEN_STATE_PREFIX.length).split(")")[0]);
        label = `page state · turn ${frozenAt} — frozen into history`;
        if (!Number.isNaN(frozenAt) && turnIndex > 0) {
          frozenRegion = frozenAt < turnIndex ? "cached" : "cache-write";
        }
      } else if (b.type === "text") {
        label = `turn ${at} · ${extracted.label ?? "thought"}`;
      } else if (b.type === "tool_use") {
        label = `turn ${at} · ${b.name}()`;
      } else {
        label = `turn ${at} · ${extracted.label ?? "tool result"}`;
      }

      blocks.push({
        id: `${mi}.${bi}`,
        label,
        role: isGoal ? "user" : msg.role,
        region: frozenRegion ?? (isGoal ? rules.goal : rules.turn(turnOfBlock)),
        breakpoint: (b as { cache?: boolean }).cache === true,
        chars: body.length,
        body,
        kind: b.type,
        wire: wireOf(b),
        tokens: estimateTokens(b.type, body.length),
        exact: false,
        ...(b.type === "tool_result" && b.isError ? { isError: true } : {}),
      });
    });
  });

  // Provisional: the authored breakpoint. Recomputed below once the recorded
  // usage has had its say about where the frozen part actually ended.
  let cacheLineAt = blocks.findLastIndex((b) => b.breakpoint);

  // Volatile tail (critic feedback / steering) — recorded on the turn itself,
  // sent AFTER the breakpoint. Rendered below the cache line, exactly where it
  // sat on the wire: the Solo observations pattern, visible.
  const turn = session.turns[turnIndex];
  if (turn?.tail) {
    const body = turn.tail;
    blocks.push({
      id: "tail",
      label: "current state + steering · replaced every turn",
      role: "user",
      region: "fresh",
      breakpoint: false,
      chars: body.length,
      body,
      kind: "text",
      wire: body,
      tokens: estimateTokens("text", body.length),
      exact: false,
    });
  }

  // --- the response: what the model sent back this turn, then its results ---
  const response: AnatomyBlock[] = [];
  if (turn) {
    turn.assistantBlocks.forEach((b, i) => {
      if (b.type === "text") {
        const ex = extractLabel(b.text);
        response.push({
          id: `r.a${i}`,
          label: ex.label ?? "thought",
          role: "assistant",
          region: "response",
          breakpoint: false,
          chars: ex.body.length,
          body: ex.body,
          kind: "text",
          wire: wireOf(b),
          tokens: estimateTokens("text", ex.body.length),
          exact: false,
        });
      } else if (b.type === "tool_use") {
        const body = `${b.name}(${JSON.stringify(b.input, null, 2)})`;
        response.push({
          id: `r.a${i}`,
          label: `${b.name}()`,
          role: "assistant",
          region: "response",
          breakpoint: false,
          chars: body.length,
          body,
          kind: "tool_use",
          wire: wireOf(b),
          tokens: estimateTokens("tool_use", body.length),
          exact: false,
        });
      }
    });
    turn.toolResults.forEach((b, i) => {
      if (b.type === "tool_result") {
        const ex = extractLabel(b.content);
        response.push({
          id: `r.t${i}`,
          label: ex.label ?? "tool result",
          role: "user",
          region: "result",
          breakpoint: false,
          chars: ex.body.length,
          body: ex.body,
          kind: "tool_result",
          wire: wireOf(b),
          tokens: estimateTokens("tool_result", ex.body.length),
          exact: false,
          ...(b.isError ? { isError: true } : {}),
        });
      }
    });
  }

  // --- make the drawing agree with the invoice ---
  const usage = turn?.closed ? turn.usage : undefined;

  // Regions FIRST. regionRules() describes what the request ASKED for: a
  // breakpoint on the system block, history frozen behind it. Whether any of it
  // cached is a different question, and the API answered it.
  //
  // Cache boundaries always fall BETWEEN blocks — cache_control is a property of
  // a block, so a prefix can never end halfway through one. That makes the rules
  // right about WHERE the cuts are and only ever wrong about whether a cut
  // happened at all, which is the three contradictions corrected here. Cutting
  // positionally from the recorded totals instead sounds more principled and is
  // worse: the ruler would be the local estimate, so a region smaller than the
  // estimator's error silently loses every block it owns.
  if (usage) {
    const read = usage.cacheReadTokens ?? 0;
    const write = usage.cacheWriteTokens ?? 0;
    const fresh = usage.inputTokens ?? 0;
    for (const b of blocks) {
      const rulesSayFrozen = b.region === "cached" || b.region === "cache-write";
      if (rulesSayFrozen) {
        // Nothing cached: a run whose eligible prefix sits under the model's
        // minimum (examples/floor-check.ts) reports read 0, write 0 and is
        // billed entirely as fresh input — while the rules would cheerfully
        // draw its system prompt in "cached · read" blue. That is the failure
        // the deck spends a slide on, drawn wrong by the tool meant to show it.
        if (read === 0 && write === 0) b.region = "fresh";
        // Read but never written: the prefix was already warm when this run
        // began. Every ladder rung shares a system prompt and a tool surface,
        // so rung 2 onward opens on a cache rung 1 paid for — turn 0 reads
        // 5,168 tokens it never wrote. The rules cannot know that. The
        // invoice does, and it is also the honest picture of a rung: the
        // comparison between rungs is not paying for those tokens twice.
        else if (read > 0 && write === 0) b.region = "cached";
        else if (read === 0 && write > 0) b.region = "cache-write";
        // Both nonzero: the rules' own split between read and write is right.
      } else if (b.region === "fresh" && fresh <= FRAMING_ONLY && read + write > 0) {
        // Everything cached — what `cacheAt: "end"` asks for. Only per-request
        // framing is left outside the prefix, so a block drawn as fresh against
        // a 3-token fresh bill was frozen, not sent raw.
        b.region = write > 0 ? "cache-write" : "cached";
      }
    }
  }

  // Thinking is output that leaves no block behind.
  //
  // The model is billed for every token it generates, and extended thinking is
  // generated — but it is not sent back on the next request, so nothing in the
  // recorded turn holds it. On an accuracy turn whose only visible output is
  // `click({elementId: 2})`, 27 characters, the API charged 144 output tokens.
  // The missing ~100 is where the model did its reasoning.
  //
  // Drawing it as a block is the honest rendering, and it happens to be the
  // clearest picture in the pane of what accuracy mode actually buys: a column
  // of thinking the audience can see, paid for once and never re-read.
  if (usage?.outputTokens) {
    const drawn = response
      .filter((b) => b.role === "assistant")
      .reduce((a, b) => a + b.tokens, 0);
    const residual = usage.outputTokens - drawn;
    // Only when the gap is too big to be estimator slop. Below this the
    // reconciliation below absorbs it, which is the right answer for a turn
    // that did no thinking at all.
    if (residual > Math.max(THINKING_FLOOR, usage.outputTokens * 0.25)) {
      response.unshift({
        id: "r.think",
        kind: "text",
        label: "thinking · billed as output, never sent back",
        role: "assistant",
        region: "response",
        breakpoint: false,
        chars: 0,
        body:
          "Not recorded, because it is never resent: extended thinking is billed " +
          "as output and then dropped from the conversation. This block is the " +
          "difference between the output tokens the API charged for this turn " +
          "and the blocks it left behind.",
        wire: "(not on the wire — generated, billed, and discarded)",
        tokens: residual,
        exact: true,
      });
    }
  }

  const lastFrozen = blocks.findLastIndex((b) => b.region === "cached" || b.region === "cache-write");
  if (usage && lastFrozen >= 0) cacheLineAt = lastFrozen;
  // Asked for above, honoured by nothing: the breakpoint is still drawn where
  // the wire put it, but the caption over it has to stop claiming a frozen
  // prefix. Only decidable with an invoice in hand.
  const cacheLineDeclined = usage !== undefined && lastFrozen < 0 && cacheLineAt >= 0;

  const byRegion = (r: Region): AnatomyBlock[] => blocks.filter((b) => b.region === r);
  const audit: RegionAudit[] = [];
  const reconciled =
    [
      reconcile(byRegion("cached"), usage?.cacheReadTokens, audit, "cached"),
      reconcile(byRegion("cache-write"), usage?.cacheWriteTokens, audit, "cache-write"),
      reconcile(byRegion("fresh"), usage?.inputTokens, audit, "fresh"),
      // Output is what the MODEL generated — the assistant's blocks, nothing
      // else. The tool results drawn beneath them in this pane were produced by
      // the environment; they cost nothing here and are charged on the NEXT
      // request, where they arrive as cache write. Scaling them to
      // output_tokens was how this pane came to show a turn "outputting" 318
      // tokens that then froze as 585.
      reconcile(
        response.filter((b) => b.role === "assistant"),
        usage?.outputTokens,
        audit,
        "response",
      ),
    ].filter(Boolean).length > 0;

  const result: RequestAnatomy = {
    turnIndex,
    blocks,
    cacheLineAt,
    cacheLineDeclined,
    response,
    responsePending: !!turn && !turn.closed,
    resultsAreNextInput,
    reconciled,
    audit,
  };
  if (turn) result.turn = turn;
  return result;
}
