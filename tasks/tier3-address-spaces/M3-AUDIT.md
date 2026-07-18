# Tier 3 M3 — CR3 switch — BOOT AUDIT (Rex)

Commit 35260dc. CI run 29623856397 (completed/success). Booted the real ISO in
QEMU (TCG, 256M, `-no-reboot`), driven by monitor `sendkey`. Verdict below is
witnessed on a live boot, not reasoned.

## HEADLINE
**NO TRIPLE-FAULT.** The box boots normally with the CR3-switch code live, and the
scheduler-driven CR3 switch genuinely works: a kernel task executed under a
DIFFERENT PML4 than the kernel, wrote its sentinel, bumped the counter, and every
frame came back. Zero leak, zero regression across 3 runs + ring-3 exec + rogue kill.

## CR3 values witnessed (3 vmswitch runs)
| run | kernel cr3 | space cr3 = task ran | counter | frames |
|----|-----------|----------------------|---------|--------|
| 1 | 0x20a000 | 0x2600000 | 0 -> 1 | 55776 / 55776 |
| 2 | 0x20a000 | 0x2605000 | 1 -> 2 | 55776 / 55776 |
| 3 | 0x20a000 | 0x260a000 | 2 -> 3 | 55776 / 55776 |

kernel cr3 constant; space cr3 a fresh frame each run (pmm rotating hint);
`task ran` == `space cr3` != `kernel cr3` every time; counter monotonic +1;
frames return to the same 55776 baseline every run.

## Checks
| # | check | result | evidence |
|---|-------|--------|----------|
| C1 | Boots normally, exactly ONE banner, no triple-fault, no reboot loop, QEMU stays up | CONFIRMED | serial-m3.log (1 banner, boot -> "TASKS: scheduler up"); QEMU PID alive every step; 01-desktop.png (desktop+clock+shell) |
| C2a | `task ran` == `space cr3` (task executed under the vmspace PML4) | CONFIRMED | 02-vmswitch-1.png: both 0x2600000 |
| C2b | `space cr3` != `kernel cr3` (truly different page tables) | CONFIRMED | 02: 0x2600000 vs 0x20a000 |
| C2c | sentinel == 0x5704deadc0de5704 (written under switched CR3) | CONFIRMED | 02: sentinel line |
| C2d | counter exactly +1 | CONFIRMED | 02: 0 -> 1 |
| C2e | frames before == after (no leak) | CONFIRMED | 02: 55776 / 55776 |
| C2f | self-test: PASS | CONFIRMED | 02: green PASS |
| R3 | `exec hello.elf` — ring-3 runs + exits (unchanged by M3) | CONFIRMED | 03-exec-hello.png: launched tid 2, 5 ticks, "exited (code 0)" |
| R4 | `exec rogue.elf` — #PF-killed, kernel survives, clock ticks | CONFIRMED | 04-exec-rogue.png: "killed: #PF page fault (ring-3 isolation held)", prompt returns; serial line 76; clock advanced |
| R5 | `vmswitch` x3 — every run PASS, frames return to baseline | CONFIRMED | 02 / 05 / 06 all PASS, all 55776/55776, 3 distinct space cr3 |
| R6a | `pmm` identical to boot baseline (no trace) | CONFIRMED | 07-pmm.png: arena 0x2600000..0xffe0000, 55776 free / 55776 == serial boot line |
| R6b | `spawn` + `ps` — tasks normal, kernel CR3, guard never fires | CONFIRMED | 09-ps.png: shell RUN 79053 / clock ready 79052 / ticker ready 2147; live green ticker counter top-right; no fault |

## Serial
- Boot banners: 1
- Only fault in entire log: line 76 `[ring3 fault] #PF page fault from user task - killing it, kernel survives` = the intentional rogue.elf kill.
- No triple / panic / reset / reboot / #GP / halt anywhere.
- Splash accent readback: `0x0a84ff OK` (blue — koa's splash fix confirmed).

## Notes (not defects, not M3)
- Frames 03/04 show a blue band filling the window area below the ring-3 program's
  output block, and 04 has minor screendump-timing tearing near the top. Cosmetic,
  correlates with ring-3 exec output (not the CR3 switch); M3 touched no rendering
  code. Load-bearing text (exit code, #PF kill line, prompts) is crisp in every frame.

Frames + serial: tasks/tier3-address-spaces/frames-m3/
