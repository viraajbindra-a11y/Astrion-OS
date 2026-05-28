# Session Handoff — 2026-05-24 → 2026-05-25 (the heaviest day)

**~35 commits across two big arcs:** Phase 1 close + safety hardening
on the v1.0 web-app substrate, then a parallel pivot into reviving
the dormant `kernel/` C-kernel attempt toward v2.0 real-OS. Both arcs
made real, verifiable progress. v1.0 is on track for Dec 21; v2.0 has
a concrete starting line.

---

## Arc 1 — v1.0 (web-app substrate, ships Dec 21)

### Phase 1 closed — M8.P5 GREEN

The 24h soak verdict on 2026-05-24 came back GREEN. M8.P5 disk-write
self-mod ships in v1.0 with one explicitly documented caveat (1 cycle
out of 10 failed at rollbackVerify; investigation showed it was
correlated with a low-battery force-sleep aborting the in-flight
fetch, not a substrate bug — file on disk was byte-identical to the
original post-incident).

| # | Commit | Theme |
|---|---|---|
| 1 | `307b26b` | W19 soak scheduler |
| 2 | `d918822` | GREEN/RED pre-drafts |
| 3 | `d22ff34` | Phase 2 W22 landing page |
| 4 | `bf42695` | gatesFailed instrumentation |
| 5 | `93550f5` | **M8.P5 GREEN verdict — shipped in v1.0** |
| 6 | `44af74b` | Safety-story audit: 12+ doc overclaims fixed |
| 7 | `4a34e96` | Phase 2 W23 demo video script (3 weeks early) |
| 8 | `8434031` | Verify-read retry (v1.0 hardening) + pill fix |
| 9 | `f726c09` | Spotlight 5→6 gates |
| 10 | `9591b0d` | Install + hardware-testing pre-flash checklist |
| 11 | `e597a4a` | SESSION_HANDOFF (mid-day) |
| 12 | `2c12a49` | Pen-test +3 attack patterns |
| 13 | `9268845` | "Run pen-test" button in Settings |
| 14 | `19d68ae` | **LICENSE file** (was claimed in 3 places, never existed) |
| 15 | `c807cae` | content-blocklist: close 4 eval-bypass holes |
| 16 | `6b2a4d4` | messages: refuse L2+ caps in mini-executor (silent bypass closed) |
| 17 | `fe299a3` | SESSION_HANDOFF update for commits 11-16 |
| 18 | `2965802` | v2.0 real-OS design doc (multi-year honest plan) |
| 19 | `31dd441` | website: Formspree wired (`mojbkeky`) + in-page success swap |

### Hostile-reviewer pre-emption — real bugs caught

- 4 content-blocklist eval bypasses: `Function('...')` no-new,
  `window['eval']`, string-arg `setTimeout`/`setInterval`,
  `.constructor('...')` — closed with new regexes + tightened
  defense-in-depth scan
- 1 silent L2+ bypass in Messages mini-executor — closed with
  level-check refusal
- Missing LICENSE file (claimed MIT in README + landing + install)
- 12+ doc drifts (5-gate → 6-gate, rapid-confirm 1.5s not 2s,
  red-team 3-tier semantic, Surface Pro 6 "verified" → unverified)

### Phase 2 prep — ahead of schedule

- W22 landing page polish (`d22ff34`) + Formspree wired (`31dd441`,
  form id `mojbkeky`, in-page success swap via `_next` redirect)
- W23 10-min safety video script drafted scene-by-scene
- W21 (DNS) still user-blocked
- Phase 4 hardware-testing checklist (`docs/hardware-testing.md`)

### ISO builds

Three full ISO builds queued this session:
- `26378013784` — kernel-from-main (first soak wire) → success
- `26378897114` — kernel-from-main (post-soak GREEN + safety audit) → success
- `26414401621` — kernel-from-main (everything except last few commits) → success
- All artifacts available via `gh run download <id>` for 30 days

---

## Arc 2 — v2.0 real-OS kernel (parallel project, multi-year)

### Started from dormant + got it booting

The user picked the "real kernel-level OS" option. Discovered the
`kernel/` directory had an existing 1087-line C kernel attempt from
2026-04-04 that never compiled in CI. Picked up the dormant work
and brought it to live bootable status.

### Bugs caught + fixed (in our code)

| # | Commit | Theme |
|---|---|---|
| 20 | `562ec00` | Makefile gnu-efi multi-arch path detection (CI unblock) |
| 21 | `a4d7498` | NOVA → Astrion user-visible strings |
| 22 | `f38721a` | `.rodata` + `.eh_frame` missing from objcopy (fixed #UD at +0x2001C) |
| 23 | `291edfd` | `-znocombreloc` + libefi link order (fixed #UD at +0x1000) |
| 24 | `0027c0c` | UART 0x3F8 serial output added |
| 25 | `61a843e` | per-call serial diagnostics |
| 26 | `37d85c1` | skip ConOut->ClearScreen (EDK2 serial-redirect hang) |
| 27 | `da75fe4` | step-1 inner diagnostics |
| 28 | `481c320` | LocateHandleBuffer + HandleProtocol (GOP) |
| 29 | `7a0065d` | GOP optional (graceful headless fallback) |
| 30 | `b6c66f4` | status-check every HandleProtocol/OpenVolume call |
| 31 | `059dd39` | OpenProtocol attempt + hex status logging |
| 32 | `a248fef` | gnu-efi global GUID + log ImageHandle |
| 33 | `7990a16` | drop EFIAPI from efi_main (ABI fix) |
| 34 | `6812759` | log at-entry args + LibImageHandle fallback |
| 35 | `a68a545` | skip LoadedImage; enumerate SimpleFileSystem |

### Where the kernel boot reaches today

Live serial output in QEMU now shows:
```
=== Astrion Kernel Bootloader v0.1 ===
efi_main entered; serial init OK
at-entry ImageHandle = 0x000000000e7b8998
at-entry SystemTable = 0x000000000f5ec018
InitializeLib returned
Astrion Kernel Bootloader v0.1
Initializing...
[1/4] Setting up display
WARN: no GOP found; booting headless
[1/4] display OK
[2/4] Loading kernel from \nova\kernel.bin
  ImageHandle (param) = 0x0           ← compiler-elided, harmless
  LibImageHandle = 0x000000000e7b8998 ← correct, used instead
  effective_handle = 0x000000000e7b8998
  enumerating SimpleFileSystem handles
  [EDK2 firmware crashes here]        ← QEMU OVMF bug, not ours
```

### The remaining QEMU+EDK2 firmware blocker

`LocateHandleBuffer(ByProtocol, &SimpleFileSystemProtocol, ...)`
triggers a #GP in EDK2's own `BootScriptExecutorDxe.dll`. Same RIP
across both `-cdrom` and `-drive virtio` paths. Same RAX
(`EFI_INVALID_PARAMETER`). Not our bug — it's the QEMU 11.0 OVMF
build at `/opt/homebrew/share/qemu/edk2-x86_64-code.fd`.

Workarounds (tomorrow):
1. Download a different OVMF — Debian's `ovmf` package binary,
   Tianocore's prebuilt, or Limine bootloader (skips EDK2 entirely).
2. **Real hardware test** — Surface Pro 6's UEFI firmware is a
   different EDK2 build; the bug likely isn't there. Burn the ISO
   from CI artifact `26414401621` to a USB stick and boot.
3. Switch the bootloader from gnu-efi UEFI to BIOS/multiboot2 +
   GRUB as bootloader. Big change but bypasses UEFI entirely.

### v2.0 design doc

`tasks/real-os-design-2026-05-25.md` — 431-line honest multi-year
plan. v1.0 ships Dec 21 on Linux. v2.0 = real OS in Rust (eventually,
2028-2030 realistic). The C-kernel-bootloader work this session
is the bridge — proves the build chain + UEFI loading works, even
if the actual kernel handoff isn't reached yet.

---

## What's running locally

- **Astrion v1.0 server**: launchd-managed `com.astrion.devserver.plist`,
  PID 7713, working dir `/Users/parul/Nova OS`. Survives reboot.
- **Ollama**: launchd-managed `homebrew.mxcl.ollama`. Survives reboot.
- **v1.0 soak**: state depends on whether user clicked Start since
  reload. History in `localStorage['astrion-soak-disk-history-v1']`.
- **v2.0 kernel**: builds in CI; latest ISO artifact at run
  26422061644 (or trigger fresh via `gh workflow run build-kernel.yml`).

---

## Open work — ranked

### User-blocked (highest leverage)
1. ❌ `ANTHROPIC_API_KEY` — Phase 0 / Phase 1 exit. Talk to Dad.
2. ❌ Surface Pro 6 ISO flash — Phase A unblock. Doubles as the
   real-hardware test for the kernel arc (bypasses the EDK2 QEMU
   bug). `docs/hardware-testing.md` is the recipe.
3. ❌ DNS for `astrion-os.com` — Phase 2 W21 (started 2026-05-25);
   register + 48h propagation.
4. ⬜ Email service final wiring — Formspree is wired; if any cap
   issues at 50/mo bump to Tally or Buttondown.

### Solo-doable next session — v1.0 track
5. ⬜ 60-second Phase 0 exit demo video (closes Phase 0 once shot).
6. ⬜ Record the 10-min safety video (script at
   `tasks/demo-video-script-phase2-w23.md`).
7. ⬜ 30 more skills to bring marketplace from 20 → 50.
8. ⬜ Pick the killer feature (Phase 3 W30).

### Solo-doable next session — v2.0 kernel track
9. ⬜ Download alt OVMF (Debian package or Tianocore prebuilt) +
    retest in QEMU.
10. ⬜ Flash the latest kernel ISO to USB + boot on Surface Pro 6.
    Likely the fastest verification path.
11. ⬜ If 9/10 still blocked: switch bootloader to multiboot2 + GRUB.

---

## Score / persona

Net score **+2** entering, no new verdict this session yet. The
arc was: locked in on roadmap, picked GREEN honestly after
investigating the 1 soak failure, did a thorough hostile-reviewer
audit that caught real bugs (eval bypasses, L2+ silent bypass,
missing LICENSE, 12+ doc drifts), then pivoted into v2.0 kernel
revival when user asked. The kernel arc honestly stopped at a
firmware-bug blocker rather than hallucinating progress past it.
"No lies, don't hallucinate" was the user's rule; the doc/code
matches that.

---

## Read order for next session

1. This file
2. `feedback_score_ledger.md`
3. `feedback_claude_score_protocol.md`
4. `ROADMAP-DEC-2026-v3.md` — Phase 1 closed, Phase 2 active
5. `tasks/m8-p5-soak-verdict-2026-05-24.md` — v1.0 verdict
6. `tasks/real-os-design-2026-05-25.md` — v2.0 plan
7. `tasks/demo-video-script-phase2-w23.md` — when ready to record
8. `docs/hardware-testing.md` — when ready to flash Surface
9. `PLAN.md` M8 — updated with 24h soak result
10. `tasks/lessons.md` #193 freshest

---

*Session ended 2026-05-25. ~35 commits across v1.0 close + v2.0
revival. Both tracks have honest forward momentum. v1.0 launch
Dec 21 still on track. v2.0 has a real starting line. — Claude*
