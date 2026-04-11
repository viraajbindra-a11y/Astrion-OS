// Astrion OS — 12-slide team presentation
// Dark theme, large friendly fonts, speaker notes under each slide.
// Built with pptxgenjs. Run: node build-presentation.js

const pptxgen = require("pptxgenjs");

const BG        = "0A0A1A"; // deep navy/black
const BG_PANEL  = "14142B"; // slightly lighter panel
const BG_LIFT   = "1C1C3A"; // lifted card
const WHITE     = "FFFFFF";
const MUTED     = "B8B8D0";
const DIM       = "6A6A8A";
const ACCENT    = "007AFF"; // primary blue
const CYAN      = "8BE9FD"; // brain-S1
const PURPLE    = "BD93F9"; // brain-S2
const GREEN     = "50FA7B";
const YELLOW    = "F1FA8C";

const FONT_HEAD = "Helvetica";
const FONT_BODY = "Helvetica";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3" × 7.5"
pres.author = "Viraaj Singh Bindra";
pres.title  = "Astrion OS — Team Presentation";
pres.subject = "12-minute talk to 3 non-coding friends";

const W = 13.3;
const H = 7.5;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function baseBackground(slide) {
  slide.background = { color: BG };
}

function footer(slide, pageNum, total) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: H - 0.35, w: W, h: 0.35,
    fill: { color: BG_PANEL }, line: { color: BG_PANEL, width: 0 },
  });
  slide.addText("ASTRION OS", {
    x: 0.5, y: H - 0.33, w: 3, h: 0.3,
    fontSize: 10, fontFace: FONT_BODY, color: DIM, bold: true, charSpacing: 2,
    valign: "middle", margin: 0,
  });
  slide.addText(`${pageNum} / ${total}`, {
    x: W - 1.2, y: H - 0.33, w: 0.7, h: 0.3,
    fontSize: 10, fontFace: FONT_BODY, color: DIM, align: "right",
    valign: "middle", margin: 0,
  });
}

function slideTitle(slide, text) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 0.55, w: 0.08, h: 0.55,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addText(text, {
    x: 0.75, y: 0.5, w: W - 1.5, h: 0.7,
    fontSize: 32, fontFace: FONT_HEAD, color: WHITE, bold: true,
    valign: "middle", margin: 0,
  });
}

function imagePlaceholder(slide, x, y, w, h, label) {
  // Dashed card with a clear "drop screenshot here" label
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: BG_LIFT },
    line: { color: ACCENT, width: 2, dashType: "dash" },
  });
  slide.addText("📷", {
    x, y: y + h * 0.18, w, h: 0.9,
    fontSize: 54, fontFace: FONT_BODY, color: ACCENT,
    align: "center", valign: "middle", margin: 0,
  });
  slide.addText("IMAGE PLACEHOLDER", {
    x, y: y + h * 0.55, w, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY, color: ACCENT, bold: true,
    align: "center", valign: "middle", charSpacing: 3, margin: 0,
  });
  slide.addText(label, {
    x: x + 0.3, y: y + h * 0.68, w: w - 0.6, h: 0.6,
    fontSize: 12, fontFace: FONT_BODY, color: MUTED, italic: true,
    align: "center", valign: "middle", margin: 0,
  });
}

// ------------------------------------------------------------
// SLIDE 1 — Title
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);

  // Big accent band on the left
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.35, h: H,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });

  // Huge title
  slide.addText("ASTRION", {
    x: 0.9, y: 1.8, w: W - 1.8, h: 1.8,
    fontSize: 140, fontFace: FONT_HEAD, color: WHITE, bold: true,
    charSpacing: 6, valign: "middle", margin: 0,
  });
  slide.addText("OS", {
    x: 0.9, y: 3.3, w: W - 1.8, h: 1.3,
    fontSize: 110, fontFace: FONT_HEAD, color: ACCENT, bold: true,
    charSpacing: 4, valign: "middle", margin: 0,
  });

  // Tagline
  slide.addText("An operating system that thinks.", {
    x: 0.9, y: 4.85, w: W - 1.8, h: 0.6,
    fontSize: 32, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  // Byline
  slide.addText([
    { text: "Built by ", options: { color: DIM } },
    { text: "Viraaj Singh Bindra", options: { color: WHITE, bold: true } },
  ], {
    x: 0.9, y: 5.7, w: W - 1.8, h: 0.5,
    fontSize: 20, fontFace: FONT_BODY, margin: 0,
  });

  // Pill tags (S1 / S2 brain colors teased)
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.9, y: 6.4, w: 1.7, h: 0.45,
    fill: { color: BG_PANEL }, line: { color: CYAN, width: 1 }, rectRadius: 0.22,
  });
  slide.addText("BRAIN S1", {
    x: 0.9, y: 6.4, w: 1.7, h: 0.45,
    fontSize: 12, fontFace: FONT_BODY, color: CYAN, bold: true,
    align: "center", valign: "middle", charSpacing: 2, margin: 0,
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.75, y: 6.4, w: 1.7, h: 0.45,
    fill: { color: BG_PANEL }, line: { color: PURPLE, width: 1 }, rectRadius: 0.22,
  });
  slide.addText("BRAIN S2", {
    x: 2.75, y: 6.4, w: 1.7, h: 0.45,
    fontSize: 12, fontFace: FONT_BODY, color: PURPLE, bold: true,
    align: "center", valign: "middle", charSpacing: 2, margin: 0,
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 4.6, y: 6.4, w: 2.0, h: 0.45,
    fill: { color: BG_PANEL }, line: { color: ACCENT, width: 1 }, rectRadius: 0.22,
  });
  slide.addText("INTENT KERNEL", {
    x: 4.6, y: 6.4, w: 2.0, h: 0.45,
    fontSize: 12, fontFace: FONT_BODY, color: ACCENT, bold: true,
    align: "center", valign: "middle", charSpacing: 2, margin: 0,
  });

  slide.addNotes(
    "Hey. So I've been building something kind of big and I want to show you what it is. It's called Astrion OS. " +
    "It's an operating system — like Windows or macOS — but it's built from scratch to work WITH AI, not just have AI bolted on. " +
    "I'll explain what that means. It's okay if you don't know what an operating system is, I'll cover that too. " +
    "Just stop me if anything is confusing."
  );

  footer(slide, 1, 12);
}

// ------------------------------------------------------------
// SLIDE 2 — What's an Operating System?
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "What's an Operating System?");

  slide.addText("An OS is the thing that makes your computer be a computer.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.7,
    fontSize: 26, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  // Three big cards
  const cards = [
    { title: "WINDOWS",  sub: "Microsoft",  icon: "⊞"  },
    { title: "MACOS",    sub: "Apple",      icon: ""  },
    { title: "LINUX",    sub: "Open source",icon: "🐧" },
  ];
  const cardW = 3.6, cardH = 2.8, gap = 0.5;
  const totalW = cards.length * cardW + (cards.length - 1) * gap;
  const startX = (W - totalW) / 2;
  cards.forEach((c, i) => {
    const cx = startX + i * (cardW + gap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 2.5, w: cardW, h: cardH,
      fill: { color: BG_PANEL }, line: { color: BG_LIFT, width: 1 },
    });
    slide.addText(c.icon, {
      x: cx, y: 2.7, w: cardW, h: 1.3,
      fontSize: 72, fontFace: FONT_BODY, color: ACCENT,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(c.title, {
      x: cx, y: 4.0, w: cardW, h: 0.5,
      fontSize: 22, fontFace: FONT_HEAD, color: WHITE, bold: true,
      align: "center", valign: "middle", charSpacing: 2, margin: 0,
    });
    slide.addText(c.sub, {
      x: cx, y: 4.5, w: cardW, h: 0.4,
      fontSize: 14, fontFace: FONT_BODY, color: DIM,
      align: "center", valign: "middle", margin: 0,
    });
  });

  slide.addText("Without one, your laptop is just a pile of chips.", {
    x: 0.75, y: 5.8, w: W - 1.5, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY, color: CYAN,
    align: "center", italic: true, margin: 0,
  });

  slide.addNotes(
    "Okay really fast: an operating system, or 'OS,' is the software that makes a computer actually usable. " +
    "When you open your laptop and see a desktop with icons and a clock — that's the OS. Windows is an OS. macOS is an OS. " +
    "Without one, your laptop is just a bunch of chips that don't know what to do. " +
    "That's the thing I'm building. From scratch. Most people never build one because it's really hard. I wanted to see if I could."
  );
  footer(slide, 2, 12);
}

// ------------------------------------------------------------
// SLIDE 3 — Meet Astrion OS (image placeholder)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "Meet Astrion OS");

  // Left: stats + bullets
  slide.addText("52 apps. Native C desktop shell. Runs as a real Linux OS.", {
    x: 0.75, y: 1.45, w: 6.8, h: 0.8,
    fontSize: 22, fontFace: FONT_BODY, color: WHITE, bold: true, margin: 0,
  });

  const bullets = [
    { text: "Works in a browser (demo mode)", options: { bullet: { code: "25BA" }, breakLine: true } },
    { text: "Works as a desktop app (Mac, Windows)", options: { bullet: { code: "25BA" }, breakLine: true } },
    { text: "Works as a real bootable operating system",
      options: { bullet: { code: "25BA" }, bold: true, color: ACCENT } },
  ];
  slide.addText(bullets, {
    x: 0.9, y: 2.6, w: 6.6, h: 2.4,
    fontSize: 18, fontFace: FONT_BODY, color: MUTED,
    paraSpaceAfter: 10, margin: 0,
  });

  slide.addText("→ Put it on a USB stick and boot any computer.", {
    x: 0.9, y: 5.1, w: 6.6, h: 0.5,
    fontSize: 17, fontFace: FONT_BODY, color: CYAN, italic: true, margin: 0,
  });

  // Stat row
  const stats = [
    { n: "52",    l: "APPS"       },
    { n: "2.1K",  l: "LINES OF C" },
    { n: "v0.1", l: "RELEASED"   },
  ];
  stats.forEach((s, i) => {
    const sx = 0.9 + i * 2.2;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: 5.8, w: 2.0, h: 1.0,
      fill: { color: BG_PANEL }, line: { color: ACCENT, width: 1 },
    });
    slide.addText(s.n, {
      x: sx, y: 5.85, w: 2.0, h: 0.55,
      fontSize: 26, fontFace: FONT_HEAD, color: ACCENT, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.l, {
      x: sx, y: 6.4, w: 2.0, h: 0.35,
      fontSize: 11, fontFace: FONT_BODY, color: DIM, bold: true,
      align: "center", valign: "middle", charSpacing: 2, margin: 0,
    });
  });

  // Right: screenshot placeholder
  imagePlaceholder(slide, 7.9, 1.4, 4.9, 5.6, "drop desktop screenshot here");

  slide.addNotes(
    "Here's what it looks like right now. It has 52 apps — a calculator, notes, a code editor, games, a music player, " +
    "a web browser I built myself, a terminal, everything. The desktop is written in C, which is a really low-level " +
    "programming language — that means it talks to the computer's hardware directly, not through a web browser. " +
    "You can run it three ways: in your browser as a demo, as a desktop app on Mac or Windows, " +
    "or as a real operating system that boots off a USB stick. If you have time: show the running OS on your screen now."
  );
  footer(slide, 3, 12);
}

// ------------------------------------------------------------
// SLIDE 4 — The Thinking House (HERO slide — most important)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);

  // Full-bleed header strip
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: W, h: 1.1,
    fill: { color: BG_PANEL }, line: { color: BG_PANEL, width: 0 },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.1, w: W, h: 0.04,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addText("THE BIG IDEA", {
    x: 0.5, y: 0.25, w: W - 1, h: 0.3,
    fontSize: 14, fontFace: FONT_BODY, color: ACCENT, bold: true, charSpacing: 4, margin: 0,
  });
  slide.addText("The Thinking House", {
    x: 0.5, y: 0.5, w: W - 1, h: 0.55,
    fontSize: 32, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
  });

  // Hero line
  slide.addText("Imagine a house that can think for itself.", {
    x: 0.6, y: 1.55, w: W - 1.2, h: 0.9,
    fontSize: 40, fontFace: FONT_HEAD, color: WHITE, bold: true,
    align: "center", valign: "middle", margin: 0,
  });

  // Three big scenario cards
  const scenes = [
    { emoji: "🛋️", title: "Living room",      caption: "Normal day" },
    { emoji: "🍰", title: "Kitchen",          caption: '"I want to bake a cake"' },
    { emoji: "🛋️", title: "Living room again", caption: "When you're done" },
  ];
  const cw = 3.9, ch = 3.0, gp = 0.35;
  const tw = scenes.length * cw + (scenes.length - 1) * gp;
  const sx0 = (W - tw) / 2;
  scenes.forEach((s, i) => {
    const cx = sx0 + i * (cw + gp);

    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 2.7, w: cw, h: ch,
      fill: { color: BG_PANEL }, line: { color: i === 1 ? ACCENT : BG_LIFT, width: i === 1 ? 2 : 1 },
    });
    slide.addText(s.emoji, {
      x: cx, y: 2.9, w: cw, h: 1.3,
      fontSize: 80, fontFace: FONT_BODY, color: WHITE,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.title, {
      x: cx, y: 4.2, w: cw, h: 0.55,
      fontSize: 22, fontFace: FONT_HEAD, color: WHITE, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.caption, {
      x: cx + 0.15, y: 4.8, w: cw - 0.3, h: 0.7,
      fontSize: 14, fontFace: FONT_BODY, color: MUTED, italic: true,
      align: "center", valign: "middle", margin: 0,
    });

    // Arrow between cards
    if (i < scenes.length - 1) {
      const ax = cx + cw + 0.02;
      slide.addText("→", {
        x: ax, y: 3.7, w: gp, h: 0.8,
        fontSize: 36, fontFace: FONT_BODY, color: ACCENT, bold: true,
        align: "center", valign: "middle", margin: 0,
      });
    }
  });

  // Bottom punchline panel
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 6.0, w: W - 1, h: 0.9,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addText("That's what I'm actually trying to build.", {
    x: 0.5, y: 6.0, w: W - 1, h: 0.9,
    fontSize: 24, fontFace: FONT_HEAD, color: WHITE, bold: true,
    align: "center", valign: "middle", margin: 0,
  });

  slide.addNotes(
    "Okay, here's the big idea — and if you only remember one thing, remember this. Imagine a house that can think. " +
    "You walk in and say 'I want to bake a cake,' and the house rearranges itself into a kitchen. When you're done, " +
    "it's a living room again. It makes the rooms it needs, when it needs them. " +
    "That's what a 'thinking operating system' is. You don't click through apps — you tell it what you WANT, " +
    "and it figures it out. That's what Astrion is going to be."
  );
  footer(slide, 4, 12);
}

// ------------------------------------------------------------
// SLIDE 5 — What I Already Built (with screenshot placeholder)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "What I Already Built");

  slide.addText("The foundation is real.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  // Left: checkmark list
  const items = [
    { title: "52 apps",              sub: "Notes, Terminal, Browser, Draw, Music, Chess, Messages…" },
    { title: "Native C desktop shell", sub: "2,131 lines of C — like macOS" },
    { title: "Real bootable ISO",    sub: "Works on a USB stick" },
    { title: "AI integration",       sub: "Claude + local AI wired into Notes, Spotlight, Terminal" },
    { title: "Vault · files · windows", sub: "Everything a real OS needs" },
  ];
  items.forEach((it, i) => {
    const y = 2.25 + i * 0.82;
    // Check pill
    slide.addShape(pres.shapes.OVAL, {
      x: 0.85, y: y + 0.1, w: 0.45, h: 0.45,
      fill: { color: GREEN }, line: { color: GREEN, width: 0 },
    });
    slide.addText("✓", {
      x: 0.85, y: y + 0.1, w: 0.45, h: 0.45,
      fontSize: 18, fontFace: FONT_HEAD, color: BG, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(it.title, {
      x: 1.5, y: y, w: 6.0, h: 0.4,
      fontSize: 18, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
    });
    slide.addText(it.sub, {
      x: 1.5, y: y + 0.38, w: 6.0, h: 0.35,
      fontSize: 12, fontFace: FONT_BODY, color: DIM, margin: 0,
    });
  });

  // Right: screenshot placeholder
  imagePlaceholder(slide, 8.3, 1.5, 4.5, 5.5, "drop ISO boot screenshot here");

  slide.addNotes(
    "Now — most people, when they say they're 'building an OS,' they mean they're making a website that LOOKS like an OS. " +
    "I did that too, at first. But I wanted it to be real. So I wrote the desktop shell in C — that's the same language " +
    "macOS is written in. It's over two thousand lines of C code. And I built 52 apps on top of it. And I made it bootable — " +
    "you can actually put it on a USB stick and turn any laptop into an Astrion machine. That part is done. Today's demo is proof."
  );
  footer(slide, 5, 12);
}

// ------------------------------------------------------------
// SLIDE 6 — The Problem I Discovered
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "The Problem I Discovered");

  // Honest-audit banner
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.7,
    fill: { color: BG_PANEL }, line: { color: YELLOW, width: 1 },
  });
  slide.addText("I did an honest audit of my own plan. It failed.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.7,
    fontSize: 20, fontFace: FONT_BODY, color: YELLOW, italic: true,
    align: "center", valign: "middle", margin: 0,
  });

  slide.addText(
    "I was building a really nice copy of macOS with Claude bolted on the side. That's not an AI-native OS — it's an old OS with an AI feature.",
    {
      x: 0.75, y: 2.4, w: W - 1.5, h: 0.8,
      fontSize: 16, fontFace: FONT_BODY, color: MUTED, align: "center", margin: 0,
    }
  );

  slide.addText("3 biggest holes", {
    x: 0.75, y: 3.35, w: W - 1.5, h: 0.5,
    fontSize: 20, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
  });

  // Three hole cards
  const holes = [
    { n: "1", title: "51 apps is a trap",        body: "Every app is homework the AI will have to re-learn later" },
    { n: "2", title: "Self-learning was fake",  body: "I was taking notes, not actually getting smarter" },
    { n: "3", title: "No safety story",         body: "Nothing to stop things going wrong as AI gets stronger" },
  ];
  const hw = 3.95, hh = 2.6, hgap = 0.3;
  const htot = holes.length * hw + (holes.length - 1) * hgap;
  const hsx = (W - htot) / 2;
  holes.forEach((h2, i) => {
    const cx = hsx + i * (hw + hgap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 3.9, w: hw, h: hh,
      fill: { color: BG_PANEL }, line: { color: "FF5555", width: 1 },
    });
    slide.addText(h2.n, {
      x: cx + 0.2, y: 4.05, w: 0.8, h: 0.8,
      fontSize: 44, fontFace: FONT_HEAD, color: "FF5555", bold: true,
      valign: "middle", margin: 0,
    });
    slide.addText(h2.title, {
      x: cx + 0.2, y: 4.9, w: hw - 0.4, h: 0.5,
      fontSize: 17, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
    });
    slide.addText(h2.body, {
      x: cx + 0.2, y: 5.4, w: hw - 0.4, h: 1.1,
      fontSize: 13, fontFace: FONT_BODY, color: MUTED, margin: 0,
    });
  });

  slide.addNotes(
    "Here's the part most people skip in presentations: I looked at my own plan really hard and admitted it wasn't good enough. " +
    "I was building a nice-looking macOS clone and just putting Claude in a chat box on the side. That's not an 'AI-native OS' — " +
    "that's just a regular OS with an AI feature. And I found three big problems. First, 51 apps is too many — it locks me into " +
    "old ways of thinking. Second, I said Astrion would 'learn,' but it wasn't actually learning anything, it was just keeping a diary. " +
    "Third, and most important, I had no plan for safety. As AI gets crazy smart, you need ways to keep mistakes from being permanent. I had none."
  );
  footer(slide, 6, 12);
}

// ------------------------------------------------------------
// SLIDE 7 — The Fix: 3 Big Ideas
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "The Fix: 3 Big Ideas");

  slide.addText("I rewrote the whole plan around three ideas.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.5,
    fontSize: 20, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  const ideas = [
    {
      n: "1",
      color: ACCENT,
      title: "The Intent Kernel",
      body: "You tell it what you WANT, not what to do. It figures out the steps.",
    },
    {
      n: "2",
      color: CYAN,
      title: "The Dual-Process Brain",
      body: "A little brain that's always on (fast, on your computer). A big brain that wakes up for hard stuff (careful, slow).",
      extra: true,
    },
    {
      n: "3",
      color: PURPLE,
      title: "Verifiable · Reversible · Socratic",
      body: "Receipts (AI proves what it did) · Undo (dangerous stuff happens in a practice universe first) · It asks before doing big stuff — so your brain stays awake.",
    },
  ];

  const cw2 = (W - 1.5 - 0.6) / 3;
  ideas.forEach((id, i) => {
    const cx = 0.75 + i * (cw2 + 0.3);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 2.2, w: cw2, h: 4.7,
      fill: { color: BG_PANEL }, line: { color: id.color, width: 2 },
    });
    // Number circle
    slide.addShape(pres.shapes.OVAL, {
      x: cx + 0.3, y: 2.45, w: 0.8, h: 0.8,
      fill: { color: id.color }, line: { color: id.color, width: 0 },
    });
    slide.addText(id.n, {
      x: cx + 0.3, y: 2.45, w: 0.8, h: 0.8,
      fontSize: 28, fontFace: FONT_HEAD, color: BG, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(id.title, {
      x: cx + 0.3, y: 3.4, w: cw2 - 0.6, h: 1.1,
      fontSize: 22, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
    });
    slide.addText(id.body, {
      x: cx + 0.3, y: 4.5, w: cw2 - 0.6, h: 2.1,
      fontSize: 14, fontFace: FONT_BODY, color: MUTED, margin: 0,
    });

    // S1 / S2 chips on card 2
    if (id.extra) {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: cx + 0.3, y: 6.2, w: 1.4, h: 0.45,
        fill: { color: BG }, line: { color: CYAN, width: 1 }, rectRadius: 0.22,
      });
      slide.addText("S1 · local", {
        x: cx + 0.3, y: 6.2, w: 1.4, h: 0.45,
        fontSize: 11, fontFace: FONT_BODY, color: CYAN, bold: true,
        align: "center", valign: "middle", charSpacing: 1, margin: 0,
      });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: cx + 1.8, y: 6.2, w: 1.4, h: 0.45,
        fill: { color: BG }, line: { color: PURPLE, width: 1 }, rectRadius: 0.22,
      });
      slide.addText("S2 · cloud", {
        x: cx + 1.8, y: 6.2, w: 1.4, h: 0.45,
        fontSize: 11, fontFace: FONT_BODY, color: PURPLE, bold: true,
        align: "center", valign: "middle", charSpacing: 1, margin: 0,
      });
    }
  });

  slide.addNotes(
    "So I rewrote the whole plan around three big ideas. First: the Intent Kernel. Instead of clicking through apps, " +
    "you tell Astrion what you want — 'make me a birthday card for mom' — and it figures out the steps. " +
    "Second: two brains. A little brain that's always on, handles the easy stuff instantly, lives on your computer. " +
    "And a big brain that only wakes up for hard problems, like Claude. As AI gets smarter, more stuff moves into the " +
    "little brain and Astrion gets faster without changing shape. And third — this is the important one — " +
    "receipts, undo, and asking before big stuff. The AI has to prove what it did. Dangerous actions happen in a " +
    "practice universe you can undo. And it asks you before doing anything big, so YOU stay the one making decisions. " +
    "That last part matters a lot because if AI does all your thinking for you, your brain goes to sleep. I don't want that for anyone."
  );
  footer(slide, 7, 12);
}

// ------------------------------------------------------------
// SLIDE 8 — Why This Matters (serious)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "Why This Matters");

  slide.addText("AI is getting really powerful, really fast.", {
    x: 0.75, y: 1.55, w: W - 1.5, h: 0.7,
    fontSize: 28, fontFace: FONT_HEAD, color: WHITE, bold: true, margin: 0,
  });

  // Big contrast block
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.75, y: 2.6, w: W - 1.5, h: 2.2,
    fill: { color: BG_PANEL }, line: { color: BG_LIFT, width: 1 },
  });
  slide.addText([
    { text: "The real danger isn't smart AI.\n", options: { color: DIM, fontSize: 20 } },
    { text: "The real danger is ", options: { color: WHITE, fontSize: 26 } },
    { text: "humans getting lazy", options: { color: YELLOW, fontSize: 26, bold: true } },
    { text: "\nand losing the habit of deciding things.", options: { color: WHITE, fontSize: 26 } },
  ], {
    x: 1.0, y: 2.7, w: W - 2.0, h: 2.0,
    fontFace: FONT_HEAD, align: "center", valign: "middle", margin: 0,
  });

  // Mission line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.75, y: 5.1, w: W - 1.5, h: 1.8,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addText(
    "Astrion OS is designed so you stay awake at the wheel — even when the AI drives better than you.",
    {
      x: 1.0, y: 5.2, w: W - 2.0, h: 1.6,
      fontSize: 22, fontFace: FONT_HEAD, color: WHITE, bold: true,
      align: "center", valign: "middle", margin: 0,
    }
  );

  slide.addNotes(
    "Okay this is the serious slide. AI is getting crazy powerful, crazy fast. Everyone's worried about robots taking over. " +
    "I actually don't think that's the biggest risk. I think the biggest risk is that humans get LAZY — we let AI make all our " +
    "decisions, and slowly we forget how to decide things ourselves. That's what Astrion is designed to stop. The 'it asks before " +
    "doing big stuff' part isn't annoying pop-ups — it's more like a friend who says 'hey, did you think about this?' It keeps you sharp. " +
    "I want to make an OS that helps people stay smart as AI gets smart. That's why I'm doing this."
  );
  footer(slide, 8, 12);
}

// ------------------------------------------------------------
// SLIDE 9 — The Roadmap (milestone table)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "The Roadmap");

  slide.addText("Nine milestones from shell to self-improvement.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.5,
    fontSize: 18, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  const headerOpts = { fill: { color: ACCENT }, color: WHITE, bold: true, fontSize: 14, fontFace: FONT_HEAD, align: "center", valign: "middle" };
  const cellBase   = { color: WHITE, fontSize: 13, fontFace: FONT_BODY, valign: "middle", fill: { color: BG_PANEL } };
  const when       = { color: CYAN,  fontSize: 13, fontFace: FONT_BODY, valign: "middle", fill: { color: BG_PANEL }, align: "center" };

  const rows = [
    [{ text: "#", options: headerOpts }, { text: "WHAT", options: headerOpts }, { text: "WHEN", options: headerOpts }],
    [{ text: "M0", options: { ...cellBase, bold: true, color: GREEN, align: "center" } }, { text: "Finish the native desktop shell", options: cellBase }, { text: "This week ✓", options: { ...when, color: GREEN, bold: true } }],
    [{ text: "M1", options: { ...cellBase, bold: true, color: GREEN, align: "center" } }, { text: "Intent Kernel (you say what you want)", options: cellBase }, { text: "Month 2 ✓", options: { ...when, color: GREEN, bold: true } }],
    [{ text: "M2", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: 'Replace files with a "thinking graph"', options: cellBase }, { text: "Month 3", options: when }],
    [{ text: "M3", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: "Wire up the two brains (S1 + S2)", options: cellBase }, { text: "Month 4", options: when }],
    [{ text: "M4", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: "AI writes code with receipts", options: cellBase }, { text: "Month 6", options: when }],
    [{ text: "M5", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: "Everything is undoable", options: cellBase }, { text: "Month 7", options: when }],
    [{ text: "M6", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: "AI asks smart questions", options: cellBase }, { text: "Month 8", options: when }],
    [{ text: "M7", options: { ...cellBase, bold: true, color: ACCENT, align: "center" } }, { text: 'Friends can share their own "intents"', options: cellBase }, { text: "Month 10", options: when }],
    [{ text: "M8", options: { ...cellBase, bold: true, color: PURPLE, align: "center" } }, { text: "AI can fix its own bugs (safely)", options: cellBase }, { text: "Month 12", options: { ...when, color: PURPLE, bold: true } }],
  ];

  slide.addTable(rows, {
    x: 0.75, y: 2.15, w: W - 1.5,
    colW: [1.1, 7.5, 3.2],
    rowH: 0.44,
    border: { pt: 1, color: BG_LIFT },
    fontFace: FONT_BODY,
  });

  slide.addNotes(
    "Here's the plan. Nine milestones. M0 is the native desktop shell — done. M1 is the Intent Kernel — done. " +
    "M2 is next: replacing files and folders with a 'thinking graph' so Astrion can actually understand what's " +
    "connected to what. Then the two brains, then code with receipts, then undo, then smart questions, then skill " +
    "sharing, and finally M8 — the dream — Astrion can safely improve its own code. " +
    "Each milestone has a demo I can show you. If I get stuck, I'll come back and ask for help."
  );
  footer(slide, 9, 12);
}

// ------------------------------------------------------------
// SLIDE 10 — How You Can Help (8-row jobs table)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "How You Can Help");

  slide.addText("You don't need to code. Pick ONE job you want to try.", {
    x: 0.75, y: 1.45, w: W - 1.5, h: 0.5,
    fontSize: 20, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  const thOpts   = { fill: { color: ACCENT }, color: WHITE, bold: true, fontSize: 13, fontFace: FONT_HEAD, align: "center", valign: "middle" };
  const iconOpts = { color: WHITE, fontSize: 20, align: "center", valign: "middle", fill: { color: BG_PANEL } };
  const nameOpts = { color: WHITE, bold: true, fontSize: 15, fontFace: FONT_HEAD, valign: "middle", fill: { color: BG_PANEL } };
  const descOpts = { color: MUTED, fontSize: 12, fontFace: FONT_BODY, valign: "middle", fill: { color: BG_PANEL } };

  const jobs = [
    ["🧪", "Tester",       "Install the ISO on your laptop, click stuff, tell me what breaks"],
    ["🎨", "Designer",     "Draw wallpapers, app icons, loading screens"],
    ["🔍", "UX Reviewer",  "Try the OS, tell me what's confusing or slow"],
    ["✍️", "Writer",       "Write app descriptions, help text, the user guide"],
    ["💡", "Ideas Person", "Suggest apps or features you wish existed"],
    ["🏷️", "Namer",        "Come up with names for new apps and features"],
    ["📣", "Hype Person",  "Share progress on your socials, tell friends"],
    ["🐛", "Bug Hunter",   "Find weird stuff, screenshot it, send it to me"],
  ];

  const tableRows = [
    [
      { text: "", options: thOpts },
      { text: "JOB", options: thOpts },
      { text: "WHAT IT IS", options: thOpts },
    ],
    ...jobs.map(([icon, name, desc]) => [
      { text: icon, options: iconOpts },
      { text: name, options: nameOpts },
      { text: desc, options: descOpts },
    ]),
  ];

  slide.addTable(tableRows, {
    x: 0.75, y: 2.1, w: W - 1.5,
    colW: [0.9, 2.6, W - 1.5 - 0.9 - 2.6],
    rowH: 0.52,
    border: { pt: 1, color: BG_LIFT },
    fontFace: FONT_BODY,
  });

  slide.addText("Pick one. That's it.", {
    x: 0.75, y: 6.85, w: W - 1.5, h: 0.4,
    fontSize: 16, fontFace: FONT_BODY, color: CYAN, italic: true, align: "center", margin: 0,
  });

  slide.addNotes(
    "Okay here's the slide where I need you. I know none of you code. That's fine. Coding is my job. But there are EIGHT " +
    "jobs you can do that don't need any code at all. Testers just install Astrion on their laptop and tell me what breaks. " +
    "Designers draw wallpapers or icons. UX reviewers tell me what's confusing. Writers help me write descriptions and the " +
    "user guide. Ideas people tell me what apps they wish existed. Namers come up with names for new features. Hype people " +
    "just share progress on their Instagram or wherever. Bug hunters find weird stuff and screenshot it. " +
    "Pick ONE that sounds fun. That's all I'm asking. Even one of these makes Astrion better."
  );
  footer(slide, 10, 12);
}

// ------------------------------------------------------------
// SLIDE 11 — Live Demo (placeholder + talking points)
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);
  slideTitle(slide, "Live Demo");

  slide.addText("Let me show you what's working right now.", {
    x: 0.75, y: 1.5, w: W - 1.5, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY, color: MUTED, italic: true, margin: 0,
  });

  // Left: demo checklist
  const demoItems = [
    "Boot the ISO in a VM",
    "Click around the native desktop",
    "Open Terminal",
    "Try Spotlight search (Ctrl+Space)",
    "Show the GitHub Releases page",
  ];
  demoItems.forEach((d, i) => {
    const y = 2.3 + i * 0.7;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.85, y: y + 0.18, w: 0.18, h: 0.18,
      fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
    });
    slide.addText(d, {
      x: 1.2, y: y, w: 6.3, h: 0.55,
      fontSize: 18, fontFace: FONT_BODY, color: WHITE,
      valign: "middle", margin: 0,
    });
  });

  // Talking-points strip
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.85, y: 6.0, w: 6.8, h: 0.9,
    fill: { color: BG_PANEL }, line: { color: ACCENT, width: 1 },
  });
  slide.addText('"This is a real operating system — not a website."', {
    x: 0.85, y: 6.0, w: 6.8, h: 0.9,
    fontSize: 14, fontFace: FONT_BODY, color: CYAN, italic: true,
    align: "center", valign: "middle", margin: 0,
  });

  // Right: screenshot placeholder
  imagePlaceholder(slide, 8.0, 1.5, 4.8, 5.4, "drop live-demo screenshot here");

  slide.addNotes(
    "This is your live demo slide. Before the meeting, have the ISO running in a VM or show the GitHub release page. " +
    "Click around. Don't rehearse it — they can see if it's real. If something breaks live, that's actually GOOD — it makes " +
    "it feel real and you can say 'this is exactly why I need testers.' " +
    "Talking points during demo: 'This is a real operating system. I'm not showing you a website.' " +
    "'Every app in this dock, I wrote or helped write.' 'When I press Ctrl+Space…' — then show Spotlight. " +
    "'The browser you're seeing is my own browser, not Chrome, not Safari.' " +
    "'I'm going to mess something up on purpose so you can see it's real.' (optional)"
  );
  footer(slide, 11, 12);
}

// ------------------------------------------------------------
// SLIDE 12 — Thank You
// ------------------------------------------------------------
{
  const slide = pres.addSlide();
  baseBackground(slide);

  // Big center title
  slide.addText("Thank you.", {
    x: 0.5, y: 1.6, w: W - 1, h: 1.4,
    fontSize: 96, fontFace: FONT_HEAD, color: WHITE, bold: true,
    align: "center", valign: "middle", margin: 0,
  });

  slide.addText("ASTRION OS", {
    x: 0.5, y: 3.1, w: W - 1, h: 0.7,
    fontSize: 28, fontFace: FONT_HEAD, color: ACCENT, bold: true,
    align: "center", charSpacing: 6, margin: 0,
  });

  // Link pill
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 2.5, y: 4.0, w: W - 5, h: 0.9,
    fill: { color: BG_PANEL }, line: { color: ACCENT, width: 2 }, rectRadius: 0.45,
  });
  slide.addText("github.com/viraajbindra-a11y/Astrion-OS", {
    x: 2.5, y: 4.0, w: W - 5, h: 0.9,
    fontSize: 22, fontFace: FONT_BODY, color: WHITE, bold: true,
    align: "center", valign: "middle", margin: 0,
  });

  slide.addText("The ISO is on the Releases page — go download it if you want to try it.", {
    x: 0.5, y: 5.1, w: W - 1, h: 0.5,
    fontSize: 16, fontFace: FONT_BODY, color: MUTED, italic: true, align: "center", margin: 0,
  });

  // Big Questions? accent
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.9, w: W - 1, h: 0.9,
    fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addText("Questions?", {
    x: 0.5, y: 5.9, w: W - 1, h: 0.9,
    fontSize: 32, fontFace: FONT_HEAD, color: WHITE, bold: true,
    align: "center", valign: "middle", margin: 0,
  });

  slide.addNotes(
    "That's it. Any questions? Don't be embarrassed — the whole point of the thinking-house metaphor is that normal people " +
    "should be able to get this. If something didn't land, tell me and I'll fix the slide for next time. " +
    "And remember: pick one job from slide 10 and I'll send you what you need to get started."
  );
  footer(slide, 12, 12);
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------
pres.writeFile({ fileName: "/Users/parul/Nova OS/tasks/astrion-os-presentation.pptx" })
  .then(fn => console.log("Wrote:", fn))
  .catch(err => { console.error(err); process.exit(1); });
