---
sessions: example-rag-chatbot.json, sess_mtyqcsi4_1
---

# Two shapes of context

| | **RAG chatbot** | **Agent** |
| --- | --- | --- |
| Frozen history | chat turns **+ every retrieval, forever** | brief action/result log |
| Current truth | newest chunks, mid-prompt, alongside stale ones | one state block, replaced each turn |
| Prefix stability | append-only — it caches fine, and grows forever | byte-stable; block order is load-bearing |
| Ending | it stops | it **calls** something |

## Walk it, don't assert it

Both recordings are bound here. Open the chatbot and scrub turn 0 → 3.

- **Turn 0 is *system only*** — no goal, no state. A chatbot's prompt is system
  then chat, and nothing else.
- **The request grows downward and nothing ever leaves.** By turn 3 it carries
  **three** sets of retrieved chunks. The cache is *fine* with that — it
  appended — so turn 3 reads 1,582 tokens back and writes only the 653 that
  message 3 added. Turns 0 and 1 cache *nothing*: the prompt is under the
  minimum, and the pane says so on the line itself. The floor slide, early.
- **Click the turn-2 and turn-3 chunk blocks.** One says `[api-keys §2]` came
  back *again* with a different score and different neighbours: same fact, new
  bytes, new position, paid for twice. The other says the rotation chunk fell
  **out of the window entirely** — the model can no longer see text it cited
  two answers ago, while both stale copies are still in the prompt.

Then switch to the agent chip and scrub the same way: history stays a short
outcome log, and the state block **is replaced**, not appended.

> The chat is holding three vintages of the same document and has to guess which
> is current. The agent is holding one, and it is always now.
>
> Honest caveat: the chatbot recording is **hand-written**, not a captured run —
> this repo has no RAG stack. Say so. The agent recordings beside it are real,
> and that asymmetry is the point of admitting it.
