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

Both recordings are bound to this slide. Open the chatbot first.

1. **Turn 0** — the request is *system only*. No goal, no state: a chatbot's
   prompt is system → chat and nothing else. The response is the greeting —
   and under it, *"then the system composed the next input"*: the user's
   question and the chunks the retriever pulled for it, ~600 tokens the model
   had no part in writing and the next request has to carry.
2. **Scrub → turn 1.** Its request ends with `turn 1 · user message 1` and
   `turn 1 · retrieved chunks`, and the ❄ sits on the chunks. Blocks are
   numbered by the request they belong to, so message *n* is turn *n*.
3. **→ turn 2, → turn 3.** Watch the request grow *downward*. Nothing ever
   leaves. By turn 3 the prompt carries **three** sets of retrieved chunks.
4. **Click the turn-2 chunk block.** Its own header says it:
   *"[api-keys §2] came back AGAIN, with a different score and different
   neighbors — same fact, new bytes, new position."* The same document, paid
   for twice, and now in the prompt twice — note the cache is *fine* with
   that: it appended, so turn 2 reads 2,610 tokens back and writes 1,620.
5. **Click the turn-3 chunk block.** *"The rotation chunk fell OUT of the window
   entirely. The model can no longer see text it cited two answers ago."*
   Two stale copies are still in the prompt. The current one is gone.

Then switch to the agent chip and scrub the same way: history stays a short
outcome log, and the state block **is replaced**, not appended.

> The model in the chat is holding three vintages of the same document and has
> to guess which is current. The agent is holding one, and it is always now.
>
> One honest caveat: the chatbot recording is **hand-written**, not a captured
> run — this repo has no RAG stack. Say so. The agent recordings beside it are
> real, and that asymmetry is the point of admitting it.
