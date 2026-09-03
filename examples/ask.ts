/**
 * One-shot terminal prompt, shared by the interactive commands.
 *
 * Ctrl+C, Ctrl+D and a closed stdin all answer "" so a caller can treat empty
 * as cancel and nothing can hang — which also means piped input that ends
 * immediately reads as a cancel, so test these flows with stdin held open.
 *
 * Order matters: rl.close() emits "close" SYNCHRONOUSLY, so settle() must run
 * before the close() call. Resolving after it lets the close handler's cancel
 * win the race and silently discard an answer the user actually typed.
 */
import readline from "node:readline";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      rl.close();
    };
    // Without this, Ctrl+C at the prompt kills the process with a raw ^C.
    rl.on("SIGINT", () => settle(""));
    rl.on("close", () => settle(""));
    rl.question(question, settle);
  });
}
