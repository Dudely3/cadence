# What to take home

An agent's context is a **constructed artifact**. Every byte in it is a
decision you made, on purpose or by accident.

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

## The model reads text

- **Markup was never for the model.** 76,000 tokens to 17,000, same answer.
- **Don't ship the page — let it look.** A small window and a search tool beat
  handing over the document.

## The engineering is in the harness

- **Record what a thing *was*, not where it was.** Store the identity and the
  recording replays on a page that moved; store the id and it replays once.
- **Reliability is ordinary code deciding when to call the model again.**
  Anywhere you can write a condition, you can add a model call — or refuse one.
- **Buy accuracy where the risk is in the decision.** If the fact is
  re-observable, construction already prevented the bug review would catch.

> Every number in this talk came out of a run in this repo, and none of them
> are typed into a slide by hand. Clone it and `npm run check` — free, no key,
> no network.
>
> **github.com/Dudely3/cadence** · Addison Rennick
