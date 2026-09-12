---
sessions: sess_mtyqcsi4_1
---

# Putting the lines in

A breakpoint is one property on one block. There is no separate caching API.

The obvious place is the last system block. **It is the wrong one** — and the
pane shows why: declaring tools makes the API add its own instruction text
*after* your system prompt, where a line on that block cannot reach it.

```js
// the goal message: the last thing in the
// prompt that cannot change during a run
{
  role: "user",
  content: [{
    type: "text",
    text: `Goal: ${goal}`,
    cache_control: { type: "ephemeral" },
  }],
}
```

The second one goes on the **last block of the newest turn**, so the whole
conversation so far sits inside the prefix and only this turn's bytes are fresh:

```js
const last = blocks.at(-1);
last.cache_control = { type: "ephemeral" };
```

- That preamble is **317 tokens on Haiku 4.5, 70 on Opus** — the same whether
  you declare one tool or twelve, and billed fresh on every request that leaves
  it outside the line. The cheap model carries the expensive one.
- You get **four** breakpoints. Spend them on boundaries that do not move.
- Each one caches its own prefix; the longest that still matches is what you
  read back. That is why the older, shorter lines are worth keeping.
- A block does not need marking to be cached — only to be a *boundary*.

> Cadence never writes `cache_control` by hand. A block sets `cache: true` and
> the client translates it (`packages/model-anthropic/src/index.ts`), and
> *which* block gets it is data on the session — `contextShape.goalCache` and
> `cacheAt: "last-turn" | "end"` — so the ❄ you see in the pane is the line
> that was actually sent, not a drawing of one.
>
> `npm run cachelab` puts both placements against the real API and prints what
> came back.
