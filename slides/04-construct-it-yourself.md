---
sessions: sess_mtyqcsi4_1, sess_mtzwj1jx_1
run.label: run the old protocol live
run.script: examples/browse.ts
run.args: --mode legacy
run.step: true
run.headed: true
run.viewport: 940x820
run.note: Haiku on the local shop page, json-in-text tool calls — about a cent
---

# You can construct the context yourself

Nothing forces you to use the provider's tool parameter. Agents worked for years
before it existed, and plenty still do it this way: **describe the tools in
prose, ask for JSON back, parse it yourself.**

```js
// the system prompt, not a tools parameter
"- click(elementId) — Click an element by id."
// what the model sends back: text
'{"reasoning": "…", "action": ["click(2)"]}'
```

Both recordings beside this slide are the **same goal, same page, same model,
same tools**. Only the protocol differs.

| | native | json-in-text |
| --- | --- | --- |
| turns | 2 | 2 |
| cache read | 5,521 | 4,154 |
| output | 344 | **681** |
| system prompt | 14,533 ch | **17,374 ch** |
| **cost** | **$0.01098** | **$0.01105** |

**Six tenths of one percent apart.** The old protocol is not expensive. It moves
the tool descriptions out of the `tools` parameter and into the system prompt,
where they cache just as well — and it skips the preamble the API injects, which
is 317 tokens on Haiku. What it pays back is **output**: twice as many tokens,
because the model now writes the protocol itself, and output is the dear one.

**What it actually gives up isn't money.**

- Nothing validates the arguments. `click(2)` binds position 0 to the first
  property in the schema, and nobody checks the model agreed about the order.
- Nothing pairs a call to its result. The harness writes its own **paraphrase**
  of what happened into history — the model never sees what the tool returned.
- A reply can be *unparseable*, which native tool use cannot be. That is a whole
  failure class you now own.

> Open both in ☰ sessions. In the native run the pane shows a tool-schemas
> block, a tool-use preamble and a `click()` block. In the old one those are
> gone — there is one enormous system prompt and two blocks of text. The
> protocol hasn't moved, it has dissolved into prose.
