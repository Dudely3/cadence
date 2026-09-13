# The trick is code that calls the model again

This is the part people miss about harnesses. The intelligence is in the model.
The **reliability** is in ordinary, deterministic code deciding when to invoke
it — and with what.

Every one of these is a plain `if` statement, not a prompt:

- **The loop itself** — "there were tool calls, so go around again"
- **The critic** — a *second* call, on the same turn, whose only job is to judge
  the first. Forced tool choice, so it cannot decline to answer.
- **The planner** — one call up front whose output becomes cached prefix
- **The dependency gate** — `update_plan` returns an error the model must read
  and react to
- **The failure budget** — after N failures, steer to completion
- **The step cap** — running out of turns is a distinct outcome, not success

None of that is the model being clever. It is a program choosing to re-trigger
the model, with a slightly different context each time, until a condition holds.

> **So the design space is bigger than prompting.** Anywhere you can write a
> condition, you can add a model call — or refuse one. A critic is just "call
> it again and ask if that was right." Be creative: the harness is where the
> engineering lives.
