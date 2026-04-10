# Astrion OS — Lessons Learned

## Architecture
1. **Never use RGBA transparency without a compositor.** All `rgba()` in CSS and `gdk_screen_get_rgba_visual()` in C render as WHITE on X11 without compositing. Use solid colors only.
2. **`gtk_window_fullscreen()` needs a window manager.** Without a WM, use `gtk_window_resize(w, screen_width, screen_height)` + `gtk_window_move(w, 0, 0)` instead.
3. **`gtk_window_begin_move_drag()` needs a WM.** Without a WM, implement manual drag via motion-notify-event.
4. **GDK_SCALE=2 + GDK_DPI_SCALE compound.** Don't use both — GDK_SCALE alone handles HiDPI for native shell. Web content zoom is separate (webkit_web_view_set_zoom_level).
5. **ESM imports must be at the top of the file.** `import { X } from 'y'` inside a function or try/catch block crashes Node.js in ESM mode.
6. **C forward declarations required.** If function A calls function B and B is defined after A, add `static void B(...)` declaration at the top.
7. **C++ lambda syntax (`+[](...){}`) doesn't work in C.** Use named callback functions.
8. **A web page is NOT an operating system.** Users notice Ctrl+R, right-click menus, scroll bounce, and other browser behaviors. A native shell with WebKitGTK app windows is the right architecture.

## Live ISO
9. **Live ISOs lose ALL state on reboot.** localStorage, Wi-Fi profiles, settings — everything is in RAM overlay. Install to disk for persistence.
10. **System clock is wrong on live boot.** NTP needs internet, internet needs Wi-Fi, Wi-Fi needs manual setup. Use `ntpdate -u` (UDP, no SSL) in .xinitrc.
11. **DNS must be set explicitly.** Live ISOs often have empty `/etc/resolv.conf`. Write `nameserver 8.8.8.8` before anything network-dependent.
12. **SSL cert errors = wrong clock.** If `curl` fails with cert error (code 60), fix the date first: `sudo date -s "2026-04-07 12:00:00"`.

## Surface Pro 6
13. **Marvell Wi-Fi needs `firmware-misc-nonfree`.** The AVASTAR chip doesn't work without proprietary firmware blobs.
14. **Surface Pro 6 is 2736x1824 at 267 DPI.** Without scaling, everything is microscopic. GDK_SCALE=2 for native GTK, webkit_web_view_set_zoom_level(1.75) for web content.
15. **The `-nocursor` flag on `startx` permanently hides the cursor.** Don't use it. Use `xsetroot -cursor_name left_ptr` instead.
16. **`prompt()` may be blocked in WebKitGTK.** Use custom HTML dialogs instead of JavaScript `prompt()`, `confirm()`, `alert()`.

## Development
17. **`sudo nova-update` only updates web files (JS/CSS/HTML).** Compiled C binaries need a new ISO build or manual recompile on the device.
18. **Test on real hardware, not just in the browser.** Many features (battery, Wi-Fi, Bluetooth, audio) only work on the ISO.
19. **Don't hallucinate features.** Always verify with `grep` or `ls` that code actually exists before claiming it works.
20. **Cancel and retrigger builds rather than waiting for stale ones.** If you push a fix after triggering a build, the running build doesn't have the fix.

## Releases & ISO Publishing
21. **The `build-iso.yml` workflow only uploads to Actions artifacts, not to Releases.** Artifacts expire in 30 days and require login to download. For public distribution, the ISO must be manually uploaded to the Release via `gh release upload`. Fix pending: patch the workflow to auto-publish to release on tag push.
22. **Before publishing a stale ISO artifact, verify no `distro/` commits since the build.** Use `git log --oneline <artifact-sha>..HEAD -- distro/` — if it's empty, the ISO's shell/C code is still current. If non-empty, trigger a fresh build first.
23. **Always ship a SHA256 alongside any ISO.** Users need to verify integrity. `shasum -a 256 file.iso | tee file.iso.sha256` then upload both.
24. **GitHub release assets are hard-capped at 2 GB per file.** Check ISO size before attempting upload: `ls -lh file.iso`. Astrion ISO is 1.86 GB — safe, but close to the cap.
25. **Use `gh release upload --clobber` for new assets, not for replacing unrelated existing ones.** `--clobber` only overwrites assets with the same filename, leaves others alone.
26. **Name release assets with the product name + version + arch.** `astrion-os-0.1.95-amd64.iso`, not `nova-os.iso`. Makes the filename self-documenting and matches the current brand.

## Plan / Workflow
27. **The built-in `EnterPlanMode`/`ExitPlanMode` exists and is tighter than free-form plans in `tasks/todo.md`.** Plan mode enforces read-only exploration and a formal approval dialog before any edits. Use it for non-trivial tasks alongside `tasks/todo.md` (the todo file is the durable artifact, plan mode is the gate).
28. **Inversion thinking belongs in the plan itself, not just in the code.** For every task, list what will break, then invert each failure mode into the solution. This is more useful than a flat task list because it catches hidden assumptions before implementation.
29. **Commit large-file state to disk early, not at the end of a task.** Long sessions with many file edits can run out of context. Writing PLAN.md, presentation.md, etc. as soon as they're drafted (not buffered in chat) prevents losing work when context fills.

## Browser Preview & CSS Debugging
30. **`getComputedStyle(el).backgroundColor` can return stale mid-transition values.** When an element has `transition: background 0.3s` and you set its state via `dataset.brain = 's2'`, `getComputedStyle` read immediately after will return the interpolated (still in-progress) value, NOT the final target. This can make it look like CSS cascade isn't working when it actually is. Fix: either wait longer than the transition duration (e.g., 500 ms) before reading, OR use `el.computedStyleMap().get('background-color').toString()` AFTER the transition, OR use visual screenshot verification (most reliable). Inline style `!important` tests can be similarly confused by transition races.
31. **Leftover injected `<style>` tags and inline `element.style` from debugging pollute subsequent tests.** When running `preview_eval` multiple times, anything you inject persists across evals. Always remove injected styles and clear `element.removeAttribute('style')` before re-testing, OR reload the page between tests.
32. **The web Astrion OS boots through a login screen that only resolves on a click.** `js/boot.js` around line 278 has `loginScreen.addEventListener('click', ...)` that resolves the login promise when no password is set. In an automated preview environment (headless browser), the login screen never gets clicked, so `initMenubar()` and every downstream init never runs — the menubar DOM is there but has no handlers. When verifying behavior in preview: `document.getElementById('login-screen').click()` to advance past this gate. Affects every shell module that `boot.js` initializes after Phase 4.
33. **Astrion has a 5-minute idle screensaver.** If you step away from the preview mid-debug, the screensaver covers the desktop and you'll see stars + clock instead of your changes. Dismiss via `document.getElementById('screensaver').style.display = 'none'` or by triggering real input events (mousemove/keydown on the document).
34. **Files created by `sudo` in one CI step are root-owned and unusable by subsequent non-sudo steps.** `distro/build.sh` runs with `sudo`, which leaves `distro/output/nova-os.iso` owned by root. The next step in the workflow (`Publish ISO to latest GitHub release`) runs as the `runner` user and fails on `mv`/`rm` with `Permission denied`. Fix: add `sudo chown -R "$(whoami):$(whoami)" distro/output` at the top of any non-sudo step that touches files created by a sudo step. Cost is ~1 second and it's idempotent.
35. **`package.json` version drifts from git release tags in this repo.** The Electron auto-build pipeline (`build-desktop.yml`) bumps `package.json` independently, so it can say `1.0.0` while the latest release is `v0.1.95`. Always read version info from the latest release tag (`gh release list --limit 1 --json tagName`) instead of `package.json` when naming assets that must match the release. Strip the leading `v` with `VERSION="${LATEST_TAG#v}"`.
