import type { ArgSource, Observation } from "./types";
import type { Tool } from "./tool";

/**
 * The key abstraction. A browser, a music engine, a notepad — all implement
 * this. Swapping the environment is what proves the harness is domain-agnostic
 * (DESIGN.md §1, §3.4).
 */
export interface Environment {
  name: string;
  /** Perceive the current state. */
  observe(): Promise<Observation>;
  /** Tools valid in this world. */
  availableTools(): Tool[];
  /** Optional environment-specific system guidance appended to the prompt. */
  systemHint?(): string;
  /**
   * Replay support: re-resolve an environment-sourced arg (e.g. kind "dom")
   * against the LIVE world. Return undefined to fall back to the captured
   * literal. Environments that never source args can omit this.
   */
  resolveArg?(source: ArgSource): Promise<unknown>;
  reset?(): Promise<void>;
  dispose?(): Promise<void>;
}
