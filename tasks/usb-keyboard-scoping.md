# Scoping: a working keyboard on real modern hardware

**Date:** 2026-07-18 · **Status:** decision document · **Scope:** research only, no code written

---

## Bottom line

**Do not start an xHCI driver. Build serial-console keyboard input instead — it is 1–3 hours of
work against plumbing we already have, and it is the single most reliable input path that exists
for a kernel like ours.** The research turned up one fact that inverts the whole question: on a
modern machine, the firmware is *already* giving us a working USB keyboard through SMM-based i8042
emulation, and the xHCI spec requires a driver to take ownership of the controller from the BIOS
before it can use it (the "HC BIOS Owned Semaphore" handoff, [xHCI 1.2b §7.1.1](https://cdrdv2-public.intel.com/625472/625472_xHCI_Rev1_2b.pdf)).
The instant we do that, the firmware stops emulating and the keyboard we already had goes dead.
So a *half-finished* xHCI driver is not partial progress — it is a straight regression on the exact
machines we are trying to support. And "finished" is not close: the honest range from real hobby-OS
history is **6–12 weeks to type a character in QEMU, then 1.5–3× that again to make it work on one
real machine** — Managarm's clean run was 23 weeks, SanderR spent 3 years solo and never got there,
and klange (ToaruOS, 15 years of OS experience) worked xHCI for nine months, gave up, and shipped
`INT 16h` instead. Serial input gets us genuine interactive typing on metal this week, and doubles
as the kernel debugger we will need for *every* hardware bug after this one. Recommended sequence:
**run the free CSM/legacy-emulation experiment (0 code), build serial RX (M1–M4 below), and buy one
motherboard with a real PS/2 port and a COM header so every fallback lives on one machine.**

---

## The fact that decides this

Three things are true at once, and together they settle the question:

1. **SMM legacy emulation survives the OS handoff.** The i8042 emulation is implemented in System
   Management Mode — SMI handlers installed by firmware. SMM is orthogonal to UEFI boot services;
   `ExitBootServices()` does not tear it down. The proof is in the Linux kernel's own docs: the
   documented failure mode is that "the SMM BIOS isn't expecting the CPU to be in 64-bit mode," and
   the workaround is `idle=poll` to stop the CPU entering SMM while idle. Both statements only make
   sense if the emulation is still firing *under a fully booted 64-bit OS*.
   ([kernel.org: USB Legacy support](https://docs.kernel.org/arch/x86/usb-legacy-support.html))

2. **Taking the xHC away from the BIOS is what kills it.** xHCI defines a USB Legacy Support
   Extended Capability with an HC BIOS Owned Semaphore (bit 16) and an HC OS Owned Semaphore
   (bit 24). The OS sets its bit, waits for the BIOS to clear its own, and from that moment the
   firmware stops servicing the controller — including the keyboard emulation. This is exactly what
   the "XHCI Hand-off" switch in BIOS setup refers to. EHCI has the identical mechanism in its
   USBLEGSUP register. ([xHCI 1.2b §7.1.1](https://cdrdv2-public.intel.com/625472/625472_xHCI_Rev1_2b.pdf),
   [EHCI spec](https://www.intel.com/content/dam/www/public/us/en/documents/technical-specifications/ehci-specification-for-usb.pdf))

3. **Skipping the handoff is not an option.** Managarm's driver worked in QEMU for five months and
   failed on metal partly *because* it got this handoff wrong; the fix is in commit
   [`36e4044`](https://github.com/managarm/managarm/commit/36e404434836b63fceecc2594717a46683877500),
   literally titled `hcds/xhci: make driver work on real hardware`. QEMU has no BIOS holding the
   controller, so the bug is invisible in emulation.

**Conclusion:** the first day we touch xHCI on real hardware, we lose the keyboard, and we do not
get it back until the whole driver works. There is no incremental path. This is the strongest
possible argument for not starting.

---

## Q1 — How reliable is BIOS/UEFI USB legacy support?

**Short answer: it is real, it does survive the OS taking over, and it is still a coin flip —
because the coin is flipped by the firmware's *settings*, not by anything we do.**

### When it works

- The emulation runs in SMM and keeps running after our kernel boots (see above). Machines where
  it is present and enabled will happily feed a USB keyboard into ports 0x60/0x64 indefinitely.
- **Laptop internal keyboards are the reliable case.** On the large majority of x86 laptops the
  embedded controller presents the built-in keyboard on a genuine i8042 at 0x60/0x64 — no emulation
  involved, no USB in the path. Note the common misconception: the *touchpad* migrating to I2C-HID
  on modern laptops does **not** mean the keyboard moved with it. On most machines the keyboard
  stayed on i8042.
- **Two distinct BIOS settings, and the difference matters.** "USB Legacy Support" pumps USB data
  into a *real* KBC; "Port 60h/64h Emulation" is full SMM emulation of the i8042 itself for systems
  that have no physical KBC. The second one is what makes a USB keyboard visible to a bare-metal
  i8042 driver. If a setup menu offers both, we want both on.
  ([VOGONS discussion](https://www.vogons.org/viewtopic.php?t=74073))

### When it stops

- **We turn it off ourselves** by doing the xHCI/EHCI ownership handoff. This is the main one, and
  it is under our control: don't touch the controller, don't lose the keyboard.
- **UEFI Class 3 machines never had it.** Boards shipping without a CSM — increasingly the default
  on AM5 and Intel 13th/14th-gen and later — have dropped the legacy compatibility layer entirely,
  and with it the 60h/64h emulation option. On those machines the pre-boot USB keyboard is served by
  UEFI DXE drivers through `EFI_SIMPLE_TEXT_INPUT_PROTOCOL`, which is a **boot** service and dies at
  `ExitBootServices()` — and was never i8042 to begin with. An i8042-only kernel gets nothing.
- **It is flaky even when present.** OSDev's own guidance is that the emulation "doesn't function
  very well if you try to change any of the defaults." Practical implication: if we lean on it, use
  a *minimal* init path — read 0x60 on IRQ1 and little else. The more of the standard i8042 init
  sequence we run, the more likely we knock the emulation over. Our `kernel/src/kbd.c` is already
  close to this (it reads 0x60 on IRQ1 and does not do a full controller bring-up), which is
  fortunate.
- **`ExitBootServices` is a red herring** for the SMM path but decisive for the UEFI path. It does
  not kill SMM emulation. It absolutely does kill UEFI console input. Since we boot via
  GRUB/multiboot2 — and GRUB calls `ExitBootServices` itself before our kernel runs — the UEFI input
  path is unavailable to us regardless.

### Is "rely on emulation + pick the right machine" a legitimate demo strategy?

**Yes, with one qualifier: pick the machine deliberately, and verify it before demo day.** This is
not a coin flip if we choose the hardware; it is a coin flip only if we walk up to a random machine.
The selection rule that came out of the research:

> A business-class x86 laptop (ThinkPad / Latitude / EliteBook), pre-2022, Intel or AMD, whose BIOS
> still offers CSM. Use its **built-in** keyboard, not a USB one.

Definitely excluded: Microsoft Surface (Surface Aggregator / `surface_hid`), Apple T2 Macs (keyboard
on SPI via `applespi`), Apple Silicon, and ARM Windows laptops. Verification is cheap — boot any
Linux live USB on the candidate and check:

```
dmesg | grep -i i8042
ls /sys/bus/serio/devices
cat /proc/bus/input/devices
```

Detecting this from our own kernel is less reliable: the FADT `IA-PC Boot Architecture Flags` bit 1
("8042 present," offset 109, FADT revision ≥ 2) exists but OSDev flags it as
[unreliable](https://wiki.osdev.org/I8042_PS/2_Controller); the robust method is walking the ACPI
namespace for `PNP0303`/`PNP0F13`, which needs an AML interpreter we do not have. Same page carries a
real warning: on some machines the i8042 does not exist and *touching it can crash the system*.

---

## Q2 — What is the actual minimum USB stack for a keyboard?

### Path comparison

| Path | Works on modern metal? | Verdict |
|---|---|---|
| **xHCI + HID boot protocol** | Yes — this is what modern machines expose | The only USB path that is actually worth building. Also the most expensive thing on this page. |
| **EHCI / UHCI / OHCI only** | **No** | Dead end. Post-2015 machines route ports to the xHC; the EHCI companion controllers are gone or unpopulated on Skylake-and-later chipsets. Cheaper to write, buys nothing on the hardware we care about. Not a stepping stone either — xHCI's model (contexts, rings, TRBs, doorbells) shares almost nothing with the older frame-list controllers. rdos, who has all four: *"Especially XHCI is quite different from UHCI, OHCI and EHCI."* |
| **HID boot protocol vs. full report-descriptor parsing** | — | Boot protocol is a genuine and large saving, but it saves the *cheap* part. See below. |

### On the boot protocol specifically

The boot protocol is worth using — it is the simplified interface the BIOS itself uses, it is a
fixed 8-byte report (1 modifier byte, 1 reserved, 6 keycodes), and it removes report-descriptor
parsing entirely. Setup is three class requests: `SET_PROTOCOL(0)` to select boot mode, `SET_IDLE`,
then poll the interrupt IN endpoint.
([OSDev: USB HID](https://wiki.osdev.org/USB_Human_Interface_Devices),
[HID 1.11 spec](https://www.usb.org/sites/default/files/documents/hid1_11.pdf))

**But this is not where the cost is.** From the effort decomposition across all the projects
surveyed:

| Piece | Share of effort |
|---|---|
| xHCI controller bring-up — BIOS handoff, reset, DCBAA, scratchpad buffers, command ring, event ring + ERST, doorbells, interrupter | **~55%** |
| Port enumeration, reset, speed detection, USB2/USB3 port pairing | ~15% |
| Slot management — Enable Slot, Address Device, input context, EP0 control transfers, descriptors | ~15% |
| Configure Endpoint + interrupt IN endpoint | ~10% |
| **HID boot protocol** — SET_PROTOCOL, SET_IDLE, poll 8 bytes, map keycodes | **~5%** |

One developer (prajwal, [OSDev t=32133](https://forum.osdev.org/viewtopic.php?t=32133)) went from a
working xHCI stack to a smoothly-typing keyboard in **three days** — and his bug was in the endpoint
context (Interval / Max ESIT Payload / Max Burst Size), not in HID at all. **The keyboard is not the
hard part. The host controller is ~85% of the job, and most of that is bugs QEMU physically cannot
show you.**

### Concrete steps for xHCI, with our kernel's actual gaps marked

| # | Step | Difficulty | Our status |
|---|---|---|---|
| 1 | PCI enumeration to find class 0C/03/30 | Easy | ❌ **We have no PCI code at all.** Not one line. Prerequisite, ~1–2 days. |
| 2 | Read BAR0/1 (64-bit MMIO), map it uncached into the page tables | Easy–medium | ⚠️ Paging exists (`vmspace.c`), but we need a non-cacheable mapping path. |
| 3 | DMA-capable physical allocation, 64-byte aligned, known physical address | Easy | ✅ `pmm.c` can do this. |
| 4 | **USB Legacy Support handoff** — claim ownership from BIOS | Medium | ❌ **This is the step that kills our keyboard.** Invisible in QEMU. |
| 5 | Controller reset; read HCSPARAMS1/2/3 and HCCPARAMS1 | Medium | ❌ Gotcha: `HCCPARAMS1.CSZ` selects 32- vs 64-byte contexts. QEMU=32, Bochs=64, real hardware is both. Hardcoding it is the classic bug — it cost Haiku six years. |
| 6 | Scratchpad buffers from HCSPARAMS2 | Medium | ❌ **QEMU requests zero.** Real controllers request many and silently do nothing without them. Cost Managarm and SanderR weeks each. |
| 7 | DCBAA, command ring, event ring + ERST, doorbell array | Hard | ❌ The core of the driver. Cycle-bit semantics differ between QEMU and Bochs. |
| 8 | Interrupts: MSI/MSI-X, or INTx routed via ACPI `_PRT` | Hard | ❌ **We have only the legacy 8259 PIC** (`idt.c`) — no APIC, no MSI. And `acpi.c` is RSDP/FADT-for-S5 only, no AML interpreter, so `_PRT` routing is out of reach. Polling is the escape hatch (Redox's `xhcid` polls; SerenityOS added "fall back to polling if no interrupter was created") but it is another prerequisite gap. |
| 9 | Port enumeration, reset, speed detection, USB2/USB3 pairing | Hard | ❌ Chipset quirks live here — Intel parts need `USB3_PSSEN` (0xd0) and `XUSB2PR` (0xd8) written or every port reads empty. |
| 10 | Enable Slot → input context → Address Device → EP0 control transfers | Hard | ❌ Timing-sensitive on metal, not in emulation. |
| 11 | Configure Endpoint for the interrupt IN endpoint | Medium–hard | ❌ Where dropped-keystroke bugs live. |
| 12 | HID boot protocol + keycode → our ring buffer | **Easy** | ✅ Injection point already exists: `rb_push()` in `kernel/src/kbd.c`. |

**Steps 1 and 8 are prerequisites we do not have at all.** Every effort estimate in the next section
assumes a kernel with working PCI enumeration and working MSI or IRQ routing. We would be adding
that work *before* the clock even starts.

**The genuinely hard parts**, stated plainly: the BIOS handoff (invisible in QEMU), scratchpad
buffers (invisible in QEMU), context size 32-vs-64 (invisible in QEMU), cache-coherency and memory
ordering on DMA rings (invisible in QEMU), interrupt routing (invisible in QEMU), chipset port
routing (invisible in QEMU), and endpoint bandwidth fields (largely ignored by QEMU). The pattern
is not subtle. **Passing in QEMU tells you almost nothing about whether this works.**

---

## Q3 — What other hobby OSes actually did, and how long it took

Every row here is from git history, release notes, or the developer's own words. All cited.

| Project | Who | Timeline | Outcome |
|---|---|---|---|
| **Managarm** | Kacper Słomiński | xHCI start 2019-08-23 → interrupt endpoints 2019-09-29 (**5.5 wks**) → `make driver work on real hardware` 2020-02-01 (**23 wks total**) | ✅ Best case in the dataset. Final "works on metal" diff: **+77/−62 in one file** — BIOS handoff, scratchpad count, endpoint setup. Commit body: *"Works for me at least :^)"* |
| **SerenityOS** | Kling → Quaker762 → IdanHo → spholz | First USB commit 2020-09-04 → xHCI merged 2024-07-26 → USB keyboard 2025-03-24. **~4.5 years.** | ✅ IdanHo's minimal xHCI was 3 weeks / 3,325 lines — *on a USB core layer the project had spent 3 years building*. **48 commits to fix it after merge** (14 in 2024, 25 in 2025, 9 in 2026 so far). `xHCIController.cpp` is now 87 KB. |
| **ToaruOS** | klange | xHCI start 2021-07-14 → last functional xHCI commit 2022-04-10 → **abandoned** | ❌ **The cautionary tale.** 15 years running his own OS, professional engineer, declared xHCI+HID a 2.1 release blocker, worked it ~9 months, shipped **BIOS `INT 16h` in the bootloader** instead. `modules/xhci.c` is 459 lines and has not moved in 4 years. As of v2.3.2 (2026-05-12) the entire input inventory is `ps2hid.c` + a stub. |
| **Haiku** | Chiang → korli → waddlesplash | Skeleton 2011-03-30 → on by default 2016-07-25 (**5.3 yrs**) → most bugs fixed 2019-03 (**8 yrs**) | ⚠️ A *team*, over 8 years. korli, 2012: *"Understanding the miscellaneous structures for contexts, rings and such took me a lot of time."* Shipped behind a 2-device whitelist for a year first. |
| **Redox** | Jeremy Soller et al. | `WIP: XHCI` 2017-01-10 → USB HID 2024-04-30. **7 yrs 4 mo.** | ⚠️ Driver was *disabled twice in its first year* for deadlocks and lockups. Hubs still problematic; `xhcid` polls rather than using interrupts. |
| **SanderR** (SanderOSUSB) | solo hobbyist | Started ~2018-11 → *"working on my XHCI driver for half a year"* (2020-01) → emulators-only 2020-04 → still broken on metal 2021-04 → repo dead 2022-05 | ❌ **Closest analogue to us: one person, from-scratch C kernel.** README's own support matrix: `XHCI — Real hardware: 🐛 partly working`, `USB HID Keyboard — Real hardware: ❓ unknown`. **~1 year to emulators, 2 more years on metal, never finished.** |
| **KolibriOS** | — | Has UHCI/OHCI/EHCI, [no xHCI](https://habr.com/ru/companies/kolibrios/articles/181586/) | Chose not to. |

### Honest effort estimate

Assuming a solo dev with paging, a DMA-capable physical allocator, **PCI enumeration, MSI or working
IRQ routing**, and a serial console already in place — note we are missing two of those:

- **Typing in QEMU:** 6–12 weeks focused. Optimistic floor 3–4 weeks, but only for people standing
  on a USB core layer their project already spent 1–3 years building. Solo-from-scratch comparable
  (SanderR): **~1 year.**
- **Typing on one real machine we own:** add **1.5–3×** the QEMU time. Managarm's clean run was 5
  extra weeks past "announced working." SanderR never closed it.
- **Typing on most machines:** **no solo hobby project in this dataset has achieved this.** Every
  project that got there had multiple contributors and multi-year timelines.

**For us, evenings-and-weekends, missing the PCI and interrupt-routing prerequisites: a working
USB keyboard on real metal is a 3–6 month project with a real chance of never landing.** That is
not pessimism, it is the median outcome in the table above.

The counterpoint deserves airing. Quaker762: *"Most people seem to have the misconception that
writing a USBD/Host Controller stack is extraordinarily difficult, but imho the biggest hurdle is
wrapping your head around how all of the structures mesh together... the amount of documentation is
somewhat astronomical and very technically meaty."* He is right that it is not conceptually deep. It
is a documentation-volume and hardware-variance problem, and those do not yield to being clever.

And the structural warning, from thewrongchristian: *"USB is like the creationists argument about
eyes... creating a USB stack seems to be all or nothing, you can't have half a USB stack."*

---

## Q4 — Shortcuts, ranked by effort vs. payoff

| # | Option | Effort | Reliability on metal | Interactive typing? |
|---|---|---|---|---|
| **1** | **CSM boot + USB Legacy + Port 60/64 emulation** | 30 min, **zero code** | Coin flip — but free | ✅ if it works |
| **2** | **Serial console RX** ← *recommended* | **1–3 h code**, ~$25 hw | **Highest of anything here** | ✅ (typed on the Mac) |
| **3** | **PS/2-port board + `ps2x2pico`** | 1–2 h, ~$15 + board | High | ✅ **on the machine itself** |
| 4 | QEMU on the laptop | Zero | Perfect, but not metal | ✅ |
| 5 | Scripted replay demo | 2–4 h | High | ❌ **does not solve the problem** |
| — | Dual-mode keyboard + passive purple adapter | 1 h + luck | Coin flip | ✅ if lucky |
| — | UEFI Simple Text Input | — | **Dead end** | — |
| — | BIOS `INT 16h` from long mode | — | **Dead end** | — |
| — | Bluetooth keyboard | — | **Dead end** | — |
| — | **Partial xHCI driver** | Weeks | **Negative — removes working input** | ❌ |

### Notes on each

**1. The free experiment.** Our ISO is already hybrid BIOS+UEFI. Boot it in **CSM/legacy mode** on a
machine that still has a CSM, with both "USB Legacy Support" and "Port 60h/64h Emulation" enabled.
Zero code, and it may simply work. Do this the day we have a candidate machine.
([CSM overview](https://en.wikipedia.org/wiki/Unified_Extensible_Firmware_Interface))

**2. Serial RX — the winner.** We already own the UART. `kernel/src/kernel_mb2.c` initialises COM1 at
0x3F8 with divisor 3 (38400 baud) and does TX. RX is the mirror image: LSR bit 0 (Data Ready) at
0x3F8+5, read RBR at 0x3F8+0.
([OSDev: Serial Ports](https://wiki.osdev.org/Serial_Ports),
[PC16550D datasheet](https://www.scs.stanford.edu/10wi-cs140/pintos/specs/pc16550d.pdf))
The physical setup is the key insight: **the USB-serial adapter goes on the Mac, not on the target.**
The target needs only a real 16550 at 0x3F8 and *no USB stack whatsoever*. Cable must be null-modem
(TX/RX crossed) — simplest is a single USB-to-null-modem cable like the StarTech ICUSB232FTN. On
macOS note that Apple removed the built-in `AppleUSBFTDI` kext in Monterey, so an FTDI or CH340
vendor driver is needed, then `screen /dev/tty.usbserial-XXXX 38400`.
Free bonus: GRUB can use serial as its own terminal (`serial --unit=0` + `terminal_input serial`),
which proves the cable works before our kernel even runs.
([GNU GRUB manual](https://www.gnu.org/software/grub/manual/grub/html_node/Serial-terminal.html))
Honest caveat: the typing happens at the Mac's terminal, not at a keyboard attached to the demo
machine. That is fine as long as we say so out loud.

**3. `ps2x2pico` — best demo *feel*.** A ~$4 Raspberry Pi Pico running
[open-source firmware](https://github.com/No0ne/ps2x2pico) acts as a USB *host* for any modern USB
keyboard and presents a genuine PS/2 device to the target's PS/2 port. The keyboard needs no
dual-mode support. ~$15 with a level shifter; flashing is dragging a `.uf2` onto the Pico. Same
approach [PiKVM uses](https://pikvm.github.io/pikvm/pico_hid_bridge/). Requires the target to have a
PS/2 port — which is easy to arrange, see below.

**Passive purple adapters — do not build a demo on these.** They are wiring only (USB D+ → PS/2 CLK,
D− → DATA); the keyboard must itself contain dual-mode circuitry. A
[tested survey](https://pmortensen.eu/world2/2023/03/20/ps-2-support-on-modern-usb-keyboards/)
found it survives mostly in *cheap* keyboards (Nohro, Altar) and is absent from every premium
mechanical tested (Ducky Shine 7, Cooler Master CK550 V2). Nothing is documented; testing is the only
verification. Also a purchasing trap: nearly everything on Amazon labelled "active USB to PS/2
adapter" converts the **wrong direction** (PS/2 device → USB host) and is useless to us.

**Dead ends, confirmed:**
- **UEFI Simple Text Input** — `EFI_SIMPLE_TEXT_INPUT_PROTOCOL` is a *boot* service
  ([UEFI 2.10 §12](https://uefi.org/specs/UEFI/2.10/12_Protocols_Console_Support.html)); after
  `ExitBootServices` only [runtime services](https://uefi.org/specs/UEFI/2.10/08_Services_Runtime_Services.html)
  are callable and there is no input service among them. Moot for us anyway: GRUB calls
  `ExitBootServices` before our kernel runs.
- **BIOS `INT 16h`** — [long mode does not support virtual-8086 mode at all](https://wiki.osdev.org/Virtual_8086_Mode).
  Options are tearing down long mode per keystroke or porting an 8086 emulator. ToaruOS's BIOS calls
  happen in its *bootloader*, in real mode, before its kernel starts — that does not transfer.
- **Bluetooth** — the radio sits behind USB. Needs a USB stack *plus* a Bluetooth HID stack.

### Hardware to buy

One board unlocks options 1, 2 and 3 simultaneously: the
[ASUS PRIME H610M-E D4](https://www.asus.com/motherboards-components/motherboards/prime/prime-h610m-e-d4/techspec/)
(LGA1700) has **two dedicated PS/2 ports and a COM header**, sub-$100. The
[PRIME B650M-A II](https://www.asus.com/motherboards-components/motherboards/prime/prime-b650m-a-ii/techspec/)
(AM5) has a combo PS/2 port and a COM header. General rule: budget/business boards (ASUS PRIME, MSI
PRO, Gigabyte DS3H) keep PS/2; premium and thin boards drop it — and it is inconsistent even within a
vendor's line (the PRIME B860M-A WIFI has no PS/2), so **always check the specific model's techspec
page**. Add a ~$6 10-pin-header→DB9 bracket for the COM port.

---

## Recommended path — milestones

Small, independently verifiable, in the usual style. **M1–M4 are the whole recommendation.**
Total: one focused session.

### M0 — Free experiment (no code) · *do this first, the day a machine is available*
- Boot the existing hybrid ISO in **CSM/legacy** mode with USB Legacy Support + Port 60/64 Emulation
  enabled in setup.
- **Verify:** a USB keyboard types into the Astrion shell. Photo of the screen.
- If it works, we have metal interactivity for free — but still build M1–M4, because it will not
  reproduce on the next machine and we need the debug channel regardless.

### M1 — Serial RX, polled
- Add `serial_getchar()` to `kernel/src/kernel_mb2.c` next to the existing `serial_putc()`:
  poll LSR (0x3F8+5) bit 0, read RBR (0x3F8+0).
- Drain it once per frame from the WM loop and feed bytes into the existing keyboard ring via
  `rb_push()` in `kernel/src/kbd.c` (needs a small non-static entry point, e.g. `kbd_inject(char)`).
- **Verify in QEMU:** `-serial stdio`, type in the terminal, characters appear in the Astrion shell.
  This is a full end-to-end proof with no hardware purchase.

### M2 — Serial RX, interrupt-driven on IRQ4
- Change the IER write in `serial_init()` from `0x00` to `0x01` (Received Data Available).
- `irq_register(4, serial_isr)` + `pic_unmask_irq(4)` — both already exist in `kernel/src/idt.c`, and
  the IRQ4 vector is already installed in the IDT (`idt_set(36, irq4)`).
- ISR reads RBR and calls `kbd_inject()`.
- **Verify in QEMU:** typing still works with the polling drain removed; no dropped characters when
  typing fast.

### M3 — UART presence detection
- Use the standard 16550 loopback self-test (MCR ← 0x1E, transmit 0xAE, read it back) before
  enabling the RX path, so machines with no UART are unaffected.
- **Verify:** boots identically in QEMU with `-serial none`; no hang, no spurious input.

### M4 — Real-hardware bring-up
- Target: a board with a COM header (see above) + bracket cable; Mac side: USB-to-null-modem cable +
  vendor driver; `screen /dev/tty.usbserial-XXXX 38400`.
- Optionally add `serial --unit=0 --speed=38400` + `terminal_input serial` to the GRUB config to
  prove the cable before the kernel loads.
- **Verify:** type into `screen` on the Mac, watch the Astrion desktop respond on the target's
  monitor. **This is the Tier 4 interactive win.** Photo + short video.

### M5 (optional, demo polish) — `ps2x2pico`
- Pico + level shifter into the board's PS/2 port; any modern USB keyboard plugs into the Pico.
- **Verify:** someone unfamiliar sits at the machine and types on a normal keyboard.

### Not scheduled — xHCI
Revisit only if all three become true: (a) Astrion needs USB for something beyond keyboards
(storage, real device support), (b) we have PCI enumeration and MSI or ACPI `_PRT` routing for other
reasons, and (c) there is a 3+ month block of time to spend. Until then it is a strict regression on
the machines it targets.

---

## Sources

**Legacy emulation / handoff**
[kernel.org: USB Legacy support](https://docs.kernel.org/arch/x86/usb-legacy-support.html) ·
[xHCI 1.2b spec (§7.1.1)](https://cdrdv2-public.intel.com/625472/625472_xHCI_Rev1_2b.pdf) ·
[EHCI spec](https://www.intel.com/content/dam/www/public/us/en/documents/technical-specifications/ehci-specification-for-usb.pdf) ·
[managarm commit 36e4044](https://github.com/managarm/managarm/commit/36e404434836b63fceecc2594717a46683877500) ·
[VOGONS: USB Legacy vs Port 60/64](https://www.vogons.org/viewtopic.php?t=74073) ·
[UEFI 2.10 §12 Console Support](https://uefi.org/specs/UEFI/2.10/12_Protocols_Console_Support.html) ·
[UEFI 2.10 §8 Runtime Services](https://uefi.org/specs/UEFI/2.10/08_Services_Runtime_Services.html) ·
[Wikipedia: UEFI / CSM removal](https://en.wikipedia.org/wiki/Unified_Extensible_Firmware_Interface)

**USB / xHCI / HID technical**
[OSDev: xHCI](https://wiki.osdev.org/XHCI) ·
[OSDev: USB HID](https://wiki.osdev.org/USB_Human_Interface_Devices) ·
[OSDev: Universal Serial Bus](https://wiki.osdev.org/Universal_Serial_Bus) ·
[OSDev: I8042 PS/2 Controller](https://wiki.osdev.org/I8042_PS/2_Controller) ·
[USB HID 1.11 spec](https://www.usb.org/sites/default/files/documents/hid1_11.pdf) ·
[OSDev: Virtual 8086 Mode](https://wiki.osdev.org/Virtual_8086_Mode)

**Hobby-OS timelines**
[SerenityOS PR #24440 (xHCI)](https://github.com/SerenityOS/serenity/pull/24440) ·
[PR #25809 (USB kbd/mouse)](https://github.com/SerenityOS/serenity/pull/25809) ·
[quaker762: Serenity USB stack](https://quaker762.github.io/Serenity-USB/) ·
[ToaruOS 2.0 roadmap](https://toaruos.org/toaruos-20-and-the-long-term-roadmap.html) ·
[ToaruOS v2.1.0 notes](https://github.com/klange/toaruos/releases/tag/v2.1.0) ·
[Managarm 2019 year-end](https://managarm.org/2019/12/24/end-of-year.html) ·
[Haiku: korli 2012](https://www.haiku-os.org/blog/korli/2012-05-01_work_progress_xhci_driver/) ·
[Haiku: waddlesplash 2019](https://www.haiku-os.org/blog/waddlesplash/2019-03-08_most_long-standing_xhci_usb3_issues_resolved/) ·
[Redox April 2024](https://www.redox-os.org/news/this-month-240430/) ·
[AdeRegt/SanderOSUSB](https://github.com/AdeRegt/SanderOSUSB) ·
[KolibriOS USB (habr)](https://habr.com/ru/companies/kolibrios/articles/181586/) ·
OSDev threads
[50723](https://forum.osdev.org/viewtopic.php?t=50723),
[32133](https://forum.osdev.org/viewtopic.php?t=32133),
[36476](https://forum.osdev.org/viewtopic.php?t=36476),
[36645](https://forum.osdev.org/viewtopic.php?t=36645),
[39725](https://forum.osdev.org/viewtopic.php?t=39725),
[42614](https://forum.osdev.org/viewtopic.php?t=42614),
[54593](https://forum.osdev.org/viewtopic.php?t=54593)

**Shortcuts / hardware**
[OSDev: Serial Ports](https://wiki.osdev.org/Serial_Ports) ·
[PC16550D datasheet](https://www.scs.stanford.edu/10wi-cs140/pintos/specs/pc16550d.pdf) ·
[GRUB serial terminal](https://www.gnu.org/software/grub/manual/grub/html_node/Serial-terminal.html) ·
[No0ne/ps2x2pico](https://github.com/No0ne/ps2x2pico) ·
[PiKVM Pico HID bridge](https://pikvm.github.io/pikvm/pico_hid_bridge/) ·
[PS/2 support on modern USB keyboards (tested survey)](https://pmortensen.eu/world2/2023/03/20/ps-2-support-on-modern-usb-keyboards/) ·
[Wikipedia: PS/2 port](https://en.wikipedia.org/wiki/PS/2_port) ·
[ASUS PRIME H610M-E D4](https://www.asus.com/motherboards-components/motherboards/prime/prime-h610m-e-d4/techspec/) ·
[ASUS PRIME B650M-A II](https://www.asus.com/motherboards-components/motherboards/prime/prime-b650m-a-ii/techspec/) ·
[StarTech ICUSB232FTN](https://www.startech.com/en-us/cards-adapters/icusb232ftn) ·
[sdomi: SerenityOS on real hardware](https://sdomi.pl/weblog/23-serenityos-realhw/)
