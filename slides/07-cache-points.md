---
sessions: sess_mtks1qz8_1
---

# How cache points actually work

**One invariant:** prompt caching is a *prefix match*. Any byte change anywhere
in the prefix invalidates everything after it.

Render order is fixed: `tools` → `system` → `messages`.

- A `cache_control` breakpoint marks "cache everything up to here".
- **Max 4 breakpoints** per request.
- Default TTL 5 minutes; `ttl: "1h"` available.
- Writes cost **1.25×** input (5 min) or **2×** (1 hour). Reads cost **~0.1×**.
- Break-even is **two requests** on the 5-minute TTL.

> A breakpoint on the last `system` block caches tools *and* system together,
> because tools render first.
