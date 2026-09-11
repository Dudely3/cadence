---
sessions: sess_mtks1qz8_1
run.label: run the demo live
run.step: true
run.headed: true
run.note: Haiku on the local shop page, stepped — about a cent
---

# You can construct the context yourself

Nothing forces you to use the provider's message helpers. The wire format is
just JSON you assemble.

**What you give up**

- Schema validation on tool arguments
- Automatic pairing of `tool_use` → `tool_result`
- Errors when the two get out of sync

**What you gain**

- Byte-level control of the prefix — which is what makes caching work
- Freedom to place state exactly where you want it
- A prompt you can serialize, diff, and replay

> This whole framework takes the second path on purpose: every request is
> rendered from one `Session` object, so the trace *is* the context.
