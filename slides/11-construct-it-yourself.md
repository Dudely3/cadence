---
sessions: sess_mu8mwrh4_1, sess_mu8mpk8w_1, sess_mu8mp8r9_1
run.label: run the old protocol live
run.script: examples/browse.ts
run.args: --mode legacy-lean
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
'{"action":["click(2)"]}'
```

Both recordings beside this slide are the **same goal, same page, same model,
same tools.** Only the protocol differs.

| | native | json-in-text |
| --- | --- | --- |
| tool schemas sent | 14 | **0** |
| tool-use preamble | 317 tok | **0** |
| prompt tokens sent | 12,789 | **9,963** |
| output | 362 | **276** |
| **cost** | $0.00471 | **$0.00396** |

*Three runs each, every one warm-started, so the cache state matches and the
only difference left is the protocol.*

**It is not a compromise. It wins on all three.** Fewer prompt tokens, fewer
output tokens, 16% cheaper — and **zero replies that failed to parse**, across
24 runs and 48 model calls of the old schema plus every run of this one.

The tool descriptions move out of the `tools` parameter and into the system
prompt, where they cache exactly as well, and the API's preamble is skipped
entirely.

## The schema costs more than the protocol

That table is not what this comparison usually shows, and the reason is worth
the slide. The schema these harnesses actually used asks for this, every turn,
pretty-printed:

```js
{"current_state": {
   "page_summary": "…",
   "evaluation": "…",
   "next_goal": "…"},
 "reasoning": "…",
 "action": ["click(2)"]}
```

Four fields restating a page **that is already in the prompt**, after the model
has said the same thing in prose above them. Same goal, same page, same model,
same three warm runs:

| json-in-text schema | output | cost |
| --- | --- | --- |
| the old one, in full | 586 | $0.00573 |
| prose, then `{"action":[…]}` | **276** | **$0.00396** |

**The ceremony is 310 output tokens a run, and output bills at roughly five
times cached input.** That one schema choice is the difference between the old
protocol costing 22% *more* than native and 16% *less* — on the same protocol,
the same parser, and the same positional binding.

Everyone measures the protocol. The protocol was never the expensive part.

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
