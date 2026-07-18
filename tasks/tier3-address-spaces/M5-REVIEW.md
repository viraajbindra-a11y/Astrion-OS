# Tier 3 M5 — adversarial review of the per-process paging (2026-07-17)

Independent adversarial read of the new paging + exec code (I did not write the C;
Koa did). Paired with Rex's boot verification of M1–M4 (isolation proven, rogue
killed, zero leak, no panic across every milestone). **Verdict: no bugs found.**

## What I checked and why it holds

**`vmspace.c` — the page-table walker/builder**
- Every level index masks `& 0x1FF` (idx1..idx4). No index can walk past a 512-entry table.
- `vmspace_map` rejects `uva < USER_VA_BASE || uva >= 512 GiB`, so `idx4` is always 0 —
  every user mapping lives in PML4[0]'s single slot, the one slot the fork touches and
  the one slot destroy unwinds. No path reaches an identity PML4/PDPT slot.
- The PDPT fork copies `p3_table` (identity `[0..3]` survive), zeroes the old shared
  window `[128]`, overrides PML4[0]. Second+ maps reuse it (present && != p3_table),
  so it forks exactly once.
- OOM is checked at `vmspace_create` and every `ensure_table` (returns 0/-1); partial
  tables are linked into the space, so `vmspace_destroy` reclaims them.
- Leaf install masks `phys & PTE_ADDR_MASK` so a stray low bit can't bleed into flags.
- `vmspace_destroy` frees ONLY PML4[0]'s private subtree. The load-bearing line
  `if (e3 == p3_table[i3]) continue;` works because the forked PDPT's identity entries
  still *equal* `p3_table[0..3]` by value (skipped, never freed); zero entries are
  skipped by the `!PTE_P` guard; only the private user PD at index 128 (which differs
  from `p3_table[128]`) is walked and freed. pmm frames live above the arena base, so a
  private table's address can never collide with `p3_table` (kernel BSS). No frame is
  freed twice (each leaf/PT/PD/PDPT appears exactly once).

**`shell.c` exec path — leak-safety on every failure**
- `exec_build_space`: on `pmm_alloc` OOM mid-loop → `vmspace_destroy(sp)` (reclaims the
  already-mapped frames + tables). On `vmspace_map` failure → `pmm_free(fr)` first (the
  frame isn't installed, so destroy wouldn't own it) THEN `vmspace_destroy(sp)`.
- `cmd_exec`: every failure after `vmspace_create` (kmalloc exec_ctx fail, task_spawn
  fail) calls `vmspace_destroy(sp)`; the space is destroyed while NOT spawned, so it's
  never a live CR3. The file bytes are snapshotted into a private kbuf (never touches
  the live FS node); the bridge buffer is `kfree`'d after the copy.

**Integer/bounds safety of the sizes**
- `elf_probe` caps `image_hi` at `ELF_MAX_IMAGE` (4 MiB), file at `ELF_MAX_FILE`, and
  every segment bound uses the wrap-safe `> image_hi - x` idiom. So `span ≤ 4 MiB` →
  `image_frames ≤ 1024` → the `uint32_t` frame-count cast can't truncate or wrap;
  `kcalloc`/`pmm` OOM are a redundant backstop for the largest legal image.

**Freed-live-CR3 (the class that triple-faults)**
- Reuse of the M3 discipline: `reap_done` destroys an owned vmspace only for
  `DONE && != current_tid`; reaching that state required a `schedule()` that already
  loaded a different CR3, and no two tasks share an owned space. So the freed PML4 is
  never the active CR3. Gated on task STATE, never a task-written flag.

## Residual notes (not bugs)
- The `else` branch in `vmspace_map` (PML4[i4] not present) never executes for the
  confined range — PML4[0] is always present from the `p4_table` copy — but if it ever
  ran it would build a PDPT without the identity entries. Dead but technically
  incomplete; harmless under the enforced invariant. Left as-is.
- Console async-output scroll race — cosmetic, predates M4, tracked as a separate task.

## Bottom line
No wraps, no leaks, no double-frees, no freed-live-CR3, no unbounded sizes. Combined
with Rex's four booted verifications, Tier 3 is complete and hardened. A fully fresh
second reviewer could be spawned for belt-and-suspenders (the project's posture is
"independent review catches what the author misses"), but this pass — independent of
the author and backed by four real boots — found the code correct.
