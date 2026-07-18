# Tier 3 — per-process address spaces (design + milestones)

**Goal:** each ring-3 program gets its OWN page tables, so programs are isolated
from **each other**, not just from the kernel. Today (`usermem.c`) every ring-3
task shares one static `user_pool` mapped at 128 GiB — program A can read/write
program B's memory. This closes that.

**Guiding constraint:** paging bugs triple-fault the box. So build on verifiable
foundations, one milestone at a time, and never ship a paging change that isn't
booted. Milestone 1 touches NO live paging — it's pure bookkeeping over free RAM.

## Current model (what we're replacing)
- Boot page tables `p4_table`/`p3_table` (boot/multiboot2.S) identity-map low RAM.
- `usermem.c`: static `user_pd`/`user_pt` map a static 2 MiB `user_pool` at
  `USER_VA_BASE` (128 GiB) with US=1; `p4_table[0] |= US`. One window, shared.
- `exec` loads a program into `upool` frames; all programs see the same VA range.
- No physical frame allocator — everything is static BSS arrays.

## Physical memory map (for the frame allocator)
- Kernel image: low, ends at `_kernel_end`.
- Heap: `[heap_base, heap_base + 32 MiB)`, `heap_base = _kernel_end` ↑2 MiB.
- Usable RAM top: `0x100000 + mem_upper_kib*1024` (below the framebuffer MMIO).
- **Free arena for the pmm: `[heap_phys_end(), ram_top)`** — above the heap,
  below MMIO, entirely inside the identity map (so the kernel can touch any
  frame at phys==virt: zero it, write PTEs into it, copy an ELF segment in).

## Milestones (each independently booted before the next)

**M1 — physical frame allocator (`pmm.c`/`pmm.h`). ← THIS STEP.**
Bitmap over the free arena, 1 bit / 4 KiB frame; bitmap itself `kmalloc`'d at
init. `pmm_alloc()` → zeroed physical frame (0 = OOM); `pmm_free(phys)`;
`pmm_frames_total/free()`. A `pmm` shell command prints the arena + a
alloc-N/free-N self-test. NO paging change — cannot triple-fault. Verifiable now.

**M2 — address-space object (`vmspace.c`).**
`vmspace_create()` → a fresh PML4 frame from pmm that COPIES the kernel's
`p4_table` entries (kernel + identity map shared into every space), with a
private user subtree. `vmspace_map(sp, uva, phys, flags)` walks/builds
PDPT/PD/PT from pmm frames. `vmspace_destroy(sp)` frees the user frames + the
private tables, never the shared kernel tables. Unit-test by building a space
and walking it in the kernel (don't switch CR3 yet).

**M3 — CR3 switch in the scheduler.**
Each task carries a `vmspace*` (kernel tasks → the kernel space = `p4_table`).
Context switch loads the next task's CR3 only when it changes. Kernel mappings
are in every space, so kernel code/data/interrupts/syscalls stay reachable
across the switch. Boot with the shell still in the kernel space (no ring-3
change yet) to prove the switch path is inert when the space is the same.

**M4 — `exec` builds a per-process space.**
Create a vmspace, alloc image + stack frames from pmm, map them at `USER_VA_BASE`
into that space, copy ELF segments in via the frames' identity addresses, drop
to ring 3 with that CR3. Retire the shared `user_pool` path (keep it until M4
is proven). `validate_user_range` + copy-in/out operate on the ACTIVE space.

**M5 — proof + red-team.**
Two programs: A writes a sentinel to its user VA; B reads the same VA and gets
its OWN (zeroed) frame, not A's sentinel. `rogue.elf` still #PF-killed; kernel
survives; clock keeps ticking. Adversarial pass on the page-table walker's
bounds (every index masked to 9 bits, every intermediate frame checked for OOM).

## Status
- [x] **M1 frame allocator — DONE + booted (commit 3fc961a).** Serial:
  `PMM: arena 0x02600000 .. 0x0ffe0000, 55776 free / 55776 frames (217 MiB)`;
  on-screen `pmm` self-test PASS (alloc 8 distinct zeroed frames, free 8, count
  restored). Arena top `0x0ffe0000` (255.9 MiB) correctly excludes the reserved
  chunk at the top of RAM — the "free only available regions" logic works.
  Proof: `frames/M1_pmm_selftest.png`, `M1-serial.txt`.
- [x] **M2 vmspace — DONE + booted (commit 6b3ba6c, verified by Rex).**
  `vmtest` PASS on 3 consecutive runs, `frames 55776 before / 55776 after`
  every time (zero drift = no leak / no double-free), fresh frames rotated per
  run and all reclaimed to baseline, `pmm` byte-identical before/after, no fault,
  single boot banner, no regression. Proof: `M2-AUDIT.md`, `frames-m2/`.
- [x] **M3 CR3 switch — DONE + booted (commit 35260dc, verified by Rex).**
  NO TRIPLE-FAULT. `vmswitch` PASS x3: `task ran == space cr3 != kernel cr3`
  (kernel 0x20a000, spaces 0x2600000/0x2605000/0x260a000 — a task genuinely ran
  under different page tables), sentinel written, counter 0→1→2→3, frames
  55776 before/after every run (no leak). No regression: exec hello.elf exits 0,
  exec rogue.elf still #PF-killed + kernel survives, ~79k context switches with
  the guard never firing for kernel-CR3 tasks, pmm baseline exact, single boot
  banner. Proof: `M3-AUDIT.md`, `frames-m3/`.
- [~] **M4 exec per-process — CODE-COMPLETE, NOT YET BOOTED (Koa).** `exec` now
  builds a private vmspace per program: image+stack frames from the pmm, mapped
  contiguously at USER_VA_BASE (P|W|US), the relocated image scattered into them
  via their identity addresses (the audited `elf_copy_bytes` byte loop), and the
  ring-3 task spawned via `task_spawn_user_space` bound to that space's CR3 and
  OWNING it. Teardown reuses the M3 discipline exactly: `reap_done` calls
  `vmspace_destroy` only for DONE, non-current tasks — by then schedule() has
  loaded a different CR3, so a live CR3 is never freed (no two tasks share an
  owned space). Syscalls validate against the per-process extent
  (`task_current_user_top` → `usermem_active_top`), not the old shared window;
  the shared `user_pool` path is now vestigial for exec (kept, unused). New
  `isotest` shell cmd proves two spaces map the same VA to DISTINCT frames with
  no cross-visibility, balancing the pmm. Verified locally: clang -fsyntax-only
  clean (-Wall -Wextra), -O2 codegen has zero memcpy/memset/xmm across every
  touched file. Awaiting Rex boot-verify before checking this box.
- [ ] M5 proof + red-team
