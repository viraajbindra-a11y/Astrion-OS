// Astrion OS — API Surface Lock
//
// FROZEN as of 2026-05-09. Adding entries here requires explicit review.
//
// The strategic review on 2026-05-09 flagged scope creep as a real risk:
// "76 apps is too many; minigames dilute brand. AI-as-feature-in-every-app
// is scope explosion." That same risk applies to internal API surfaces —
// every new capability ID, IPC channel, and skill-registry function is a
// permanent commitment with hallucination + maintenance debt.
//
// This file is the lock. The v03 verification suite reads it and FAILS if
// the actual surface diverges:
//   - capability-providers.js gains/loses a registerCapability call
//   - distro/astrion-browser/main.js gains/loses an ipcMain.handle channel
//   - skill-registry.js gains/loses a public export
//
// To add a new entry on purpose:
//   1. Justify it. Is there an existing capability/channel that already
//      does this? Could the work be a skill instead of a new IPC?
//   2. Update the corresponding Set below.
//   3. The test will pass. The diff in this file is the conversation.
//
// To remove an entry: same drill — update the Set, write a commit
// message that explains why.
//
// The point isn't paperwork. It's a tripwire that turns "I'll just add
// one more handler" into a moment where you have to look at the whole
// surface and decide if the new entry earns its keep.
//
// Companion doc: tasks/api-surface-lock.md

export const LOCK_DATE = '2026-05-09';

// ─── Capability provider IDs ──────────────────────────────────────
// 41 capabilities registered in js/kernel/capability-providers.js as of
// the lock date. The v03 test asserts the live registry matches this set
// after capability-providers.js has been imported.
export const LOCKED_CAPABILITIES = new Set([
  'ai.ask',
  'ai.explain',
  'ai.summarize',
  'app.archive',
  'app.bundle',
  'app.open',
  'app.promote',
  'branch.create',
  'branch.discard',
  'branch.merge',
  'branch.rewind',
  'browser.navigate',
  'chat.sendAsAgent',
  'code.generate',
  'code.listDir',
  'code.readFile',
  'code.search',
  'code.writeFile',
  'compute.calculate',
  'files.createFile',
  'files.createFolder',
  'game.autoplay',
  'game.getState',
  'game.makeMove',
  'notes.create',
  'reminder.create',
  'screenshot.take',
  'spec.freeze',
  'spec.generate',
  'system.lock',
  'system.setBrightness',
  'system.shutdown',
  'terminal.exec',
  'tests.generate',
  'tests.run',
  'todo.create',
  'translate.text',
  'volume.decrease',
  'volume.mute',
  'volume.set',
  'volume.unmute',
]);

// ─── Browser IPC channels ─────────────────────────────────────────
// 47 ipcMain.handle channels in distro/astrion-browser/main.js as of the
// lock date. The v03 test fetches main.js source and regex-parses the
// channel names, then asserts the set matches.
//
// Channel naming convention is `domain:verb` (sometimes `domain:noun`).
// Don't introduce a new domain without updating this lock.
export const LOCKED_BROWSER_IPC = new Set([
  // Astrion newtab + external open
  'astrion:newtab-url',
  'astrion:open-external',
  'astrion:server',
  // Ad/tracker blocker telemetry
  'blocker:stats',
  // Bookmarks
  'bookmarks:add',
  'bookmarks:list',
  'bookmarks:remove',
  // Downloads
  'downloads:clear',
  'downloads:list',
  'downloads:open',
  'downloads:show',
  // Find in page
  'find:start',
  'find:stop',
  // Fullscreen
  'fullscreen:state',
  'fullscreen:toggle',
  // History
  'history:clear',
  'history:list',
  // Reader mode
  'reader:extract-and-open',
  'reader:get-content',
  // Reading list (separate from bookmarks)
  'reading-list:add',
  'reading-list:add-current',
  'reading-list:list',
  'reading-list:remove',
  // Settings
  'settings:get',
  'settings:set',
  // AI sidebar
  'sidebar:ask',
  'sidebar:page-context',
  'sidebar:state',
  'sidebar:toggle',
  // Per-tab navigation
  'tab:back',
  'tab:forward',
  'tab:navigate',
  'tab:reload',
  'tab:stop',
  // Tab collection ops
  'tabs:active',
  'tabs:close',
  'tabs:close-others',
  'tabs:close-right',
  'tabs:duplicate',
  'tabs:list',
  'tabs:mute',
  'tabs:new',
  'tabs:pin',
  'tabs:switch',
  // Zoom (per-site persisted)
  'zoom:in',
  'zoom:out',
  'zoom:reset',
]);

// ─── Skill-registry public exports ─────────────────────────────────
// 11 named exports from js/kernel/skill-registry.js as of the lock date.
// The v03 test imports the module and asserts the export keys match.
export const LOCKED_SKILL_REGISTRY_EXPORTS = new Set([
  'isSkillEnabled',
  'setSkillEnabled',
  'getDisabledSkills',
  'installUserSkill',
  'uninstallUserSkill',
  'listSkills',
  'getSkill',
  'matchPhrase',
  'runSkill',
  'loadSkillRegistry',
  '_resetForTests',
]);
