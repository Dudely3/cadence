---
sessions: sess_mtyqcsi4_1
---

# A string, or a list of blocks

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

- Hold **more than one block** — assembled from different places, in an order
  you control, and diffable one block at a time.
- Hold blocks that are not text: `tool_use`, `tool_result`, images, documents.
- Carry `cache_control` — a property **of a block**. There is also a
  *top-level* `cache_control` that will cache a string-shaped request for you,
  up to the last eligible block. **A string can be cached. It cannot be aimed.**

Where that line goes is two slides away. What matters here is that only a
block can carry one.

> Cadence has no string form at all: `Message.content` is typed
> `ContentBlock[]`, always — see `packages/core/src/types.ts`. The pane beside
> this slide **is** that array, one row per block.
