---
sessions: sess_mtyusy0t_4, sess_mtyv43le_4
run.label: run rung 4 on the shop
run.script: examples/ladder.ts
run.args: --scenario shop --rung 4
run.step: true
run.headed: true
run.viewport: 940x820
run.note: one live rung on the local page, Haiku, about 2 cents
run2.label: run rung 4 on prairiedevcon
run2.script: examples/ladder.ts
run2.args: --scenario pdc --rung 4
run2.step: true
run2.headed: true
run2.viewport: 940x820
run2.note: hits the live site and needs the network — about 2 cents
---

# Rung 4 — let the model explore

**2,500 characters of page · 30 elements listed · `find_in_page`**

| | turns | peak prompt | cost | |
| --- | --- | --- | --- | --- |
| **shop** | 3 | **10,295** | **$0.0216** | right cart ✓ |
| **prairiedevcon** | 3 | **7,352** | **$0.0147** | **completed** ✓ |

Stop shipping the page. Send a small window of it and a tool that searches the
rest. The model asks for what it needs instead of being handed everything in
advance — which is what a person does with a long page.

**4,653 tokens billed fresh; 13,884 read from cache.** With the page gone from
the prompt, what is left is mostly the stable prefix — so most of this run is
paid for at a tenth of list price. And note the real page is now the *cheaper*
of the two: the site is bigger, but the prompt no longer grows with it.

## The climb, end to end

| rung | shop peak | shop cost | pdc peak | pdc cost | pdc outcome |
| --- | --- | --- | --- | --- | --- |
| 1. naive | 97,024 | *$0.1346* | 156,449 | $0.2044 | **error** |
| 2. + volatile tail | 36,060 | $0.0714 | 79,748 | $0.0830 | **stopped** |
| 3. + cleaned page | 19,137 | $0.0312 | 25,886 | $0.0242 | completed ✓ |
| 4. + let it explore | **10,295** | **$0.0216** | **7,352** | **$0.0147** | completed ✓ |

**On the shop page, bad context construction costs money. On a real one it
stops working** — and the two that fail there are the two that were fine on the
page I chose.

**The honest catch:** this rung is the one that gets things subtly wrong. It
sees a window around a match, and a window can straddle two entries. On the
real page it once reported the right session title with the *next* session's
speaker — a confident near-miss, which is the most expensive kind of error
because it looks like success.

> Three things make this rung work, all three found by watching it fail: every
> element stays addressable even when only 30 are listed; the preview shows the
> **head and the tail** of the page; and every search hit says which section it
> was found under.
