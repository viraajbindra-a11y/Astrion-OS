# Your checklist — things only you can do (Jul 18 → Aug 31)

Plan: **rest of July = design + features** (my work) · **August = real hardware**
(needs you) · **Aug 31 = public beta**.

Everything below is blocked on you — a purchase, a physical machine, or a
decision I shouldn't make on your behalf. Claude handles everything else.

---

## 🔴 THIS WEEK — the hard blocker

### 1. Order the test machine — **by Wed Jul 22** · ~$60–130
August is hardware month. **You cannot test on a box that hasn't arrived**, and
used office PCs ship slowly. Order this week → it's on your desk Aug 1. Order it
Aug 1 → you lose a week of your only hardware month.

**Buy:** Dell OptiPlex **7040** or **7050 SFF** (best). Also fine: HP EliteDesk
800 **G1/G2** SFF/Tower, Lenovo ThinkCentre **M700/M710**, HP Compaq Elite **8300
SFF** (cheapest).

**⚠️ The one rule:** only buy from a listing with a **real rear-panel photo**
showing the **DB9 (9-pin trapezoid)** *and* **two round purple/green connectors**.
These were built-to-order — the model number alone does not guarantee the ports,
and stock photos lie.

**Do NOT buy:** anything labeled Micro / Tiny / MFF / USDT (ports are optional or
fake — a "USB-to-PS/2 dongle" is useless to us), or HP EliteDesk **G3 or newer**
(HP dropped the standard serial port).

*Why this machine: it has real PS/2 + a real 16550 serial port, so Astrion's
existing drivers give you full keyboard, mouse and live debug output on bare metal
with zero new code. Full detail in `tasks/metal-test-machine.md`.*

### 2. Order the serial gear — **by Fri Jul 25** · ~$15
- A **CP2102** or **CP2104** USB-to-serial adapter (avoid the cheap CH340G).
- A **null-modem / crossover** DB9 cable. **A straight-through extension will not
  work** — this is the #1 thing people get wrong.

### 3. A USB stick — **by Fri Jul 25** · ~$5 (or one you already own)
Any size ≥ 64 MB. **It gets completely erased.**

---

## 🟡 AUGUST — hardware month

### 4. Flash the USB + first boot — **Aug 1–3**
Use **balenaEtcher** (it won't let you pick your own hard drive — much safer than
`dd`). Steps in `tasks/TIER4-usb-boot.md`.

On the target machine, in BIOS:
- **Turn Secure Boot OFF** (our bootloader isn't signed with Microsoft's key).
- You do **not** need Legacy/CSM — the ISO boots UEFI too.
- **Lenovo only:** check *Devices → Serial Port Setup*. It often defaults to
  `2F8/IRQ3`; we expect `3F8/IRQ4`.

### 5. Tell me what happened — **same day as #4**
Especially: did it boot to the desktop, and **does the keyboard type?** If
anything fails, the serial log is the evidence — that's what the cable is for.
Expect to iterate; most hardware bugs are invisible in emulation.

### 6. Take the photo/video — **when it boots** · 5 min
Astrion running on a real machine, with the screen and the actual box in frame.
This is the single most convincing asset you own, and it does not exist yet.

---

## 🟢 DECISIONS — only you can authorize

### 7. Green-light going public — **by Fri Aug 15**
Three things I will **not** do without your word, because they're public and carry
your name:
- Cut a **GitHub Release** with the bootable ISO attached (right now there is no
  link a stranger can click — your newest release is from June 5 and predates all
  of this).
- **Rewrite the README** to lead with the from-scratch kernel.
- **Fix `deploy.yml`** so kernel commits stop republishing the old desktop app to
  astrion-os.com.

Say go and I'll draft all three and show you before anything ships. ~half a day.

### 8. Live demo or recorded? — **by Mon Aug 24**
The 4-beat demo is ~80 seconds (`tasks/demo-2026-07-17/DEMO-SCRIPT.md`). Decide
whether you present it live or play `demo.gif`. If live: **practice twice**, and
close the Assistant with Esc before the ring-3 beat (it's in the script).

---

## Deadline summary

| When | What | Cost |
|---|---|---|
| **Wed Jul 22** | Order the test machine | $60–130 |
| **Fri Jul 25** | Serial adapter + null-modem cable + USB stick | ~$20 |
| **Aug 1–3** | Flash USB, first metal boot, Secure Boot off | — |
| **Aug 1–7** | Report results + take the photo | — |
| **Fri Aug 15** | Green-light release / README / deploy fix | — |
| **Mon Aug 24** | Live vs recorded demo + practice | — |
| **Aug 31** | Public beta launch | — |

**If you only do one thing this week: order the machine.** Everything in August
depends on it and nothing else on this list is time-critical yet.
