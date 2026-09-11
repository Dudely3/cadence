/**
 * Why isn't this run caching?
 *
 *   npm run floor                    every recording in traces/
 *   npx tsx examples/floor-check.ts sess_abc_1 sess_def_2
 *
 * Answers it by measuring the CACHED PREFIX — everything up to and including
 * the block that carries cache_control — against the model's minimum
 * cacheable prefix. Almost every "the cache isn't working" turns out to be
 * this: the prompt is plenty big, but the part that is ELIGIBLE to cache is
 * under the floor, because good context construction deliberately keeps the
 * bulk outside it.
 *
 * count_tokens, not chars/4: the floor is a hard threshold, and an estimate
 * landing on the wrong side of it answers the question backwards.
 *
 * Costs nothing but a token count per trace — no completions.
 */
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import { buildMessages, type Session } from "@cadence/core";
import fs from "node:fs";

const client = new Anthropic({
  ...(process.env["ANTHROPIC_WORKSPACE_ID"]
    ? { defaultHeaders: { "anthropic-workspace-id": process.env["ANTHROPIC_WORKSPACE_ID"] } }
    : {}),
});

// Haiku 4.5's floor. Opus 4.8 is 1024, Opus 5 is 512 — the floor is
// model-dependent and NOT monotonic with model size.
const FLOOR = 4096;

const named = process.argv.slice(2).map((n) => n.replace(/\.json$/, ""));
const names =
  named.length > 0
    ? named
    : fs
        .readdirSync("traces")
        .filter((f) => f.startsWith("sess_") && f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();

for (const name of names) {
  const raw = JSON.parse(fs.readFileSync(`traces/${name}.json`, "utf8")) as { session: Session };
  const session = raw.session;
  const last = session.turns.length - 1;
  const prior: Session = { ...session, turns: session.turns.slice(0, last) };
  const tailText = session.turns[last]?.tail;
  const stateText = session.turns[last]?.stateAt;
  const messages = buildMessages(prior, {
    ...(tailText !== undefined ? { tail: tailText } : {}),
    ...(stateText !== undefined ? { state: stateText } : {}),
  });

  // Everything up to and including the block carrying cache_control.
  const flat = messages.flatMap((m) => m.content.map((b) => ({ role: m.role, b })));
  const bpAt = flat.findLastIndex((x) => (x.b as { cache?: boolean }).cache === true);
  const prefix = bpAt === -1 ? [] : flat.slice(0, bpAt + 1);
  const rest = bpAt === -1 ? flat : flat.slice(bpAt + 1);

  const asText = (xs: typeof flat): string =>
    xs
      .map((x) => {
        const b = x.b as { type: string; text?: string; content?: string; input?: unknown };
        return b.text ?? b.content ?? JSON.stringify(b.input ?? {});
      })
      .join("\n");

  const countOf = async (text: string): Promise<number> => {
    if (!text.trim()) return 0;
    const res = await client.messages.countTokens({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: text }],
    });
    return res.input_tokens;
  };

  // The system prompt and tool schemas sit ahead of the messages on the wire
  // and are covered by the first breakpoint, so they count toward the prefix.
  const staticsTokens = await countOf(
    `${session.system ?? ""}\n${JSON.stringify(session.tools ?? [])}`,
  );
  const prefixTokens = staticsTokens + (await countOf(asText(prefix)));
  const restTokens = await countOf(asText(rest));

  console.log(`\n${name} — ${session.goal.id} (${session.turns.length} turns)`);
  console.log(`  breakpoint after block ${bpAt + 1} of ${flat.length}`);
  console.log(`  statics (system + ${(session.tools ?? []).length} tools): ${staticsTokens} tok`);
  // A prefix that clears the floor by 40 tokens is not a working cache, it is a
  // coin flip: a reworded goal or a trimmed system prompt drops it back under,
  // silently. Say so while there is still time to fix it.
  const margin = prefixTokens - FLOOR;
  const verdict =
    margin < 0
      ? `✗ UNDER the ${FLOOR} floor by ${-margin}`
      : margin < 500
        ? `⚠ over the ${FLOOR} floor by only ${margin} — thin`
        : `✓ over the ${FLOOR} floor by ${margin}`;
  console.log(`  CACHED PREFIX: ${prefixTokens} tok  ${verdict}`);
  console.log(`  past the line (never cached): ${restTokens} tok`);
  const u = session.turns[last]?.usage;
  console.log(`  recorded on that turn: in ${u?.inputTokens} read ${u?.cacheReadTokens ?? 0} write ${u?.cacheWriteTokens ?? 0}`);
}
