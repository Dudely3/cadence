import { buildMessages } from "@cadence/core";
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
  /** Not part of the request: what came BACK this turn (and its tool results). */
  | "response";

export const REGION_LABEL: Record<Region, string> = {
  cached: "cached · read",
  "cache-write": "freezing · cache write",
  fresh: "fresh · after the cache line",
  response: "response · this turn's output",
};

export interface AnatomyBlock {
  id: string;
  /** Short label for the block chip, e.g. "turn 2 · append_line()". */
  label: string;
  role: "tools" | "system" | "user" | "assistant";
  region: Region;
  /** This block carries cache_control on the wire. */
  breakpoint: boolean;
  chars: number;
  /** Raw content for the detail panel. */
  body: string;
  isError?: boolean;
}

export interface RequestAnatomy {
  turnIndex: number;
  blocks: AnatomyBlock[];
  /** Index into `blocks` of the last breakpoint (the cache line). -1 if none. */
  cacheLineAt: number;
  /** What came back this turn: thought + tool calls, then their results. */
  response: AnatomyBlock[];
  /** True while the turn exists but hasn't closed (live, in flight). */
  responsePending: boolean;
  /** The turn this request produced, if it exists yet. */
  turn?: Turn;
}

export function approxTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}

export function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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
function regionRules(turnIndex: number): {
  statics: Region;
  goal: Region;
  turn: (t: number) => Region;
} {
  if (turnIndex === 0) {
    return { statics: "cache-write", goal: "fresh", turn: () => "fresh" };
  }
  return {
    statics: "cached",
    goal: turnIndex === 1 ? "cache-write" : "cached",
    turn: (t) => (t === turnIndex - 1 ? "cache-write" : "cached"),
  };
}

export function requestAnatomy(session: Session, turnIndex: number): RequestAnatomy {
  // The request for turn N is built over the turns closed before it — the
  // exact call the loop makes, over a prefix of the same session.
  const prior: Session = { ...session, turns: session.turns.slice(0, turnIndex) };
  const messages = buildMessages(prior);
  const rules = regionRules(turnIndex);

  const blocks: AnatomyBlock[] = [];

  // Wire order is tools → system → messages. The system block's breakpoint
  // covers the tool schemas ahead of it — one line freezes both.
  const toolsBody = JSON.stringify(session.tools ?? [], null, 2);
  blocks.push({
    id: "tools",
    label: `tool schemas (${session.tools?.length ?? 0})`,
    role: "tools",
    region: rules.statics,
    breakpoint: false,
    chars: toolsBody.length,
    body: toolsBody,
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
  });

  // Authored comparison traces (e.g. the RAG chatbot mock) can declare that
  // their architecture has no goal message at all — a chatbot's prompt is
  // system → chat, nothing else. Real traces never set this.
  const hideGoal =
    (session as { presentation?: { hideGoal?: boolean } }).presentation?.hideGoal === true;

  let turnOfBlock = -1; // increments when an assistant message begins
  messages.forEach((msg, mi) => {
    if (msg.role === "assistant") turnOfBlock += 1;
    const isGoal = mi === 0;
    if (isGoal && hideGoal) return;

    msg.content.forEach((b, bi) => {
      const extracted = extractLabel(bodyOf(b));
      const body = extracted.body;
      let label: string;
      if (isGoal) {
        label = "goal";
      } else if (b.type === "text") {
        label = `turn ${turnOfBlock} · ${extracted.label ?? "thought"}`;
      } else if (b.type === "tool_use") {
        label = `turn ${turnOfBlock} · ${b.name}()`;
      } else {
        label = `turn ${turnOfBlock} · ${extracted.label ?? "tool result"}`;
      }

      blocks.push({
        id: `${mi}.${bi}`,
        label,
        role: isGoal ? "user" : msg.role,
        region: isGoal ? rules.goal : rules.turn(turnOfBlock),
        breakpoint: (b as { cache?: boolean }).cache === true,
        chars: body.length,
        body,
        ...(b.type === "tool_result" && b.isError ? { isError: true } : {}),
      });
    });
  });

  const cacheLineAt = blocks.findLastIndex((b) => b.breakpoint);

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
          region: "response",
          breakpoint: false,
          chars: ex.body.length,
          body: ex.body,
          ...(b.isError ? { isError: true } : {}),
        });
      }
    });
  }

  const result: RequestAnatomy = {
    turnIndex,
    blocks,
    cacheLineAt,
    response,
    responsePending: !!turn && !turn.closed,
  };
  if (turn) result.turn = turn;
  return result;
}
