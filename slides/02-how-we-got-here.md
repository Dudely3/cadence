---
sessions: example-rag-chatbot.json
---

# How we got here

A chatbot loop and an agent loop look alike. They are not.

- **Chatbot** — the conversation *is* the context. The user writes half of it;
  you append the rest.
- **RAG** — we started injecting retrieved text. The context became something
  we *assemble*, not something we receive.
- **Tools** — the model stopped only answering and started *acting*. Now the
  context has to carry state, results, and what to do next.

The moment retrieval arrived, someone had to decide what goes in the prompt,
in what order, and what gets dropped. That decision never went away — most
teams just never made it deliberately.

> **The thesis:** an agentic loop differs from a chatbot loop in *who owns the
> context*. In an agent, the context is a constructed artifact — you decide
> every byte, every turn.
