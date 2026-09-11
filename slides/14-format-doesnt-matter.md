# The model doesn't care about your markup

Same page, seven representations, one factual question. Measured with the
count-tokens endpoint — not estimated.

**prairiedevcon.com**, "who is speaking about execution modes?"

| representation | tokens | vs raw | answered |
| --- | --- | --- | --- |
| raw HTML | 76,281 | 100% | ✓ Addison Rennick |
| HTML, attributes stripped | 28,419 | 37% | ✓ Addison Rennick |
| `body.innerText` | 17,012 | 22% | ✓ Addison Rennick |
| cleaned text | 17,218 | 23% | ✓ Addison Rennick |

Four formats, one answer. **76,000 tokens down to 17,000, same result.**

The markup was never for the model. Tags, classes, wrappers, data attributes —
that is scaffolding for browsers and for us. The model reads the text.

> Run it on any page: `npm run formatlab`. The local shop shows the same shape —
> 3,275 → 452 tokens, all four correct.
