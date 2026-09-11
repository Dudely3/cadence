---
sessions: sess_mtks1qz8_1
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
- Carry `cache_control` — which is a property **of a block**. A string has no
  blocks, so *a string has nowhere to put a cache line.*

That last line is why this slide exists. Everything after it in this talk —
prefixes, breakpoints, the floor, the whole cost argument — is unavailable to
you until the prompt is a list of parts.

> Cadence has no string form at all: `Message.content` is typed
> `ContentBlock[]`, always — see `packages/core/src/types.ts`. The pane beside
> this slide **is** that array, one row per block.
