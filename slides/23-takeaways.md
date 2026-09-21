# What to take home

**Construction beats review.** If a fact is re-observable, building the prompt
so it is always fresh costs nothing and prevents the bug. Paying a second model
to check the first costs 9–16× and catches it *sometimes*. Buy review where the
risk is in the **decision** — where the thing you need was never in the request
at all.

An agent's context is a **constructed artifact**: every byte a decision you
made, on purpose or by accident. Everything below is how you build the prompt
that makes that first paragraph true.

## Caching is a prefix match on bytes

- **Append, never merge.** Rewriting one block to tidy up throws away
  everything behind it. The fix for a long turn is another breakpoint, never
  fewer blocks.
- **Volatile content goes past the last line.** Current state is re-rendered
  every turn and never frozen into history.
- **Move the line, and mind the floor.** The lookback is 20 *messages* and an
  agent turn is two, so a breakpoint set once dies after ten turns. Below the
  model's minimum cacheable prefix nothing caches at all — and good context
  construction walks straight into it.
- **The model reads the shape, not just the text.** Handed history frozen and
  state volatile, Haiku wrote its own ledger into assistant text and stopped
  re-opening the page. Build the prompt well and the model will use it.

## The model reads text

- **Markup was never for the model.** 76,000 tokens to 17,000, same answer.
- **Don't ship the page — let it look.** A small window and a search tool beat
  handing over the document.

## The engineering is in the harness

- **Record what a thing *was*, not where it was.** Store the identity and the
  recording replays on a page that moved; store the id and it replays once.
- **Reliability is ordinary code deciding when to call the model again.**
  Anywhere you can write a condition, you can add a model call — or refuse one.
- **Buy accuracy where the risk is in the decision.** Re-observable facts are
  construction's job. A hidden *path* is where a planner earns its money.

> **5,815,730 tokens · 642 model calls · $7.94.** That is every recording
> committed to this repo, at list prices — the whole evidence base for the last
> forty minutes, for the price of a sandwich.
>
> Every number in this talk came off a run whose trace is in `traces/`, and the
> checks that keep them honest are free: clone it and `npm run check` — no key,
> no network.
>
> **github.com/Dudely3/cadence** · Addison Rennick
