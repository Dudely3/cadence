import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import type { ActionResult, Environment, Observation, Tool } from "@cadence/core";

/**
 * StrudelEnv — a live-coding EDM engine behind the SAME Environment interface
 * as the notepad and the browser. The loop cannot tell the difference; that is
 * the keystone of the talk's thesis.
 *
 * Substrate: Strudel is WebAudio-based, so it's hosted in a Playwright page
 * (examples/site/strudel.html + a VENDORED bundle — no CDN at showtime). The
 * env owns the musical state: a map of named layers plus a tempo, recompiled
 * into one `stack(...)` program and re-evaluated on every change. Audio plays
 * from the page; run HEADED to hear it.
 *
 * The model reasons over STRUCTURE (it can't hear): observe() reports tempo,
 * the layer table, engine status, and whether drum samples are available
 * (they need the network; synths are fully offline — the model adapts).
 *
 * Strudel evaluation errors (bad mini-notation, unknown sound) come back as
 * error tool results and the failed change is ROLLED BACK — the model
 * self-corrects through the same feedback path the drill proves.
 */

interface CadenceStatus {
  ready: boolean;
  samplesLoaded: boolean;
  playing: boolean;
  currentCode: string;
  lastError: string | null;
}

export interface StrudelEnvOptions {
  /** URL of the hosted stage page (file:// works). Required. */
  pageUrl: string;
  /** Default true. HEADED (false) to actually hear it. */
  headless?: boolean;
  /** Starting tempo in BPM (4 beats per cycle). Default 120. */
  bpm?: number;
}

export class StrudelEnv implements Environment {
  name = "strudel";
  private browser: Browser | undefined;
  private page: Page | undefined;
  private layers = new Map<string, string>();
  private bpm: number;
  private playing = false;

  constructor(private readonly opts: StrudelEnvOptions) {
    this.bpm = opts.bpm ?? 120;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? true,
      // WebAudio must start without a user gesture — the agent never clicks.
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    this.page = await this.browser.newPage({ viewport: { width: 1100, height: 700 } });
    // tsx/esbuild keepNames decorates evaluate callbacks with __name.
    await this.page.addInitScript("window.__name = (fn) => fn;");
    await this.page.goto(this.opts.pageUrl, { waitUntil: "load" });
    await this.page.waitForFunction("window.cadence && window.cadence.state.ready", null, {
      timeout: 15_000,
    });
    // Give drum-sample loading a bounded window so the first observation
    // doesn't wrongly steer the model to synths-only. Offline, this times out
    // quietly and the observation says so.
    await this.page
      .waitForFunction("window.cadence.state.samplesLoaded === true", null, { timeout: 8_000 })
      .catch(() => undefined);
    return this.page;
  }

  private async status(): Promise<CadenceStatus> {
    const page = await this.ensurePage();
    return page.evaluate("window.cadence.status()") as Promise<CadenceStatus>;
  }

  /** Compile the layer map into one Strudel program. */
  private compile(): string | null {
    if (this.layers.size === 0) return null;
    const body = [...this.layers.entries()]
      .map(([name, code]) => `  // ${name}\n  ${code}`)
      .join(",\n");
    return `setcpm(${this.bpm}/4)\nstack(\n${body}\n)`;
  }

  /** Re-evaluate the current program in the page. */
  private async apply(): Promise<{ ok: boolean; error?: string }> {
    const program = this.compile();
    if (program === null) {
      const page = await this.ensurePage();
      await page.evaluate("window.cadence.stop()");
      this.playing = false;
      return { ok: true };
    }
    return this.applyProgram(program);
  }

  private async applyProgram(program: string): Promise<{ ok: boolean; error?: string }> {
    const page = await this.ensurePage();
    const result = (await page.evaluate(
      (code: string) => (window as unknown as { cadence: { apply(c: string): Promise<{ ok: boolean; error?: string }> } }).cadence.apply(code),
      program,
    )) as { ok: boolean; error?: string };
    this.playing = result.ok;
    return result;
  }

  async observe(): Promise<Observation> {
    const status = await this.status();
    const layerLines =
      this.layers.size === 0
        ? "(none)"
        : [...this.layers.entries()].map(([n, c]) => `- ${n}: ${c}`).join("\n");
    const palette = status.samplesLoaded
      ? "drum samples LOADED — s(\"bd\"), s(\"hh\"), s(\"sd\"), s(\"cp\") etc. available"
      : "drum samples UNAVAILABLE (offline) — use synths only: note(...).s(\"sawtooth\"|\"square\"|\"triangle\"|\"sine\")";
    return {
      summary:
        `Engine: ${status.playing ? "▶ playing" : "■ silent"} · tempo ${this.bpm} BPM · ${palette}` +
        (status.lastError ? `\nLast engine error: ${status.lastError}` : "") +
        `\n\nLayers (${this.layers.size}):\n${layerLines}` +
        (status.currentCode ? `\n\nCurrent program:\n${status.currentCode}` : ""),
      raw: { bpm: this.bpm, layers: Object.fromEntries(this.layers), status },
    };
  }

  systemHint(): string {
    return [
      "A Strudel live-coding music engine. You compose by managing named LAYERS; the harness stacks all layers into one program and plays it immediately after every change.",
      "Each layer is ONE Strudel pattern expression. Mini-notation crash course: s(\"bd*4\") = kick on every beat; s(\"~ hh ~ hh\") or s(\"hh*8\").gain(0.4) = hats; note(\"c2 eb2 g2 bb2\").s(\"sawtooth\").lpf(600) = synth bassline; ~ = rest, * = repeat, [a b] = subdivide, <a b> = alternate per cycle.",
      "Keep gains balanced (.gain(0.3)-(0.9)). If a change is rejected with an engine error, fix the pattern syntax and try again.",
      "You cannot hear the output — reason from the structure in CURRENT STATE. When the goal's structure is complete, call complete.",
    ].join(" ");
  }

  availableTools(): Tool[] {
    return [this.setTempoTool(), this.setLayerTool(), this.removeLayerTool(), this.silenceTool()];
  }

  async dispose(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  // --- tools -----------------------------------------------------------------

  private setTempoTool(): Tool<{ bpm: number }> {
    return {
      name: "set_tempo",
      description: "Set the tempo in BPM (4 beats per cycle). Re-applies the current program.",
      schema: z.object({ bpm: z.number().int().min(40).max(220) }),
      execute: async (_env, args): Promise<ActionResult> => {
        const prev = this.bpm;
        this.bpm = args.bpm;
        const result = await this.apply();
        if (!result.ok) {
          this.bpm = prev;
          return {
            ok: false,
            error: result.error ?? "engine rejected the program",
            observation: { summary: `Tempo change rejected: ${result.error}` },
          };
        }
        return { ok: true, observation: { summary: `Tempo set to ${args.bpm} BPM.` } };
      },
    };
  }

  private setLayerTool(): Tool<{ name: string; code: string }> {
    return {
      name: "set_layer",
      description:
        "Add or replace a named layer with a Strudel pattern expression, then re-apply the whole program. Example codes: s(\"bd*4\") · s(\"hh*8\").gain(0.4) · note(\"c2 eb2 g2 bb2\").s(\"sawtooth\").lpf(600)",
      schema: z.object({
        name: z.string().min(1).max(24).describe("Layer name, e.g. kick, hats, bass, lead."),
        code: z.string().min(1).describe("One Strudel pattern expression (no trailing semicolon)."),
      }),
      execute: async (_env, args): Promise<ActionResult> => {
        const prev = this.layers.get(args.name);
        this.layers.set(args.name, args.code.trim());
        const result = await this.apply();
        if (!result.ok) {
          // Roll back — a broken layer must not stick.
          if (prev === undefined) this.layers.delete(args.name);
          else this.layers.set(args.name, prev);
          await this.apply();
          return {
            ok: false,
            error: result.error ?? "engine rejected the pattern",
            observation: {
              summary: `Layer "${args.name}" rejected by the engine: ${result.error}. The previous program was restored.`,
            },
          };
        }
        return {
          ok: true,
          observation: { summary: `Layer "${args.name}" set. ${this.layers.size} layer(s) playing.` },
        };
      },
    };
  }

  private removeLayerTool(): Tool<{ name: string }> {
    return {
      name: "remove_layer",
      description: "Remove a named layer and re-apply the program.",
      schema: z.object({ name: z.string() }),
      execute: async (_env, args): Promise<ActionResult> => {
        if (!this.layers.has(args.name)) {
          return {
            ok: false,
            error: `no layer named "${args.name}"`,
            observation: { summary: `No layer named "${args.name}". Layers: ${[...this.layers.keys()].join(", ") || "(none)"}` },
          };
        }
        this.layers.delete(args.name);
        const result = await this.apply();
        return result.ok
          ? { ok: true, observation: { summary: `Layer "${args.name}" removed. ${this.layers.size} remaining.` } }
          : { ok: false, error: result.error ?? "apply failed", observation: { summary: `Remove failed: ${result.error}` } };
      },
    };
  }

  private silenceTool(): Tool<Record<string, never>> {
    return {
      name: "silence",
      description: "Stop all sound. Layers are kept; any later change resumes playback.",
      schema: z.object({}),
      execute: async (): Promise<ActionResult> => {
        const page = await this.ensurePage();
        await page.evaluate("window.cadence.stop()");
        this.playing = false;
        return { ok: true, observation: { summary: "Silenced. Layers kept." } };
      },
    };
  }
}
