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
// what comes back: text, and nothing else
'{"reasoning": "…", "action": ["click(2)"]}'
```

Both recordings beside this slide are the **same goal, same page, same model,
same tools.** Only the protocol differs.

| | native | json-in-text |
| --- | --- | --- |
| tool schemas sent | 14 | **0** |
| tool-use preamble | 317 tok | **0** |
| system prompt | 14,533 ch | **17,374 ch** |
| output | 344 | **681** |
| **cost** | **$0.01098** | **$0.01105** |

**It works, and it is not expensive.** Across **24 runs and 48 model calls**:
24 completed, every cart correct, and **zero replies that failed to parse.**
Cost lands within 25% of native in either direction depending on the task —
dearer on one goal here, cheaper on the other.

The tool descriptions move out of the `tools` parameter and into the system
prompt, where they cache exactly as well, and the API's preamble is skipped
entirely. It pays that back in **output**, because the model now writes the
protocol itself.

**So where did the fragility go?** Not where the story says. In 48 calls the
model never produced JSON we could not read. Every failure came from *fuzzing
our own parser*, and each one was silent — `type_text(3, 'Hello, world')`,
where a splitter that knows only `"` cuts the string in half and drops the rest
into a property nothing reads. It does not throw. It does not warn. The run
continues with the wrong argument.

> The old protocol did not stay broken — the models got good at it. What is left
> is a harness that must keep growing tolerance for every shape the model
> invents, where each gap is a silent wrong answer rather than an error. That is
> what the `tools` parameter buys: not reliability, **loudness**.
>
> **And that is everything you control.** The blocks, the cache line, the page,
> even the protocol the tools travel in — every byte of it is yours to place.
> The rest of this talk is about how much of it you should hand back.
