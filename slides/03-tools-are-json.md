# Tool use is JSON recognition

A "tool call" is not a special model capability. It is the model emitting
structured text that reliably parses.

- Early agents did this by **prompting for JSON** and parsing the reply.
- Native tool use is the same trick with a guaranteed schema and a typed
  round-trip — the provider validates the shape for you.
- You can still do it by hand. You lose the automatic validation and the
  dependency checks on tool calls; you gain total control of the bytes.

> Receipt: `traces/example-solo-legacy.json` — a production run from Solo,
> where tools and results were hand-constructed as text inside the prompt.
> Same loop shape, no tool API.
