# Shutdown / restart — audit (2026-07-17)

Feature: a real power-off + restart path. Mechanism by Koa (ACPI S5 + QEMU-port
fallback + 8042 reboot), UI by Valentina (top-bar power glyph → confirm dialog →
"safe to turn off" fallback), both coordinated through a frozen `power.h` and the
crew mailbox. Verified by Rex on the CI ISO for commit `a508c47`.

**Verdict: all 6 CONFIRMED, zero defects. "Demo-safe."**

Rex's method note is the point: he deliberately dropped QEMU's `-no-shutdown` /
`-no-reboot` so a real ACPI poweroff (process exits **code 0**, exactly **one**
boot banner) is distinguishable from a triple-fault (which would reset → print a
**second** banner). Without that, you can't tell "powered off" from "crashed."

| # | Claim | Result | Evidence |
|---|-------|--------|----------|
| 1 | ACPI S5 parse succeeds | ✅ | serial: `ACPI: S5 poweroff ready (PM1a_CNT=0x604, SLP_TYPa=0)` |
| 2 | `shutdown` really powers off | ✅ | QEMU exit **code 0** in 0.5s, **1** boot banner (not a fault) |
| 3 | `reboot` really restarts | ✅ | 2nd `=== Astrion v2.0 Kernel ===` in same process; `SD_C01` post-restart desktop |
| 4 | UI dialog + misclick safety | ✅ | `SD_A03` dialog; **Esc / Cancel / click-outside all dismiss** without powering off (`SD_A04/06/07`); Shut Down → exit 0 |
| 5 | Editor autosaves before power | ✅ | typed `rex_autosave_probe_42`, hit Restart, `cat` after reboot returned it (`SD_E01`→`SD_E03`) |
| 6 | No regressions | ✅ | desktop, `mkdir/cd/pwd`, RTC top-bar clock (20:02→20:17), Assistant, ring-3 `exec hello.elf` exit 0 |

Frames in `frames/`. Real-hardware caveat (unchanged from the mechanism): on a
machine where the ACPI S5 write doesn't cut power and it ignores the QEMU I/O
ports, `power_off()` returns and the UI paints "It's now safe to turn off your
computer." — not reachable under QEMU, so unverified there.
