---
sessions: sess_mtyqcsi4_1
---

# A string, or a list of parts

Every field that carries text takes either form. They are not equally capable.

```js
// shorthand: one implicit text block
{ role: "user", content: "Empty the cart" }

// the same message, spelled out
{ role: "user", content: [
  { type: "text", text: "Empty the cart" },
] }
```

`system` is the same story: a bare string, or a list of text blocks.

**What only the list can do**

- Hold **more than one part** — assembled from different places, in an order
  you control, and diffable one part at a time.
- Hold parts that are not text: `tool_use`, `tool_result`, images, documents.
- Carry `cache_control` — a property **of a block**. There is also a
  *top-level* `cache_control` that will cache a string-shaped request for you,
  so the honest version is narrower than "strings cannot cache": it picks the
  boundary itself, always the last eligible block, walking backward in silence
  if that one will not take it. **A string can be cached. It cannot be aimed.**

Aiming is the whole talk. The line goes on the goal rather than the last system
block, because the API appends its own text after yours. It moves forward every
turn, because the lookback is twenty positions and a turn spends two. The page
has to land on the far side of it, or the prefix changes every request. Not one
of those is a choice you have until the prompt is a list of parts.

> Cadence has no string form at all: `Message.content` is typed
> `ContentBlock[]`, always — see `packages/core/src/types.ts`. The pane beside
> this slide **is** that array, one row per block.
