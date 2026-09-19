# A harness is code that decides when to call the model

The intelligence is in the model. The **reliability** is in ordinary,
deterministic code deciding when to invoke it — and with what.

Everything left in this talk is one of these decisions. None of them is a
prompt:

- **What does it see this turn?** Something has to turn a page into tokens.
- **How much of it?** All of it, a window of it, or a tool that fetches more.
- **What gets kept?** A turn's outcome freezes into history forever. Current
  state is replaced. Choosing which is which is the whole of the last act.
- **Do we go around again?** "There were tool calls" is a plain `if`.
- **Do we check the answer?** A critic is just *call it again and ask whether
  that was right.*
- **When do we stop?** A step cap and a failure budget are two more `if`s, and
  running out of turns is a distinct outcome, not a success.

None of that is the model being clever. It is a program choosing to re-trigger
the model, with a slightly different context each time, until a condition
holds.

> **So the design space is bigger than prompting.** Anywhere you can write a
> condition, you can add a model call — or refuse one.
>
> **And *refuse one* is the underrated half.** Every lever here spends a call
> to check something. The same code decides what goes in the request in the
> first place — and a fact rendered fresh every turn needs no second opinion at
> all. The cheapest call in the harness is the one you designed away.
