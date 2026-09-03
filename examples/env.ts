/**
 * Load `.env` from the repo root into process.env.
 *
 * Import this FIRST in any example that can make a live model call:
 *
 *     import "./env";
 *
 * Values already set in the shell win — the file only fills the gaps — so
 * `ANTHROPIC_API_KEY=... npm run browse` still overrides the file for a
 * one-off. A missing .env is not an error: replay and scripted runs need no
 * key, and the whole point is that they work on a machine that has none.
 *
 * Deliberately dependency-free (node's own loader, 20.12+): one less thing to
 * install on a conference laptop.
 */
import fs from "node:fs";
import path from "node:path";

const file = path.resolve(".env");
if (fs.existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    // A malformed .env should say so plainly, not fail later as "no API key".
    console.warn(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
