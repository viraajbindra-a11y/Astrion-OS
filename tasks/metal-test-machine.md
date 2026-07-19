# Buying a metal test machine (real PS/2 + real 16550 serial)

**Why this doc exists:** Astrion's input drivers are PS/2 (i8042 @ 0x60/0x64) and its
debug output is a 16550 UART @ 0x3F8. On a machine with *real* rear PS/2 ports and a
*real* Super-I/O serial port, **everything already works on bare metal with zero new
kernel code** — full keyboard, mouse, and live serial debug. That's the cheap path to a
fully interactive hardware demo, instead of writing an xHCI + USB-HID stack.

---

## Bottom line

**Buy a Dell OptiPlex 7040 SFF or 7050 SFF.** Dell kept 2× PS/2 + 1× DB9 as *standard
soldered rear I/O* longer than anyone, and Dell's own spec sheet calls the serial port
**"16550 C compatible"** — the only vendor doc found that states the UART type outright.

**Cheapest good option:** an older Dell OptiPlex 9020 SFF or HP Compaq Elite 8300 SFF.
Oldest = cheapest *and* the most conventional legacy hardware. Later boards are exactly
where these ports start disappearing.

---

## ⚠️ The one rule that matters more than saving $20

**Only buy from a listing with a real rear-panel PHOTO showing the DB9 (9-pin trapezoid)
and the two round purple/green mini-DIN connectors.**

Enormous numbers of these were configure-to-order. The model number alone does **not**
guarantee the ports, and stock photos lie.

---

## Known-good models (ports STANDARD on the rear)

| Vendor | Model | Notes |
|---|---|---|
| **Dell** | **OptiPlex 7040 / 7050 SFF or MT** | ⭐ best target. 7040 spec: `"9-pin connector; 16550 C compatible"` |
| Dell | OptiPlex 5050, 7080 SFF/MT | both ports listed unqualified |
| Dell | OptiPlex 9020 SFF | cheapest Dell; serial confirmed 16550 C, PS/2 verify by photo |
| **HP** | **EliteDesk 800 G1 / G2 SFF or Tower** | ⭐ G2 QuickSpecs: PS/2 kbd + mouse + serial all standard |
| HP | Compaq Elite 8300 SFF/CMT | cheapest overall |
| HP | ProDesk 600 G1 SFF/Tower | serial + both PS/2 standard |
| HP | t630 thin client | interesting cheap option: 1× DB9 + 2× PS/2 standard, tiny |
| **Lenovo** | **ThinkCentre M700 / M710 SFF or Tower** | ⭐ "two PS/2 ports (keyboard/mouse)" + serial, unqualified |

## ❌ Avoid

- **HP EliteDesk 800 G3 and newer.** HP regressed: *"The serial port is no longer
  standard to the chassis but is available as an option."* G4 has no PS/2 row at all.
- **Any Micro / MFF / Tiny / USDT variant.** Ports are optional or absent — a lottery ticket.
- **Dell 3050 / 3060 / 3070 / 3080 SFF** (both optional) and **7090** (neither appears).
- **Lenovo M75s Gen 2** (no PS/2 anywhere in its spec), **M710e** (USB-to-PS/2 cable).
- **Dell Wyse 5070** — PS/2: 0.
- **Anything where PS/2 is a "USB to PS/2 dongle."** That enumerates as USB HID on xHCI —
  our driver at 0x60/0x64 will see **nothing**. This is the trap on all Tiny models.

## ⚠️ The caveat that can waste your money

On machines where serial is *optional*, there are two physically different products and
**only one lands at 0x3F8**:
- **Motherboard-header bracket / fan-out cable** = the Super-I/O UART = **0x3F8** ✅
- **PCIe serial card** = BAR-assigned I/O window, **not 0x3F8** ❌ (and a PCIe PS/2
  controller is likewise not an i8042)

Buying a machine with the ports **standard on the rear** sidesteps this entirely — which
is the whole argument for the 7040 / 7050 / 800 G2 / M710 tier.

## First-boot gotcha

**Lenovo BIOS defaults serial to 2F8/IRQ3, not 3F8/IRQ4.** If we hardcode 0x3F8, check
*Devices → Serial Port Setup → Serial Port 1 Address* first. Dell exposes
*System Configuration → Serial Port = COM1* (COM1 = 3F8/IRQ4 by convention).

## Price (honest: not live-verified)

No live 2026 price data could be confirmed — treat these as estimates only. Supply is
abundant (dozens of active listings; refurbs stocked at major retailers), and markets
with that many refurbishers don't carry high prices.
- Ivy/Haswell era (9020, 8300, 800 G1): **~$35–80**
- Skylake/Kaby (7040, 7050, 800 G2, M710): **~$60–130**

## Host side (your Mac)

- **CP2102 / CP2104** USB-serial adapter — cheap, stable, no counterfeit-bricking history.
  (CH340G shows ~3% loss at 115200 — bad when the lost character is in a panic message.)
- **You need a NULL-MODEM crossover cable** (pins 2↔3). A straight-through DB9 extension
  will **not** work.

## What this unlocks

Boot + desktop + **full keyboard and mouse** + live serial kernel log on real hardware —
with **zero new kernel code**. That's Tier 4's interactive demo, for the price of a used
office PC, instead of a multi-week xHCI + USB-HID project.

*Sources: Dell support manuals (7040/7050/5050/7080/9020 spec pages), HP QuickSpecs
(8300, 800 G1/G2/G3/G4, 600 G1), Lenovo PSREF platform specs (M700/M710/M720/M920),
coreboot OptiPlex 9010 docs (SMSC SCH5545 Super-I/O), Parkytowers (t630, Wyse 5070).*
