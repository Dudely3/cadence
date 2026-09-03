# Two shapes of context

| | **Agent** (state replaced per turn) | **RAG chatbot** |
| --- | --- | --- |
| Frozen history | brief action/result log, byte-stable | chat turns + **stale** retrieved chunks |
| Volatile tail | current state, after the cache line | fresh chunks land mid-prompt |
| Prefix stability | block order is load-bearing | recompiled per request |

The agent freezes only *brief outcomes* into history. The full current state is
re-observed every turn and rides the tail — replaced, never appended.

> Receipt: `traces/example-rag-chatbot.json`. Open it in **☰ sessions** and watch
> the retrieved chunks move position between turns. Every one of those moves
> invalidates the cache from that point on.
