# Tier 3 — M5b independent memory-safety review of per-process paging (2026-07-17)

Second, fully-independent adversarial read of the Tier-3 per-process VM code. No
prior context assumed; the M5-REVIEW "no bugs" verdict was treated as a claim to
break, not a fact. I read cold: `pmm.c/h`, `vmspace.c/h`, `task.c/h`, `shell.c`
(exec path), `syscall.c`, `usermem.c/h`, `boot/multiboot2.S`, plus the code the
invariants actually depend on — `elf.c` (the untrusted-input parser), `gdt.c`,
`usermode.S`, `context_switch.S`, `idt.c` (ring-3 fault path), and the init order
in `kernel_mb2.c`.

## Bottom line

I did **not** find a confirmed isolation-bypass, memory-corruption, double-free,
use-after-free, freed-live-CR3, or integer-overflow bug. I traced each of the four
invariants to ground and they hold. This is a reasoned all-clear on the severe
categories (evidence per-category below), **not** a shrug — but it is also honest:
the only concrete defects I can name are one latent leak and four latent
landmines, none of which bites the running system today. Details first, so the
reader can judge the "clean" claim rather than take it.

---

## Findings (most severe first)

### F1 — LOW / latent leak: `exec_ctx` is not reclaimed if an exec'd task is killed before it runs
`shell.c:1635` allocates `ec = kmalloc(sizeof *ec)` and hands it to the ring-3
task as `arg`. It is freed in exactly one place — `exec_trampoline` (`shell.c:1518`),
which runs *as the task*. `reap_done` (`task.c:115-143`) reclaims a dead task's
kernel stack, `upool` frames, and `vmspace`, but **never `t->arg`**.

Scenario: `exec prog.elf` spawns T in state `READY` (`task.c:233`). If T is set
`DONE` before it is ever scheduled — `task_kill` explicitly permits killing a
`READY` task (`task.c:367-368`) — the next `reap_done` frees T's stack/space but
leaks the 16-byte `ec`.

Severity LOW because under the current preemptive scheduler T is essentially
guaranteed to be scheduled (and thus free `ec` itself) before the shell can
dispatch a `kill`, so the window is a near-impossible race. It becomes reachable
if preemption is ever disabled, IF is masked around the spawn, or the free
responsibility is refactored. Fix: have `reap_done` treat `arg` as owned, or free
`ec` from the spawn site on a kill-before-run. Not a corruption bug — `ec` is
copied to locals before its own `kfree`, so no use-after-free (`shell.c:1516-1519`).

### F2 — INFO / latent landmine: `vmspace_map`'s `else` branch would build a kernel-less PDPT
`vmspace.c:99-104`: if `pml4[i4]` is *not present*, it allocates a fresh **zeroed**
PDPT and links it **without copying the identity entries `[0..3]`**. A task run
under such a space would have no kernel identity map → triple-fault on the first
instruction after the CR3 load.

Today this is dead code: `idx4(uva)` is always 0 for the enforced range
`[USER_VA_BASE, 512 GiB)` (`vmspace.c:78`), and `pml4[0]` is always present
(copied from `p4_table[0]`, which boot sets present and `usermem_init` only ORs
`US` into). So it never executes. It is a landmine for any future change that
lets the user region span a different/again-non-present PML4 slot. Worth a guard
or an assert rather than silent incompleteness.

### F3 — INFO / latent sharp edge: a fresh (unforked) vmspace still exposes the shared `user_pool` at `USER_VA_BASE` with US=1
`vmspace_create` copies `p4_table` verbatim (`vmspace.c:54`), so before the first
`vmspace_map`, `pml4[0] → p3_table`, and `p3_table[128]` still points at the
shared `user_pd`/`user_pool` window with `US=1` at every level (set by
`usermem_init`, `usermem.c:46-50`). So in an unforked space, `USER_VA_BASE`
resolves — ring-3-reachable — to the *shared* pool.

Not live today: `exec` always maps ≥1 page (which forks and zeroes `[128]`,
`vmspace.c:95`) **before** the task is spawned, and the only other space-bound
task (`vmswitch` self-test) also maps before spawn. So no ring-3 task ever runs
under an unforked space. But "isolation depends on the caller always mapping
before running" is an implicit invariant; if any future path spawns a ring-3 task
under a freshly-created-but-unmapped space, two such tasks would silently alias
the shared pool. Consider forking (or dropping `[128]`) in `vmspace_create`
itself so a space is isolated from birth.

### F4 — INFO / defensive gap: `pmm_free` double-free protection is only partial
`pmm.c:141` no-ops a free when the frame's bit is already clear — but only if the
frame is *still free* at the second free. If a buggy caller freed frame X, X was
re-`pmm_alloc`'d to a new owner (bit set again), then X is freed a second time,
the guard passes and X is wrongly returned to the pool → aliasing. I found **no**
caller that does this (exec/destroy free-once was verified, see below), so it is
latent, but the allocator is not a backstop against a future double-free the way
the comment implies.

### F5 — INFO / portability constraint (pre-existing, acknowledged in comments)
The whole model assumes usable RAM and the framebuffer live below 4 GiB: the boot
identity map covers only `[0, 4 GiB)` (`multiboot2.S:151-165`), `pmm` clamps its
arena to `IDMAP_LIMIT` (`pmm.c:27,50-53`), and `as_table()` treats a frame's phys
as a kernel pointer (`vmspace.c:42`). On hardware with RAM or a framebuffer above
4 GiB, page-table frames or the FB would fall outside the identity map. Design
constraint, not a regression, but it bounds where this code is safe to boot.

---

## Reasoned all-clear per hunt category (what I checked)

**Invariant 1 — private page tables / same-VA→different-frame isolation.**
`vmspace_create` gives each space a distinct PML4 frame (`pmm_alloc`, unique).
The first `vmspace_map` forks `p3_table` into a private PDPT and drops the shared
window (`vmspace.c:87-98`); every table below is a distinct pmm frame. Two spaces
therefore map `USER_VA_BASE` through disjoint PDPT[128]→PD→PT→leaf chains onto
different frames. The `isotest` path exercises exactly this. A space can only
reach another's frames via their phys in the identity map, which is `US=0` (see
Inv. 2), so ring 3 #PFs. **No aliasing path found.**

**Invariant 2 — kernel mapped, supervisor-only, in every space.**
`p4_table[0]` is `US=1` but `p3_table[0..3]` (identity PDs) and their 2-MiB leaves
are `US=0` (`multiboot2.S:138-165`); the fork copies `[0..3]` verbatim, preserving
`US=0`. AND-rule ⇒ identity/kernel memory is supervisor-only in every space; the
`US=1` upper entries only open the private user subtree. Kernel image, heap
(4–36 MiB), task kernel stacks (kmalloc'd, in-heap), and FB (0xfd000000) all sit
in that `US=0` identity range, so a syscall/fault handler reaches them under any
CR3 while ring 3 cannot. No global (G) bits anywhere, so CR3 loads flush cleanly.
**Verified US=0 at PDPT and PD level for all identity entries.**

**Invariant 3 — no page table freed while it is the active CR3.**
Proved the register invariant `CR3 == tasks[current_tid].cr3` holds after every
switch (`schedule` loads `to->cr3` iff it differs; boot/`tasks_init` establish the
base). `vmspace_destroy` is only reached (for an *owned* space) from `reap_done`,
gated on `DONE && i != current_tid` (`task.c:117,136`). A non-current task's cr3
is, by the invariant, not the value in CR3 — and owned spaces are never shared
(each `task_spawn_user_space` mints a fresh vmspace). I walked the normal exit
(`SYS_EXIT`→`task_exit`), the ring-3 #PF-kill (`idt.c:276`→`task_exit`), `task_kill`,
preemption mid-syscall, and the stack-overflow auto-kill: in every case the
schedule() that makes a task non-current loads a different CR3 *before* any later
reap frees it. The self-tests (`vmswitch` gates destroy on observed `DONE`;
`vmtest`/`isotest` never load the space as CR3) are consistent. **No freed-live-CR3
window found.**

**Invariant 4 — no frame leaked / double-freed / used-after-free.**
`vmspace_map` links partial tables into the tree on OOM, so `vmspace_destroy`
reclaims them; the destroy walk frees each leaf/PT/PD/PDPT/PML4 exactly once and
skips shared entries via `e3 == p3_table[i3]` (`vmspace.c:152`) — which can never
wrongly skip the private PD (its pmm-arena address can't equal the BSS `user_pd`)
nor wrongly free a shared PD (identity entries are byte-equal to `p3_table[0..3]`,
never mutated post-boot). `exec_build_space` frees the un-installed leaf with
`pmm_free(fr)` and the rest with `vmspace_destroy` on both failure edges, with no
overlap (a failed `vmspace_map` never installs `fr`, so destroy can't also free
it). `reap_done` nulls each pointer/zeroes counts after freeing and sets `UNUSED`,
so no double-reap. Only exception to full coverage is F1 (`arg`/`ec`). **No
double-free or leak found besides F1.**

**Bounds / index errors.** `idx1..idx4` all mask `& 0x1FF` (`vmspace.c:35-38`);
`ensure_table` indices are pre-masked; `vmspace_map` rejects `uva` outside
`[USER_VA_BASE, 512 GiB)` so `idx4≡0` and `idx3∈[128,511]` — never an identity
slot `0..3`. Leaf install masks `phys & PTE_ADDR_MASK`. `validate_user_range`
(`usermem.c:102-110`) is wrap-safe (`len > top - uptr`, never `uptr+len`), bounds
against the *per-process* `user_top`, and the boundary `uptr==top` only admits
`len==0`. The whole `[USER_VA_BASE, user_top)` is contiguously mapped by exec, so
any validated pointer is backed. **No index/bounds escape found.**

**Integer overflow / wrap (malicious ELF controls sizes/vaddrs).** The ELF loader
hard-caps `image_hi ≤ ELF_MAX_IMAGE = 4 MiB` and file ≤ 1 MiB, and every segment/
reloc bound uses the wrap-safe `a > cap - b` idiom (`elf.c:122-161, 193-234`). So
`span ≤ 4 MiB` ⇒ `image_frames ≤ 1024`, `total_frames ≤ 1028`, `img_cap ≤ 4 MiB`
— none of `cmd_exec`'s frame math (`shell.c:1598-1607,1632`) can truncate or wrap;
pmm/kcalloc OOM is a redundant backstop. Relocation *values* are `USER_VA_BASE +
addend` (a user VA, not the kernel dst), so a crafted PIE cannot aim ring-3
pointers at kernel space or overrun the bridge buffer. **No wrap found.**

**OOM partial-build leaks.** Every early return in `vmspace_create`, `vmspace_map`,
`ensure_table`, `exec_build_space`, and `cmd_exec` reclaims what it allocated
(traced each edge above). **Clean except F1.**

**TOCTOU / races.** `spawn_locked` and `reap_done` run under `irq_save`/IF=0;
`schedule` is only entered IF=0 (via `task_yield` cli, `task_preempt` from the ISR,
`task_exit` cli). cr3/space/user_top are recorded before `state = READY` is set
last, so no tick observes a half-bound task. The syscall stub stashes the user RSP
in a global scratch only in its IF=0 prologue before switching to the per-task
kernel stack (`usermode.S:54-56`), single-CPU-safe. **No race found.**

## Method note
Findings are from static tracing, not a boot. F1 is a real code path (confirmed
`reap_done` omits `arg`); its *reachability* under preemption is the only reason
it's LOW. F2–F5 are latent by construction. If one artifact were worth booting to
confirm, it's F3 — spawn a ring-3 task under a created-but-unmapped space and
check whether it can touch the shared pool — but no current path does that.
