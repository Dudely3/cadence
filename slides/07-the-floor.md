# The floor nobody mentions

There is a **minimum cacheable prefix**. Below it, nothing caches.

| Model | Minimum |
| --- | --- |
| Opus 5 | 512 tokens |
| Opus 4.8 | 1,024 |
| Opus 4.7 | 2,048 |
| **Haiku 4.5** | **4,096** |

It is **not monotonic across generations**. The cheap model has the highest bar.

**Measured, this run:**

- stable prefix ≈ **{{prefix_tokens}} tokens** — tool schemas + system + goal
- cache read this run: **{{cache_read}} tokens**

That is the whole explanation for why speed mode showed zero caching on a task
where accuracy mode showed thousands: same prompt, different floor.
