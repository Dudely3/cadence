/**
 * Re-point a recording at different values.
 *
 * The recording knows what it was about (`session.params`), so it can find
 * those values in what it did: in the arguments it passed, and in the DOM
 * selectors it captured for re-resolution. Swap each recorded value for a new
 * one and the same recorded program runs against a different subject — with no
 * model call, because nothing needs re-deciding. That is the difference
 * between a recording and a video.
 *
 * The substitution is textual, which is honest about its own limits:
 *
 *   - A value has to be distinctive enough to find unambiguously. Two-character
 *     values are refused outright — replacing "a" everywhere is not a feature.
 *   - It rewrites INPUTS, never the completion summary. That summary is what
 *     the model said about the values it saw, and no model runs on a replay;
 *     rewriting it would manufacture a sentence nobody ever wrote, with the
 *     recorded run's numbers still inside it. Judge a re-pointed replay by the
 *     world it left behind, not by its narration.
 */
export interface Rebinding {
  /** Param name → the value this replay should use instead. */
  to: Record<string, string>;
  /** Param name → the value the recording used. Usually `session.params`. */
  from: Record<string, string>;
}

const MIN_VALUE_LENGTH = 3;

/** Ordered old→new pairs, longest first so overlapping values substitute safely. */
export function substitutions(binding: Rebinding): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [name, next] of Object.entries(binding.to)) {
    const prev = binding.from[name];
    if (prev === undefined) {
      console.warn(`replay params: "${name}" is not a param of this recording — ignoring it`);
      continue;
    }
    if (prev === next) continue;
    if (prev.length < MIN_VALUE_LENGTH) {
      console.warn(
        `replay params: "${name}" was recorded as ${JSON.stringify(prev)}, too short to substitute safely — ignoring it`,
      );
      continue;
    }
    pairs.push([prev, next]);
  }
  // Longest first: if one recorded value contains another, replacing the short
  // one first would corrupt the long one.
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

export function applySubstitutions(text: string, pairs: Array<[string, string]>): string {
  let out = text;
  for (const [prev, next] of pairs) out = out.split(prev).join(next);
  return out;
}
