---
sessions: example-rag-chatbot.json, sess_mtyqcsi4_1
---

# Three vintages of the same document

Slide 2 said someone has to decide what goes in the prompt, and that most teams
never decide deliberately. **This is what not deciding looks like.**

`messages.append(retrieved)` is the default in most chat frameworks, and it
looks defensible: retrieval goes into the conversation, the conversation is the
context, nothing is thrown away.

## Walk it, don't assert it

Both recordings are bound here. Open the chatbot and scrub turn 0 → 3.

- **Turn 0 is *system only*** — no goal, no state. Append-only starts clean,
  which is exactly why it survives review.
- **The request grows downward and nothing ever leaves.** By turn 3 it carries
  **three** sets of retrieved chunks. The cache is *fine* with that — it
  appended — so turn 3 reads 1,582 tokens back and writes only the 653 that
  message 3 added. Turns 0 and 1 cache *nothing*: the prompt is under the
  minimum, and the pane says so on the line itself — the floor you just saw,
  turning up in a chatbot.
- **Click the turn-2 and turn-3 chunk blocks.** One says `[api-keys §2]` came
  back *again* with a different score and different neighbours: same fact, new
  bytes, new position, paid for twice. The other says the rotation chunk fell
  **out of the window entirely** — the model can no longer see text it cited
  two answers ago, while both stale copies are still in the prompt.

**Nothing errored. The cache behaved perfectly.** The model is simply holding
three versions of one document and has to guess which one is current.

## This is a choice, not an architecture

| | **append it** | **re-render it** |
| --- | --- | --- |
| Frozen history | every retrieval, forever | brief outcome log |
| Current truth | newest chunks beside stale ones | one block, replaced each turn |
| Prefix | caches beautifully, grows forever | byte-stable, bounded |
| Being wrong | pays twice, answers off a stale copy | re-reads the world |

**Both columns are available to a chatbot.** Retrieved text can go past the
cache line and be replaced every turn, exactly the way the agent beside it
replaces its state block — that is a line in your prompt builder, not a change
of framework. Switch to the agent chip and scrub: same mechanism, other column.

> Honest caveat: the chatbot recording is **hand-written**, not a captured run —
> this repo has no RAG stack. It illustrates a mechanism; it is not evidence
> about how often real systems do this, and I am not going to pretend it is.
> The agent recordings beside it are real, and that asymmetry is worth saying
> out loud.
