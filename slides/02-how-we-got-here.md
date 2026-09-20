---
sessions: example-chatbot.json
---

# How we got here

A chatbot loop and an agent loop look alike. They are not.

- **Chatbot** — the conversation *is* the context. The user writes half of it,
  you append the rest, and nobody decides anything. Open the recording beside
  this slide: system prompt, then messages, growing downward. That is the
  whole shape, and it is the one this viewer was built to draw.
- **Agent** — the model stopped only answering and started *acting*. Now the
  context has to carry state, results, and what to do next — and every byte
  of it is something a program put there.

Somewhere in that move, someone had to decide what goes in the prompt, in
what order, and what gets dropped. Most teams never made that decision
deliberately.

> **The thesis:** in an agent, the context is a constructed artifact — you
> decide every byte, every turn. Which means most reliability problems are
> *shape* problems, and **a second opinion is the expensive way to fix
> something the shape already prevents.**
>
> That is not the talk I set out to give. It is the one the measurements kept
> insisting on.
