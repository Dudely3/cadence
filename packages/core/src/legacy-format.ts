/**
 * The pre-native-tool-use wire format, in one file.
 *
 * Before providers shipped a `tools` parameter, an agent described its tools in
 * prose inside the system prompt and asked the model to reply with JSON. The
 * model emitted one text blob; the harness parsed it and dispatched. Production
 * systems ran this way for years and many still do.
 *
 * Keeping it here, runnable and measured, is the point: the difference between
 * the two protocols is easy to assert and much more interesting to demonstrate.
 * Everything here is DELIBERATELY faithful to the old shape, including the parts
 * that are bad — positional arguments, no schema, and a parse step that can fail
 * on output the model considered perfectly reasonable.
 *
 * See traces/example-solo-legacy.json for the authored version of this shape.
 */
import type { ToolDef } from "./tool";
import type { Turn } from "./turn";

/** One call the model asked for, recovered from text. */
export interface LegacyCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LegacyParse {
  /** The model's narration — `reasoning`, plus whatever state it reported. */
  thought: string;
  calls: LegacyCall[];
  /** Set when the blob could not be read. The whole turn is lost with it. */
  error?: string;
}

/**
 * Property names of a tool's schema, in declaration order.
 *
 * This ordering IS the calling convention: the catalogue prints
 * `click(elementId)` and the model answers `click(5)`, so argument 0 binds to
 * property 0. Nothing checks that the model agreed with us about the order,
 * which is the first guarantee this protocol gives up.
 */
function paramNames(def: ToolDef): string[] {
  const props = def.inputSchema["properties"];
  if (!props || typeof props !== "object") return [];
  return Object.keys(props as Record<string, unknown>);
}

/**
 * The tool catalogue, as prose for the system prompt.
 *
 * The `tools` parameter is never sent in this protocol, so this text is the ONLY
 * thing telling the model what it may call. It also means the API adds no
 * tool-use preamble — measured at 317 tokens on Haiku 4.5 — so the legacy shape
 * genuinely saves that and pays for this instead. Which is bigger is a
 * measurement, not an assumption.
 */
export function renderToolCatalogue(tools: ToolDef[]): string {
  const lines = tools.map((t) => `- ${t.name}(${paramNames(t).join(", ")}) — ${t.description}`);
  return [
    "You MUST respond with a single valid JSON object and NOTHING else — no",
    "prose, no markdown fences. The required format is:",
    '{"current_state": {"page_summary": "...", "evaluation": "...", "next_goal": "..."},',
    ' "reasoning": "...", "action": ["toolName(args)", ...]}',
    "",
    "Available tools (call by writing the string into the action array):",
    ...lines,
    "",
    "Arguments are POSITIONAL and JSON-encoded: strings quoted, numbers bare.",
    "Put one or more calls in `action`. Output ONLY the JSON object — invalid",
    "JSON aborts the turn.",
  ].join("\n");
}

/**
 * A closed turn, re-serialised into history as text.
 *
 * Native tool use sends `tool_result` blocks the API pairs to their calls by id.
 * This protocol has no ids and no pairing, so the harness writes its own account
 * of what happened and appends it as an ordinary user message. That account is a
 * PARAPHRASE — the model never sees the raw result, only what the harness chose
 * to say about it, which is the second guarantee given up.
 */
export function renderLegacyTurnResult(turn: Turn): string {
  const lines = turn.toolResults.map((b, i) => {
    const call = turn.actions[i];
    const args = call ? Object.values(call.args ?? {}).map((v) => JSON.stringify(v)).join(", ") : "";
    const label = call ? `${call.tool}(${args})` : "action";
    const failed = b.type === "tool_result" && b.isError;
    const body = b.type === "tool_result" ? b.content : "";
    return `  ${label} -> [${failed ? "FAILED" : "ok"}] ${body}`;
  });
  return [`Turn ${turn.index} result:`, ...lines].join("\n");
}

/** Split on commas that are not inside a JSON string or a nested structure. */
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let cur = "";
  for (const ch of raw) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      cur += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (!inStr && (ch === "[" || ch === "{")) depth += 1;
    if (!inStr && (ch === "]" || ch === "}")) depth -= 1;
    if (!inStr && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((s) => s.trim());
}

const CALL_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/;
const WRAPPING_QUOTES = /^['"]|['"]$/g;

/** `click(5)` / `type_text(3, "hello")` -> a call, bound positionally. */
function parseCall(expr: string, tools: ToolDef[]): LegacyCall | { error: string } {
  const m = CALL_RE.exec(expr);
  const name = m?.[1];
  const argText = m?.[2];
  if (name === undefined || argText === undefined) {
    return { error: `not a call expression: ${JSON.stringify(expr.slice(0, 60))}` };
  }
  const def = tools.find((t) => t.name === name);
  // An unknown tool is NOT rejected here. The loop already turns one into an
  // error observation the model can read, and short-circuiting that would hand
  // this protocol a safety check it does not actually have.
  const names = def ? paramNames(def) : [];
  const input: Record<string, unknown> = {};
  splitArgs(argText).forEach((raw, i) => {
    const key = names[i] ?? `arg${i}`;
    try {
      input[key] = JSON.parse(raw) as unknown;
    } catch {
      // An unquoted string, which models emit constantly. Take it literally:
      // the alternative is losing the turn over a missing pair of quotes.
      input[key] = raw.replace(WRAPPING_QUOTES, "");
    }
  });
  return { name, input };
}

/**
 * Recover calls from one text reply.
 *
 * Tolerant on purpose, because a strict reader would make this protocol look
 * worse than it is and the comparison has to be fair: markdown fences are
 * stripped, and the JSON object is located inside surrounding prose rather than
 * the reply being required to contain nothing else.
 */
export function parseLegacyReply(text: string, tools: ToolDef[]): LegacyParse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { thought: text.trim(), calls: [], error: "no JSON object in the reply" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    return { thought: text.trim(), calls: [], error: `invalid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { thought: text.trim(), calls: [], error: "JSON was not an object" };
  }

  const obj = parsed as Record<string, unknown>;
  const state = obj["current_state"];
  const nextGoal =
    state && typeof state === "object"
      ? String((state as Record<string, unknown>)["next_goal"] ?? "")
      : "";
  const thought = [
    typeof obj["reasoning"] === "string" ? obj["reasoning"] : "",
    nextGoal ? `next_goal: ${nextGoal}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = obj["action"];
  if (!Array.isArray(raw)) {
    return { thought, calls: [], error: "`action` was missing or not an array" };
  }

  const calls: LegacyCall[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return { thought, calls, error: `action entry was ${typeof entry}, expected a string` };
    }
    const one = parseCall(entry, tools);
    if ("error" in one) return { thought, calls, error: one.error };
    calls.push(one);
  }
  return { thought, calls };
}
