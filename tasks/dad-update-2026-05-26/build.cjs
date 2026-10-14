// Astrion progress update for Dad — slideshow
// Palette: Midnight Executive (navy) + Astrion orange accent

const pptxgen = require("pptxgenjs");

const NAVY   = "1E2761";
const ICE    = "CADCFC";
const CREAM  = "F5F7FB";
const ORANGE = "FF7A00";   // Astrion brand orange (from dock_apps in kernel.c)
const DARK   = "1A1A1A";
const MUTED  = "64748B";
const WHITE  = "FFFFFF";

const HEADER_FONT = "Georgia";
const BODY_FONT   = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";  // 10" x 5.625"
pres.author = "Astrion / Claude";
pres.title  = "Astrion Progress Update — Week of May 25, 2026";

// ─── Helpers ───────────────────────────────────────────────────────

// Left navy accent bar — the visual motif carried across content slides
function addAccentBar(slide) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.18, h: 5.625,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
}

// Small numbered orange circle (used for "Dad can unblock" cards etc.)
function addNumberCircle(slide, x, y, n) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: 0.55, h: 0.55,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  slide.addText(String(n), {
    x, y, w: 0.55, h: 0.55,
    fontFace: HEADER_FONT, fontSize: 22, bold: true, color: WHITE,
    align: "center", valign: "middle", margin: 0,
  });
}

// Footer (tiny brand text)
function addFooter(slide, text) {
  slide.addText(text, {
    x: 0.4, y: 5.30, w: 9.2, h: 0.25,
    fontFace: BODY_FONT, fontSize: 9, color: MUTED, italic: true,
    align: "left", margin: 0,
  });
}

// ─── Slide 1: Title (dark) ─────────────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // Orange wordmark bar (motif)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 2.2, w: 0.6, h: 0.08,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });

  s.addText("Astrion", {
    x: 0.5, y: 2.35, w: 9, h: 1.2,
    fontFace: HEADER_FONT, fontSize: 68, bold: true, color: WHITE,
    align: "left", margin: 0,
  });

  s.addText("Progress update", {
    x: 0.5, y: 3.55, w: 9, h: 0.6,
    fontFace: HEADER_FONT, fontSize: 28, italic: true, color: ICE,
    align: "left", margin: 0,
  });

  s.addText("Week of May 25, 2026 — for Dad", {
    x: 0.5, y: 4.20, w: 9, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, color: ICE,
    align: "left", margin: 0,
  });

  s.addText("14 commits  ·  three arcs  ·  one new kernel substrate", {
    x: 0.5, y: 5.0, w: 9, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, italic: true, color: ICE,
    align: "left", margin: 0,
  });
})();

// ─── Slide 2: Two arcs at a glance ─────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("Two tracks running in parallel", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 32, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Same codebase. Different shipping horizons.", {
    x: 0.5, y: 1.05, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  // Card 1 — v1.0
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.75, w: 4.4, h: 3.2,
    fill: { color: WHITE }, line: { color: ICE, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.75, w: 0.12, h: 3.2,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  s.addText("v1.0", {
    x: 0.8, y: 1.9, w: 3.8, h: 0.5,
    fontFace: HEADER_FONT, fontSize: 28, bold: true, color: NAVY,
    align: "left", margin: 0,
  });
  s.addText("AI-native desktop on Linux", {
    x: 0.8, y: 2.4, w: 3.8, h: 0.3,
    fontFace: BODY_FONT, fontSize: 12, italic: true, color: MUTED,
    align: "left", margin: 0,
  });
  s.addText([
    { text: "Ships Dec 21, 2026", options: { bullet: true, breakLine: true, bold: true, color: DARK } },
    { text: "Phase 1: closed this week", options: { bullet: true, breakLine: true, color: DARK } },
    { text: "Phase 2: ahead of schedule", options: { bullet: true, breakLine: true, color: DARK } },
    { text: "55 skills in marketplace", options: { bullet: true, breakLine: true, color: DARK } },
    { text: "Self-mod sandbox: GREEN", options: { bullet: true, color: DARK } },
  ], {
    x: 0.85, y: 2.75, w: 3.9, h: 2.15,
    fontFace: BODY_FONT, fontSize: 13, paraSpaceAfter: 4,
    valign: "top", margin: 0,
  });

  // Card 2 — v2.0
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.75, w: 4.4, h: 3.2,
    fill: { color: WHITE }, line: { color: ICE, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.75, w: 0.12, h: 3.2,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText("v2.0", {
    x: 5.4, y: 1.9, w: 3.8, h: 0.5,
    fontFace: HEADER_FONT, fontSize: 28, bold: true, color: NAVY,
    align: "left", margin: 0,
  });
  s.addText("real OS kernel (bare metal)", {
    x: 5.4, y: 2.4, w: 3.8, h: 0.3,
    fontFace: BODY_FONT, fontSize: 12, italic: true, color: MUTED,
    align: "left", margin: 0,
  });
  s.addText([
    { text: "Multi-year timeline", options: { bullet: true, breakLine: true, bold: true, color: DARK } },
    { text: "Substrate: GREEN this week", options: { bullet: true, breakLine: true, color: ORANGE, bold: true } },
    { text: "Boots in QEMU end-to-end", options: { bullet: true, breakLine: true, color: DARK } },
    { text: "Path: GRUB → long mode → C", options: { bullet: true, breakLine: true, color: DARK } },
    { text: "Eventually written in Rust", options: { bullet: true, color: DARK } },
  ], {
    x: 5.45, y: 2.75, w: 3.9, h: 2.15,
    fontFace: BODY_FONT, fontSize: 13, paraSpaceAfter: 4,
    valign: "top", margin: 0,
  });

  addFooter(s, "Slide 2 of 9");
})();

// ─── Slide 3: v1.0 — Phase 1 closed ────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("v1.0 — Phase 1 closed", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 32, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Self-modification sandbox passed the 24-hour soak test.", {
    x: 0.5, y: 1.05, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  // Three stat callouts in a row
  const stats = [
    { num: "9/10", label: "soak cycles\nbyte-identical clean", note: "1 failure was a low-battery flake, documented honestly" },
    { num: "55",   label: "skills in the\nmarketplace", note: "up from 20 last week — every one parse-validated" },
    { num: "17",   label: "real bugs caught\nby self-audit",  note: "4 eval bypasses, 1 missing LICENSE, 12 doc drifts" },
  ];

  stats.forEach((stat, i) => {
    const x = 0.6 + i * 3.1;
    // Card
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.8, w: 2.85, h: 3.15,
      fill: { color: WHITE }, line: { color: ICE, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
    });
    // Big stat
    s.addText(stat.num, {
      x, y: 1.95, w: 2.85, h: 1.2,
      fontFace: HEADER_FONT, fontSize: 64, bold: true, color: ORANGE,
      align: "center", valign: "middle", margin: 0,
    });
    // Label
    s.addText(stat.label, {
      x: x + 0.2, y: 3.2, w: 2.45, h: 0.9,
      fontFace: BODY_FONT, fontSize: 14, bold: true, color: NAVY,
      align: "center", valign: "top", margin: 0,
    });
    // Note
    s.addText(stat.note, {
      x: x + 0.25, y: 4.1, w: 2.35, h: 0.75,
      fontFace: BODY_FONT, fontSize: 10, italic: true, color: MUTED,
      align: "center", valign: "top", margin: 0,
    });
  });

  addFooter(s, "Slide 3 of 9   ·   commit 93550f5: M8.P5 GREEN verdict");
})();

// ─── Slide 4: Marketplace growth ───────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("The marketplace got 3× bigger", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 32, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Skills are the on-ramp for non-engineers to extend Astrion.", {
    x: 0.5, y: 1.05, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  // Left: big before-after stat — widen each number box so 2-digit nums don't wrap
  s.addText("20", {
    x: 0.5, y: 2.2, w: 1.6, h: 1.5,
    fontFace: HEADER_FONT, fontSize: 76, bold: true, color: MUTED,
    align: "center", valign: "middle", margin: 0,
  });
  s.addText("→", {
    x: 2.15, y: 2.2, w: 0.8, h: 1.5,
    fontFace: HEADER_FONT, fontSize: 48, color: ORANGE,
    align: "center", valign: "middle", margin: 0,
  });
  s.addText("55", {
    x: 2.95, y: 2.2, w: 1.6, h: 1.5,
    fontFace: HEADER_FONT, fontSize: 76, bold: true, color: ORANGE,
    align: "center", valign: "middle", margin: 0,
  });
  s.addText("skills", {
    x: 0.5, y: 3.75, w: 4.1, h: 0.35,
    fontFace: BODY_FONT, fontSize: 13, italic: true, color: MUTED,
    align: "center", margin: 0,
  });

  // Right: categories card (moved closer to center, taller content fit)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.3, y: 1.95, w: 4.2, h: 2.85,
    fill: { color: WHITE }, line: { color: ICE, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.3, y: 1.95, w: 0.12, h: 2.85,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText("What got added", {
    x: 5.55, y: 2.1, w: 3.8, h: 0.4,
    fontFace: HEADER_FONT, fontSize: 17, bold: true, color: NAVY,
    align: "left", valign: "top", margin: 0,
  });
  s.addText([
    { text: "Productivity (PDF, OCR, summarize)",  options: { bullet: true, breakLine: true } },
    { text: "Code helpers (lint, test, format)",   options: { bullet: true, breakLine: true } },
    { text: "Media (image resize, audio trim)",    options: { bullet: true, breakLine: true } },
    { text: "Web (fetch, scrape, screenshot)",     options: { bullet: true, breakLine: true } },
    { text: "Data (CSV, JSON, chart)",             options: { bullet: true } },
  ], {
    x: 5.55, y: 2.55, w: 3.8, h: 2.2,
    fontFace: BODY_FONT, fontSize: 12.5, color: DARK, paraSpaceAfter: 3,
    valign: "top", margin: 0,
  });

  s.addText("Every skill parse-validated. Descriptions don't overclaim what they do.", {
    x: 0.5, y: 4.85, w: 9.2, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, italic: true, color: MUTED,
    align: "center", margin: 0,
  });

  addFooter(s, "Slide 4 of 9");
})();

// ─── Slide 5: v2.0 substrate — the headline (dark) ─────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // Orange accent bar (motif inverted for dark slides)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.18, h: 5.625,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });

  s.addText("Astrion has its own kernel now.", {
    x: 0.5, y: 0.4, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 30, bold: true, color: WHITE,
    align: "left", margin: 0,
  });

  s.addText("Stub for now — but it really boots, on bare-metal emulation, with code we wrote.", {
    x: 0.5, y: 1.1, w: 9.2, h: 0.5,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: ICE,
    align: "left", margin: 0,
  });

  // Code block with the actual serial output
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.85, w: 9.0, h: 2.7,
    fill: { color: "0F1947" }, line: { color: ORANGE, width: 1 },
  });

  s.addText([
    { text: "$ qemu-system-x86_64 -cdrom astrion-grub.iso",  options: { breakLine: true, color: "9CA3AF" } },
    { text: "",  options: { breakLine: true } },
    { text: "=== Astrion v2.0 Kernel (multiboot2 path) ===", options: { breakLine: true, color: ORANGE, bold: true } },
    { text: "kernel_mb2_main reached; long-mode OK",         options: { breakLine: true, color: "A7F3D0" } },
    { text: "multiboot2 magic = 0x0000000036d76289",         options: { breakLine: true, color: ICE } },
    { text: "multiboot2 info  = 0x00000000001005f8",         options: { breakLine: true, color: ICE } },
    { text: "magic OK — GRUB hand-off clean",                options: { breakLine: true, color: "A7F3D0" } },
    { text: "kernel halt (stub — next: parse info tags + drive framebuffer)", options: { color: "9CA3AF" } },
  ], {
    x: 0.8, y: 2.0, w: 8.5, h: 2.4,
    fontFace: "Consolas", fontSize: 11.5,
    align: "left", valign: "top", margin: 0,
  });

  s.addText("That output above is real. It's logged in the commit + the design doc + lesson #195.", {
    x: 0.5, y: 4.7, w: 9.2, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, italic: true, color: ICE,
    align: "left", margin: 0,
  });

  addFooter(s, "Slide 5 of 9   ·   commit 300470d");
})();

// ─── Slide 6: The pivot story ──────────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("How the kernel went from stuck to working", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 28, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Swap protocols when the firmware fights you. Don't keep digging.", {
    x: 0.5, y: 1.0, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  // Three timeline cards. Titles tuned to fit on a single line so the
  // body / divider / result lines align across all three cards.
  const steps = [
    { n: 1, title: "Tried UEFI",
      body: "Standard \"correct\" path. Used the same firmware that real laptops use.",
      result: "Hit two stacked OVMF firmware bugs we couldn't fix from our side.",
      bad: true },
    { n: 2, title: "Used GRUB",
      body: "Multiboot2 protocol. Skip UEFI's services entirely. GRUB loads us at 1 MB.",
      result: "Wrote asm entry + 32→64 bit transition + C kernel entry point.",
      bad: false },
    { n: 3, title: "It works",
      body: "First QEMU run. Serial output reached our kernel cleanly.",
      result: "About 30 minutes from pivot decision to working substrate.",
      bad: false, good: true },
  ];

  steps.forEach((step, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.65, w: 2.9, h: 3.3,
      fill: { color: WHITE }, line: { color: ICE, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
    });
    addNumberCircle(s, x + 0.2, 1.85, step.n);
    s.addText(step.title, {
      x: x + 0.9, y: 1.85, w: 1.9, h: 0.55,
      fontFace: HEADER_FONT, fontSize: 15, bold: true, color: NAVY,
      align: "left", valign: "middle", margin: 0,
    });
    s.addText(step.body, {
      x: x + 0.25, y: 2.6, w: 2.5, h: 1.1,
      fontFace: BODY_FONT, fontSize: 11.5, color: DARK,
      align: "left", valign: "top", margin: 0,
    });
    // Result line at bottom
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.25, y: 3.75, w: 2.5, h: 0.04,
      fill: { color: step.good ? ORANGE : (step.bad ? "DC2626" : ICE) },
      line: { color: WHITE, width: 0 },
    });
    s.addText(step.result, {
      x: x + 0.25, y: 3.9, w: 2.5, h: 0.9,
      fontFace: BODY_FONT, fontSize: 10.5, italic: true,
      color: step.good ? ORANGE : (step.bad ? "DC2626" : MUTED),
      bold: step.good, align: "left", valign: "top", margin: 0,
    });
  });

  addFooter(s, "Slide 6 of 9   ·   lessons #194 + #195");
})();

// ─── Slide 7: Open work ────────────────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("What's next — solo-doable", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 32, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Things I can keep shipping without anyone else.", {
    x: 0.5, y: 1.05, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  // Two columns: v1.0 track and v2.0 track
  // v1.0
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.75, w: 4.4, h: 2.7,
    fill: { color: WHITE }, line: { color: ICE, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.75, w: 0.12, h: 2.7,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  s.addText("v1.0 track", {
    x: 0.8, y: 1.9, w: 3.8, h: 0.45,
    fontFace: HEADER_FONT, fontSize: 20, bold: true, color: NAVY,
    align: "left", margin: 0,
  });
  s.addText([
    { text: "Record the 10-min safety video (script is done)", options: { bullet: true, breakLine: true } },
    { text: "Record the 60-second demo (Phase 0 exit)",         options: { bullet: true, breakLine: true } },
    { text: "Pick the killer feature for Phase 3 (week 30)",    options: { bullet: true, breakLine: true } },
    { text: "Grow skills past 55 toward 100",                   options: { bullet: true } },
  ], {
    x: 0.85, y: 2.5, w: 3.9, h: 2.4,
    fontFace: BODY_FONT, fontSize: 12.5, color: DARK, paraSpaceAfter: 5,
    valign: "top", margin: 0,
  });

  // v2.0
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.75, w: 4.4, h: 2.7,
    fill: { color: WHITE }, line: { color: ICE, width: 1 },
    shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.75, w: 0.12, h: 2.7,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });
  s.addText("v2.0 track", {
    x: 5.4, y: 1.9, w: 3.8, h: 0.45,
    fontFace: HEADER_FONT, fontSize: 20, bold: true, color: NAVY,
    align: "left", margin: 0,
  });
  s.addText([
    { text: "Parse multiboot2 info tags (memory map, framebuffer)",   options: { bullet: true, breakLine: true } },
    { text: "Wire existing framebuffer + keyboard + mouse drivers", options: { bullet: true, breakLine: true } },
    { text: "Read Phil Oppermann's \"Writing an OS in Rust\"",      options: { bullet: true, breakLine: true } },
    { text: "Start porting C kernel modules to Rust",               options: { bullet: true } },
  ], {
    x: 5.45, y: 2.5, w: 3.9, h: 2.4,
    fontFace: BODY_FONT, fontSize: 12.5, color: DARK, paraSpaceAfter: 5,
    valign: "top", margin: 0,
  });

  addFooter(s, "Slide 7 of 9");
})();

// ─── Slide 8: What Dad can unblock ─────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: CREAM };
  addAccentBar(s);

  s.addText("Three things you can unblock", {
    x: 0.5, y: 0.35, w: 9.2, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 32, bold: true, color: NAVY,
    align: "left", margin: 0,
  });

  s.addText("Each one is gating real shippable work.", {
    x: 0.5, y: 1.05, w: 9.2, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, italic: true, color: MUTED,
    align: "left", margin: 0,
  });

  const blockers = [
    {
      title: "ANTHROPIC_API_KEY",
      detail: "Phase 0 exit gate. Astrion's AI features need it to actually run.",
      action: "Generate a key from the Anthropic Console and add it to .env.",
    },
    {
      title: "Register astrion-os.com",
      detail: "Phase 2 W21 started May 25. Needs 48h DNS propagation.",
      action: "Register the domain at any registrar. Point A record at the host.",
    },
    {
      title: "Flash kernel ISO to USB → boot on Surface Pro 6",
      detail: "Hardware test for v1.0 + bypass remaining UEFI firmware bug for v2.0.",
      action: "Recipe in docs/hardware-testing.md. GRUB ISO works too now.",
    },
  ];

  blockers.forEach((b, i) => {
    const y = 1.75 + i * 1.18;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9.0, h: 1.05,
      fill: { color: WHITE }, line: { color: ICE, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 135, opacity: 0.08 },
    });
    addNumberCircle(s, 0.7, y + 0.25, i + 1);
    s.addText(b.title, {
      x: 1.45, y: y + 0.1, w: 7.9, h: 0.35,
      fontFace: HEADER_FONT, fontSize: 15, bold: true, color: NAVY,
      align: "left", valign: "middle", margin: 0,
    });
    s.addText(b.detail, {
      x: 1.45, y: y + 0.42, w: 7.9, h: 0.3,
      fontFace: BODY_FONT, fontSize: 11.5, color: DARK,
      align: "left", margin: 0,
    });
    s.addText(b.action, {
      x: 1.45, y: y + 0.7, w: 7.9, h: 0.3,
      fontFace: BODY_FONT, fontSize: 10.5, italic: true, color: ORANGE,
      align: "left", margin: 0,
    });
  });

  addFooter(s, "Slide 8 of 9");
})();

// ─── Slide 9: Closing (dark) ───────────────────────────────────────

(() => {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.0, w: 0.6, h: 0.08,
    fill: { color: ORANGE }, line: { color: ORANGE, width: 0 },
  });

  s.addText("Where we are", {
    x: 0.5, y: 1.15, w: 9.0, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 36, bold: true, color: WHITE,
    align: "left", margin: 0,
  });

  s.addText([
    { text: "v1.0 launch — ", options: { color: ICE } },
    { text: "on track for Dec 21, Phase 1 closed.", options: { color: WHITE, bold: true, breakLine: true } },
    { text: "v2.0 substrate — ", options: { color: ICE } },
    { text: "GREEN. Real kernel, real boot, real serial output.", options: { color: WHITE, bold: true, breakLine: true } },
    { text: "Honesty rule — ", options: { color: ICE } },
    { text: "every claim has a commit / log / transcript behind it.", options: { color: WHITE, bold: true } },
  ], {
    x: 0.5, y: 2.1, w: 9.0, h: 2.0,
    fontFace: BODY_FONT, fontSize: 16, paraSpaceAfter: 8,
    align: "left", margin: 0,
  });

  s.addText("Score: +2  ·  No lies, no hallucination.", {
    x: 0.5, y: 4.4, w: 9.0, h: 0.4,
    fontFace: HEADER_FONT, fontSize: 14, italic: true, color: ORANGE,
    align: "left", margin: 0,
  });

  s.addText("Made with Claude  ·  Week of May 25, 2026", {
    x: 0.5, y: 5.0, w: 9.0, h: 0.3,
    fontFace: BODY_FONT, fontSize: 10, italic: true, color: ICE,
    align: "left", margin: 0,
  });
})();

// ─── Write file ────────────────────────────────────────────────────

pres.writeFile({ fileName: "astrion-update-dad-2026-05-26.pptx" })
  .then(name => console.log("wrote", name));
