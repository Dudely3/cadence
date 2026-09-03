import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ActionResult, RunContext } from "./types";
import type { Environment } from "./environment";

/** Serialized tool definition handed to the model. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A typed tool. The model only ever emits validated calls: args are parsed
 * against `schema` before `execute` runs.
 */
export interface Tool<A = unknown> {
  name: string;
  description: string;
  schema: ZodType<A>;
  execute(env: Environment, args: A, ctx: RunContext): Promise<ActionResult>;
}

export class ToolRegistry {
  private byName = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.byName.set(t.name, t);
  }

  /**
   * Add a tool after construction. Modes use this in prepare() to bring their
   * own bookkeeping tools (accuracy's update_plan) — registration happens
   * before the trace freezes its static parts, so session.tools includes them.
   */
  register(tool: Tool): void {
    this.byName.set(tool.name, tool);
  }

  list(): Tool[] {
    return [...this.byName.values()];
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  /** Serialize to the model's tool format, deriving JSON Schema from each zod schema. */
  toModelSchema(): ToolDef[] {
    return this.list().map((t) => {
      const schema = zodToJsonSchema(t.schema, { target: "jsonSchema7" }) as Record<string, unknown>;
      delete schema["$schema"];
      return { name: t.name, description: t.description, inputSchema: schema };
    });
  }
}
