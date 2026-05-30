# Astrion v2.0 — Real-OS design doc (2026-05-25)

**This is the v2.0 north star, not v1.0 work.** Written under the
"no lies, no hallucination" rule. Every number and timeline below
is honest. If the math doesn't fit, the doc says so.

---

## 0. The honest assessment of current Astrion

Before designing v2.0, accept what v1.0 is.

**v1.0 Astrion is not a real OS in the kernel-engineering sense.**
The README + landing page have called it one since v0.1. That's
marketing framing the substrate has lived with for months. It's
honest in the *user-facing* sense ("the thing you boot from a USB
stick that acts like a desktop") but not in the *strict CS-textbook*
sense ("a program that manages hardware and exposes syscalls").

What v1.0 actually is:
- A **web app** (HTML/CSS/JS, ~30k lines) that renders as a desktop
- A **Node.js server** (`server/index.js`, ~1900 lines) hosting the
  web app + system endpoints (`/api/files/write`, `/api/ai/ollama`,
  `/api/system/selfmod-status`, etc.)
- A **Linux Live ISO** that boots GRUB → Linux kernel → WebKitGTK
  fullscreen → the web app
- A **C shell** (`distro/nova-renderer/nova-shell.c`, ~4068 lines)
  that wraps the web view in native GTK windows so the surface
  looks more native than a Chrome tab
- The "**kernel**" in `js/kernel/` is application architecture —
  intent parser, capability gates, graph store, red-team agent —
  not an OS kernel. No scheduler. No memory manager. No syscalls.
  No drivers.

The architecture is closest to **ChromeOS's model**: Linux + a
single-app shell where the shell happens to be a webview. ChromeOS
calls itself an OS in its branding too. So does Android (which is
Linux + a single-app framework). The "OS" label at user-facing
level is industry-standard; the strict CS-textbook claim is not
true for either.

**The safety substrate is real.** M4 (verifiable code gen), M5
(branch + rewind), M6 (Socratic + red-team), M8 (5+1 gate
self-mod) — these are real engineering and they live in the JS
substrate. They run on top of Linux but their correctness doesn't
depend on Linux. They would port to a real kernel; the porting is
substantive but not from-scratch.

---

## 1. What "real OS, like macOS but better" actually means

User's exact ask (paraphrased): "use straight up Chrome as the
base browser; make sure it's a real OS, no viewer BS; written in
whatever language macOS is in; look and feel like any other OS
but better."

Decoded:
- **"Real OS"** → an OS in the strict sense. Boots on bare metal.
  Has its own kernel. Manages hardware. Schedules processes.
  Provides syscalls.
- **"Whatever language macOS is in"** → macOS is a polyglot:
  - XNU kernel = C + C++ + some Objective-C (kexts) + some assembly
  - Userspace = Objective-C + Swift (modern) + C (legacy libs)
  - We are NOT going to write our kernel in Swift. Swift's runtime
    requires substantial userspace already (ARC, libdispatch, the
    Swift runtime itself). Kernels are typically C, Rust, or C++.
- **"Look and feel like macOS but better"** → polished native UI:
  smooth window animations, proper drop shadows, real scroll
  physics, native-quality typography, no webby tells.
- **"Use Chrome as the base browser"** → Chromium (or Chrome) as
  the in-OS web rendering engine. Not WebKitGTK.

Honest reading: the user wants Astrion to FEEL like macOS-level
native software and to be a true OS, not a webview-with-makeup.
That's a multi-year project. Doable; not by Dec 21, 2026.

---

## 2. The realistic options

### Option A — v1.0 ships on Linux as planned, v2.0 = real OS (RECOMMENDED)

**v1.0 (Dec 21, 2026):** the existing Astrion. Linux Live ISO +
web-app desktop + JS safety substrate. Ships on time. The framing
softens from "we wrote an OS" to "the AI-native desktop on Linux"
or similar — honest about what it is.

**v2.0 (target: 2028–2030, parallel project):** a real OS in Rust.
Microkernel. Custom userspace. Ports the safety substrate from
the JS substrate to a kernel-level capability system. Chromium as
the user-facing web engine.

This is the realistic path. v1.0 still ships and still has all the
value we built (safety story, marketplace, browse, self-mod). v2.0
is years of work but it's started, not just dreamed.

### Option B — pivot completely now, v1.0 launch slips indefinitely

Cancel the Dec 21, 2026 launch. Rewrite from scratch in Rust.
v1.0 ships when the real OS is ready (2030+).

**Cost:**
- 18 commits' worth of work today, 200+ commits' worth this year,
  all the safety substrate work — none of the *code* transfers
  directly. The *thinking* (safety substrate, capability tiers,
  red-team gate, etc.) does transfer, as designs.
- No launch in 2026 means no waitlist, no early users, no
  feedback loop, no revenue. Just a multi-year solo build.

Not recommended. Don't pick this without sleeping on it.

### Option C — Linux-from-scratch reskin (the deceptive shortcut)

Build a custom Linux distro that ships with our own kernel build,
boot animation, init system, X11/Wayland setup, window manager,
etc. — but still uses the Linux kernel underneath.

This is what most "indie OS" projects are. Pop!_OS, Elementary OS,
Solus — all Linux distros with custom desktops. Calling them
"operating systems" is technically true at the casual level (they
DO operate the system) and technically not-from-scratch at the
strict level (they use the Linux kernel).

**Cost:** months, not years. v1.0 launch shifts but stays in 2027.
But this is not "real OS" by user's strict definition — same Linux
kernel underneath. Same category mistake as v1.0.

Don't pick this unless you decide your strict definition was too
strict.

---

## 3. v2.0 architecture (if Option A — recommended)

### Language: Rust

Why not C: 1970s ergonomics. Easy to write memory-corruption bugs
that break the safety story. The whole point of v2.0 is to make
the safety substrate *unbypassable*; C undermines that at the
foundation.

Why not C++: better than C but inherits most footguns. SerenityOS
is C++ and works fine; the maintainers spend a lot of time on
memory bugs that Rust would have prevented at compile time.

Why not Swift: kernel-level Swift is unproven; runtime depends on
userspace, which doesn't exist yet at kernel-init time.

Why not Zig: arguably the best for greenfield kernel work, but the
ecosystem is smaller than Rust's and the language is pre-1.0 (as
of 2026). Risky for a multi-year project.

**Rust wins on:** memory safety at compile time, ownership model
forces explicit lifetime reasoning (which IS the OS-design
discipline), growing ecosystem (Redox, MaestroOS, Theseus, blogOS),
LLVM backend (mature), good async story for I/O.

Cost: Rust kernel code is harder to write than C. Compile times
are slow. `unsafe` blocks needed at hardware boundaries. Learning
curve is real (months to write competent unsafe Rust at kernel
level).

### Kernel architecture: microkernel + capability-based

A **microkernel** keeps the trusted-computing-base small: only the
scheduler, memory manager, and IPC live in kernel mode. Drivers
and filesystem live in userspace, isolated. Crash = the affected
component restarts; system doesn't go down.

A **capability-based** design maps directly to Astrion's safety
substrate. Every kernel operation requires a capability token.
Capabilities are unforgeable references issued by the kernel. The
M5/M6/M8 enforcement chain ports as: "user-space processes hold
capabilities; the kernel refuses operations without them; the
red-team agent reviews capability grants."

Reference: seL4 (formally verified microkernel in C),
Redox (Rust microkernel), Genode (componentized OS).

### Boot path

1. UEFI firmware
2. Bootloader (Limine, written for us; portable and modern)
3. Astrion kernel (Rust, multiboot2-compatible)
4. Init userspace process (Rust)
5. Device manager userspace (Rust)
6. Window manager userspace (Rust)
7. Shell + Astrion app launcher (Rust)

No GRUB (Limine is more modern). No systemd (we write our own init).

### Userspace

Own **libc** OR port musl. Own **windowing protocol** (something
like Wayland, simpler than X11). Own **driver model** (USB,
keyboard, mouse, display, network — initial set is minimal).

### GUI engine

Two paths:

**Path 1 — Servo (Rust web engine).** Embed Servo as the rendering
layer. The "Astrion apps" stay HTML/CSS/JS as they are today, just
rendered by Servo instead of WebKitGTK / Chrome. Servo is real but
the company that built it (Mozilla) deprioritized it; community-
maintained now. Risk: Servo may not handle all websites correctly.

**Path 2 — Port Chromium.** Chromium is 30M+ lines of C++.
Embedding it in a custom OS userspace is a multi-year project on
its own. Examples: ChromeOS does this (and has 100+ engineers).
Cromite, ungoogled-chromium — both desktop forks, not portable to
a custom kernel. Realistic only with a team or with major OS
abstractions already in place.

**Recommendation: Path 1 (Servo).** Keeps the JS app substrate
intact. Chromium-quality web rendering is v2.5+ work.

### Safety substrate port

The M4/M5/M6/M8 chain ports to the kernel-level capability system:
- **M4 verifiable code gen** stays in userspace (writes new
  userspace apps in JS → rendered by Servo)
- **M5 branch + rewind** moves into the kernel for *system-level*
  reversibility. Every syscall logs to a per-process branch; the
  user can rewind a process's whole session
- **M6 red-team** stays advisory at L2+ user actions, but the
  kernel hard-gates at the capability-grant layer
- **M8 self-mod** becomes substantially stronger: the kernel
  refuses to load a binary whose hash doesn't match the user's
  signed allow-list. The "golden lock" is enforced at boot, not
  by JS

This is the v2.0 marketing story: "the safety story we proved in
v1.0 on Linux, now enforced at the kernel."

---

## 4. Realistic multi-year roadmap

**Years are honest estimates for solo or 2-person team. Multiply by
0.5 if a team of 4+ joins. These are not "if everything goes
right" estimates; they're "expect this, plus 30% buffer."**

### Phase 1 — Bootstrap (Year 1)

Goals: a Rust kernel that boots on QEMU, prints "hello" to a
framebuffer, has a basic scheduler, can fork.

Concrete deliverables:
- Kernel boots on QEMU UEFI
- Prints to text-mode framebuffer
- Round-robin scheduler with 2 kernel threads
- Stack pivot + context switch in Rust + inline asm
- Simple paging (identity map then real virtual memory)
- Heap allocator (linked-list, simple)
- Serial console (for debugging)

Reference materials: Philipp Oppermann's "Writing an OS in Rust"
blog series (https://os.phil-opp.com/) — covers Phase 1 entirely.

**Time:** 6–12 months for someone new to OS dev + Rust unsafe.
Solo. Less with a mentor.

### Phase 2 — Userspace (Year 2)

Goals: user-mode processes, syscalls, an init process, a basic
shell.

- User/kernel privilege separation
- Syscall ABI (read/write/exit/fork/exec at minimum)
- ELF loader (or our own format)
- Init process in user mode
- Basic shell (read-eval-print + exec)
- Process table + scheduler upgrades (priority-based)
- IPC primitives (message passing, mailbox)

**Time:** 6–12 months solo.

### Phase 3 — Devices + Filesystem (Year 2.5–3)

Goals: persistent storage, keyboard + mouse + display, USB.

- AHCI driver (SATA SSDs) OR NVMe driver
- FAT32 filesystem (boot, then ext4 or our own)
- PS/2 + USB HID drivers (keyboard, mouse)
- Framebuffer driver (UEFI GOP for now; real GPU later)
- USB stack (bigger than it sounds — months on its own)

**Time:** 6–12 months solo.

### Phase 4 — Network + GUI (Year 3–4)

Goals: TCP/IP, window manager, compositor.

- Use smoltcp (Rust TCP/IP stack) for network
- Custom Wayland-like protocol for windows
- Compositor in Rust (own; not weston)
- Initial driver for one Wi-Fi chipset (Intel iwlwifi port?)

**Time:** 8–14 months solo.

### Phase 5 — Browser + Astrion port (Year 4–5)

Goals: Servo embedded, JS app substrate running, safety
substrate ported to capabilities.

- Embed Servo in userspace
- Port the JS apps from current Astrion (most should just work)
- Port the safety substrate, with kernel-level enforcement
  upgrades
- Ship a developer preview

**Time:** 12–18 months solo.

### Phase 6 — Polish + v2.0 ship (Year 5+)

Polish to "macOS-quality." Native animations, typography, real
GPU drivers (one card at a time), audio.

**Time:** open-ended.

**Total realistic estimate:** 5–10 years to "ships, real OS, runs
Astrion." Solo. Less with collaborators. Reference: SerenityOS is
5+ years in and still pre-1.0; their team is much larger than
solo.

---

## 5. What this means for v1.0 launch

**Recommendation: keep v1.0 on Linux, ship Dec 21, 2026 as
planned, REFRAME the messaging.**

Current framing: "the AI-native OS whose safety story is actually
true."

Honest reframe options (pick one):
- "**the AI-native desktop on Linux** whose safety story is
  actually true"
- "**the safety-first AI desktop**, built on Linux"
- "**Astrion**: an AI-native desktop environment with verifiable
  safety, running on Linux today. Real OS coming."

The "real OS coming" line is the bridge to v2.0. We don't promise
a date; we acknowledge the work is in progress.

**Marketing change required for honesty:**
- README intro: drop "operating system" claim or qualify it
- Landing page hero: drop "AI-native OS" or qualify
- install.md: drop "OS" framing for "desktop environment"
- docs/SAFETY.md: opens with "Astrion is an AI-native desktop
  environment on Linux" — accurate

**This is a hard reframe.** It moves the product down a notch from
"OS" to "desktop." Some hostile reviewers will notice the
reframe. The pre-emptive honesty is the right move; getting
caught with the bigger claim is worse.

---

## 6. What to do tomorrow

If user picks Option A (recommended):
- v1.0 work continues per the existing roadmap
- v2.0 starts as a SIDE project: hour or two a week reading
  Philipp Oppermann's blog, learning Rust kernel dev
- After v1.0 ships (Dec 21, 2026), v2.0 work scales up
- Open a separate repo (astrion-kernel or astrion-core) so
  the v2.0 code lives separately from v1.0

If user picks Option B (NOT recommended): freeze v1.0, focus
on v2.0 from scratch. Cancel Dec 21 launch. Multi-year solo
slog with no shipping in 2026.

If user picks Option C (Linux-from-scratch reskin): rebuild
the ISO with our own kernel config + custom init + custom
window manager. Months of work; the substrate underneath
still uses the Linux kernel.

---

## 7. Reference materials

For learning OS development:
- **Philipp Oppermann's "Writing an OS in Rust"** —
  https://os.phil-opp.com/ — covers Phase 1 of v2.0 directly,
  in Rust, free, excellent
- **OSDev Wiki** — https://wiki.osdev.org/ — the foundational
  community resource. Search for any topic.
- **"Operating Systems: Three Easy Pieces"** (Remzi
  Arpaci-Dusseau, free PDF) — the modern OS textbook
- **"Modern Operating Systems"** (Tanenbaum) — the classic
- **"Linux Kernel Development"** (Robert Love) — for
  reference monolithic-kernel design

For real OS projects to study:
- **Redox OS** (Rust microkernel) — https://www.redox-os.org/
- **SerenityOS** (C++) — https://serenityos.org/ — the model
  for "hobby OS that looks polished"
- **Haiku** (C++) — https://www.haiku-os.org/ — BeOS clone,
  decades of work
- **seL4** (C, formally verified microkernel) — for the
  capability-based design reference

For the embedded-browser path:
- **Servo** (Rust web engine) — https://servo.org/
- **CEF** (Chromium Embedded Framework) — for the path-not-taken

---

## 8. The brutal honest assessment, summarized

| Question | Honest answer |
|---|---|
| Is v1.0 Astrion a "real OS"? | No, not in the strict CS sense. It's a Linux distro + web-app desktop. |
| Can we ship a real OS by Dec 21, 2026? | No. |
| Can we ship a real OS by Dec 21, 2027? | No. |
| Can we ship a real OS by Dec 21, 2030? | Possible if we start now AND solo + maintain focus. |
| Should we pivot v1.0 to a real OS? | No. v1.0 already has months of work + a real story to ship. |
| Should we start v2.0 as a parallel project? | Yes, if user wants this badly. Phil Oppermann blog is the entry point. |
| Should we reframe v1.0 messaging? | Yes. "AI-native desktop on Linux" is honest. "AI-native OS" is marketing license. |
| Will current code transfer to v2.0? | The safety substrate concepts will (port to Rust). Code itself, no. |

This is the doc. Read it, decide. I'll execute whichever direction
you pick.

---

## Update 2026-05-26 — firmware reality check

Two firmware bugs found in the C-kernel revival. They're stacked:

1. **Homebrew QEMU 11.0 OVMF** (`/opt/homebrew/share/qemu/edk2-x86_64-code.fd`)
   triggers `#GP` in `BootScriptExecutorDxe` when our bootloader calls
   `LocateHandleBuffer(SimpleFileSystem)`. Workaround landed today:
   `kernel/scripts/get-ovmf.sh` downloads retrage's upstream EDK2 nightly
   build instead. `make run-retrage` uses it.

2. **retrage OVMF** (the workaround) **has its own bug**: `LocateHandleBuffer`
   for `SimpleFileSystem` returns `EFI_INVALID_PARAMETER count=0` on a
   CDROM boot device, and adding even a tiny amount of code to `boot.c`
   to try the canonical `LoadedImage → DeviceHandle → SimpleFileSystem`
   path crashes the firmware's own DxeCore with `#PF`. Layout-sensitive
   firmware bug. Lesson #194 captures the full forensics.

### What this means for v2.0 pacing

The "C kernel bridge" idea (use the existing 1087-line `kernel/` code
to prove the toolchain works while we plan Rust) is hitting firmware
walls that aren't ours. The productive next moves are:

1. **Surface Pro 6 ISO flash** (already #2 in the user-blocked list).
   Microsoft's UEFI is yet another EDK2 build; very likely doesn't
   reproduce either bug. Real-hardware bring-up was always the
   intended verification anyway.

2. **Bootloader pivot — multiboot2 + GRUB**. Skip UEFI's DxeCore
   entirely. GRUB handles all the firmware quirks; we get a
   well-defined entry state. This is a 1-2 day refactor that the
   Rust direction would do anyway (the Limine/Multiboot2 path is
   what blog_os and most "writing an OS in Rust" tutorials use).

3. **Lean into the Rust direction earlier**. The C kernel was always
   a bridge. If the bridge hits firmware walls, jump to the destination.
   bootimage / Limine + Rust no_std skips this whole class of problem.

### What landed today

- `kernel/scripts/get-ovmf.sh` (downloads retrage OVMF on demand)
- `kernel/Makefile run-retrage` target
- `kernel/README.md` (local test recipe + the two-OVMF situation)
- `.gitignore` excludes `kernel/firmware/` and `kernel/build/`
- `kernel/boot/boot.c` reverted to commit `a68a545` (yesterday's GREEN
  state); attempts to add LoadedImage path regressed GOP locate in
  retrage's DxeCore

The infrastructure stays useful regardless of which path #1, #2, or #3
above gets picked next.

---

*Written 2026-05-25. Updated 2026-05-26 with firmware reality check.*
