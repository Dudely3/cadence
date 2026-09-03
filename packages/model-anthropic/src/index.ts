import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  Message,
  ModelClient,
  ModelRequest,
  ModelResult,
  ToolUse,
} from "@cadence/core";

/** Translate one neutral message to the Anthropic wire format. */
function toApiMessage(m: Message): Anthropic.MessageParam {
  const content = m.content.map((b): Anthropic.ContentBlockParam => {
    switch (b.type) {
      case "text":
        return {
          type: "text",
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
        };
      case "tool_use":
        return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: b.toolUseId,
          content: b.content,
          ...(b.isError ? { is_error: true } : {}),
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
        };
    }
  });
  return { role: m.role, content };
}

/**
 * Default model client. The only Anthropic-aware code in the harness — swapping
 * this out for another provider is the whole point of the ModelClient seam.
 */
export class AnthropicModelClient implements ModelClient {
  private client: Anthropic;

  constructor(opts: { apiKey?: string; workspaceId?: string } = {}) {
    // Identity-linked API keys (the kind an org issues to a person rather than
    // to a project) must name the workspace each request acts in, or the API
    // rejects them with a 400. Org-issued plain keys don't need this at all.
    const workspaceId = opts.workspaceId ?? process.env["ANTHROPIC_WORKSPACE_ID"];
    // SDK reads ANTHROPIC_API_KEY from env when apiKey is omitted.
    this.client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
    });
  }

  async decide(req: ModelRequest): Promise<ModelResult> {
    // Typed loosely: thinking/output_config shapes vary by SDK version, and we
    // only ever send the fields the API documents for these models.
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages.map(toApiMessage),
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    };

    if (req.system) {
      params["system"] = [
        { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      ];
    }
    if (req.thinking === "adaptive") params["thinking"] = { type: "adaptive" };
    // NOTE: effort is unsupported on Haiku — callers must omit it there.
    if (req.effort) params["output_config"] = { effort: req.effort };
    if (req.toolChoice) params["tool_choice"] = req.toolChoice;

    let res: Anthropic.Message;
    try {
      res = (await this.client.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )) as Anthropic.Message;
    } catch (err) {
      // This one 400 is worth translating: the raw message names a header, not
      // a fix, and it lands mid-demo when a key turns out to be identity-linked.
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes("anthropic-workspace-id")) {
        throw new Error(
          "Your API key is identity-linked, so every request must name a workspace. " +
            "Add ANTHROPIC_WORKSPACE_ID=<workspace id> to .env — find it in the Anthropic " +
            "Console under Settings → Workspaces (the id in the workspace's URL). " +
            `Original error: ${text}`,
        );
      }
      throw err;
    }

    let thought = "";
    const toolUses: ToolUse[] = [];
    const assistantBlocks: ContentBlock[] = [];

    for (const block of res.content) {
      if (block.type === "text") {
        thought += block.text;
        assistantBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        toolUses.push({ id: block.id, name: block.name, input });
        assistantBlocks.push({ type: "tool_use", id: block.id, name: block.name, input });
      }
    }

    return {
      thought,
      toolUses,
      assistantBlocks,
      stopReason: res.stop_reason,
      usage: {
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? undefined,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? undefined,
      },
    };
  }
}
