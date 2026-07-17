# Polish round — verification (2026-07-17)

Polish commit `a7d8228` ("blue splash, real-HW RTC, copied-cue, Files scroll"),
CI build run `29614540991` (success). Booted the fresh CI ISO in QEMU and drove
it entirely over the monitor by **shell commands** (`edit`, `files`, `shutdown`)
so no mouse was needed — every app opened via sendkey, which is what let this
run land where the earlier mouse-driven attempts stalled.

**Verdict: all 4 polish items CONFIRMED + no regressions. The round shipped clean.**

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Blue splash accent (was orange) | ✅ | serial: `boot screen: readback @ accent = 0x0a84ff OK - pixel write verified`. Desktop accents (active dock border, window title) all blue in `00_desktop.png`. |
| 2 | Real-HW RTC (CMOS, ACPI-FADT century) | ✅ | serial: `RTC: 2026-07-17 22:54:20 (CMOS wall clock, no network time)`. Top-bar clock live and advancing across frames: 22:54:28 → :32 → :49 → :51. |
| 3 | "copied" chip on Ctrl+C in editor | ✅ | `02_editor_copied.png` — teal "copied" chip in the editor's bottom-right after Ctrl+C on the line "hello copied chip". |
| 4 | Files scroll past a screenful | ✅ | `03_files_top.png` (d01–d12, d01 selected, scrollbar thumb at top) vs `04_files_scrolled.png` (after 16×Down: scrolled to d06–d17, **d17 selected and kept visible**, thumb slid down). `files_ensure_visible` + scrollbar both working over 20 dirs. |

### No regressions
| Check | Result | Evidence |
|-------|--------|----------|
| Single clean boot (no triple-fault reboot) | ✅ | exactly **1** "Astrion" boot banner in serial. |
| Windows open / focus / dock active-highlight | ✅ | Terminal, Editor, Files all opened and focused via shell; active dock icon shows the blue accent (`00`, `02`, `03`). |
| Clipboard editor still works | ✅ | text typed + copied; chip is additive, copy path unchanged (`02`). |
| ACPI S5 power-off still clean | ✅ | `ACPI: S5 poweroff ready (PM1a_CNT=0x604, SLP_TYPa=0)`; on `shutdown` QEMU **exited 0** and closed the monitor socket mid-command (broken pipe) — a real S5, not a triple-fault (which would exit non-zero under `-no-reboot`). This is the item that mattered most, since the round touched `acpi.c`. |

Proof: `frames/00_desktop.png` … `frames/04_files_scrolled.png`, `serial.txt`.
Driver: single-connection HMP client, reads every monitor reply before the next
command (the fix for the reply-buffer backpressure that stalled the mouse runs).

*Verified directly (not via say-so): the ISO was booted, driven, and powered off;
every claim above is a pixel or a serial line in this directory.*
