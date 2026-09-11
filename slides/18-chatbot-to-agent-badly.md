---
sessions: sess_mtpzblz6_1
---

# Turning a chatbot into an agent, badly

The obvious way, and the one most first attempts land on:

- The page? **Send the DOM.** All of it, tags and all.
- History? **Keep everything.** Append each turn's page state to the
  conversation and never remove it.
- Caching? **Cache it all.** Put the breakpoint at the very end.

Nothing here is stupid. Each choice is the conservative one — don't drop
anything, don't lose anything, cache everything.

**By turn 2 the model is reading two copies of the same catalogue**, one of
them out of date, and you are paying to send both.

And note what *isn't* the problem: **the cache works fine.** An append-only
prefix is exactly what caching likes, and the trace beside this slide proves
it — the whole two-turn run is billed **six fresh tokens**, with 71,286 read
back from cache. The problem is what you chose to put in it.

> The tell is not an error. It is a run that still works, gets bigger every
> turn, and occasionally acts on a stale snapshot because it had two to choose
> from.
