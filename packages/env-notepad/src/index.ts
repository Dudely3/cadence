import { z } from "zod";
import type { Environment, Observation, Tool } from "@cadence/core";

/**
 * A trivial in-memory environment: a shared text notepad. The original spike.
 * Proves the full perceive → decide → act → observe loop with real tool use and
 * zero external dependencies. Swapping this for BrowserEnv / StrudelEnv later
 * changes nothing in the loop — that's the thesis.
 */
export class NotepadEnv implements Environment {
  name = "notepad";
  private lines: string[] = [];

  async observe(): Promise<Observation> {
    const body = this.lines.length ? this.lines.map((l, i) => `${i + 1}. ${l}`).join("\n") : "(empty)";
    return { summary: `Notepad contents:\n${body}`, raw: { lines: [...this.lines] } };
  }

  systemHint(): string {
    return "A shared text notepad. Add one line at a time with append_line. The notepad's current contents appear in the CURRENT STATE block each turn. When the goal is met, call complete with an appropriate status.";
  }

  availableTools(): Tool[] {
    // No terminator here — the core `complete` tool is registered by the
    // harness (see completionTool), so environments never define their own.
    return [this.readTool(), this.appendTool()];
  }

  async reset(): Promise<void> {
    this.lines = [];
  }

  private readTool(): Tool<Record<string, never>> {
    return {
      name: "read_notepad",
      description: "Read the current contents of the notepad.",
      schema: z.object({}),
      execute: async () => ({ ok: true, observation: await this.observe() }),
    };
  }

  private appendTool(): Tool<{ line: string }> {
    return {
      name: "append_line",
      description: "Append a single line of text to the notepad.",
      schema: z.object({ line: z.string().describe("The line of text to append.") }),
      execute: async (_env, args) => {
        this.lines.push(args.line);
        // Brief outcome only — current contents ride the fresh state tail.
        return {
          ok: true,
          observation: { summary: `Appended line ${this.lines.length}: ${JSON.stringify(args.line)}` },
        };
      },
    };
  }

}
