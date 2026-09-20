---
sessions: sess_mtyushk9_2, sess_mtyusqcl_3
---

# The model doesn't care about your markup

**Rung 3 halved the prompt by dropping the markup. This is what it dropped.**
The same product, in the same catalogue, in two recordings bound to this slide.
Rung 2 sends the page as the DOM has it:

```html
<div class="product"><h3>Camp Stove</h3><p>C
anister stove, 3.5 min boil.</p><div class="
row"><span class="price">$44.99</span><butto
n aria-label="Add Camp Stove to cart" data-c
ad-id="3">Add to cart</button></div></div>
```

Those line breaks are mine, so it fits on a slide. The real thing has none —
that is one unbroken run of characters. Rung 3 sends what the model reads:

```
### Camp Stove
Canister stove, 3.5 min boil.
$44.99
Add to cart
```

**86,740 characters of tail become 39,131.** Same page, same catalogue, same
answer — and every `div`, `class`, `span` and `data-` attribute above was
scaffolding for a browser, not for a reader.

## It holds on a real page too

**prairiedevcon.com**, "who is speaking about execution modes?" Four
representations, measured with the count-tokens endpoint — not estimated.

| representation | tokens | vs raw | answered |
| --- | --- | --- | --- |
| raw HTML | 76,281 | 100% | ✓ Addison Rennick |
| HTML, attributes stripped | 28,419 | 37% | ✓ Addison Rennick |
| `body.innerText` | 17,012 | 22% | ✓ Addison Rennick |
| cleaned text | 17,218 | 23% | ✓ Addison Rennick |

## What the extractor does, in order

- **Drop what is never content** — `script`, `style`, `svg`, `iframe`, `head`,
  anything `display:none` or `aria-hidden`
- **Keep the shape that carries meaning** — headings become `#` markers
- **De-duplicate repeated chrome** — nav labels appear three times in the
  markup, once in the output
- **List interactive elements separately** — `[id] <tag> label`, addressable by
  id, no markup at all

And the encoding is a free lever on top. Identical element data, three ways:

| encoding | tokens | vs pretty |
| --- | --- | --- |
| JSON, 2-space indented | 6,920 | 100% |
| JSON, minified | 3,302 | 48% |
| plain lines, no JSON | 2,281 | **33%** |

**67% off for reformatting the same information.** Indentation is whitespace
you are paying per token to transmit.

> Honest caveat: on the conference page our cleaned text (17,218) is marginally
> *bigger* than raw `innerText` (17,012) — the `#` markers cost something.
> Cleaning buys reliability and structure, not size. Dropping the markup is
> what buys size.
>
> Run it on any page: `npm run formatlab`.
