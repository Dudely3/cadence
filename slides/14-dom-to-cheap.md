# DOM → something cheap

What the extractor actually does, in order:

- **Drop what is never content** — `script`, `style`, `svg`, `iframe`, `head`,
  and anything `display:none` or `aria-hidden`
- **Keep the shape that carries meaning** — headings become `#` markers, so
  structure survives as plain text
- **De-duplicate repeated chrome** — nav labels appear three times in the
  markup and once in the output
- **List interactive elements separately** — `[id] <tag> label`, addressable by
  id, no markup at all

And the encoding is a free lever. Identical element data, three ways:

| encoding | tokens | vs pretty |
| --- | --- | --- |
| JSON, 2-space indented | 6,920 | 100% |
| JSON, minified | 3,302 | 48% |
| plain lines, no JSON | 2,281 | **33%** |

**67% off for reformatting the same information.** Indentation is whitespace
you are paying per token to transmit.

> Honest caveat: on this page our cleaned text (17,218) is marginally *bigger*
> than raw `innerText` (17,012) — the `#` markers cost something. Cleaning buys
> reliability and structure, not size. Dropping the markup is what buys size.
