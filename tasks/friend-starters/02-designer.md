# 🎨 Designer — Starter Task

## What to send them

> Hey! Thanks for picking Designer. Here's your first 15-minute task.
>
> **Goal:** Design **one** wallpaper for Astrion OS. Any style — pixel art, abstract gradient, photo, collage, whatever matches your vibe.
>
> **The only rules:**
> 1. **Size: 2736 × 1824 pixels** (or any 3:2 ratio). That's what Astrion's target screen size is.
> 2. **Mood: should feel like a "thinking computer"** — futuristic, curious, a little mysterious. Not corporate, not childish.
> 3. **Looks good behind icons and text** — so not TOO busy in the center. Dark colors are fine (Astrion is dark themed).
> 4. **Fun is required.** If it doesn't feel fun to you while making it, throw it out and try something else.
>
> **Tools you can use:**
> - [Canva](https://canva.com) — free, easy
> - [Pixilart](https://pixilart.com) — free, for pixel art
> - [Photopea](https://photopea.com) — free, browser Photoshop
> - Just draw it on paper and take a photo — also valid
>
> **Examples to riff on if you're stuck:**
> - A cluster of abstract brain/neuron shapes floating in space
> - A sunset over a strange alien landscape with two moons
> - A minimalist gradient with a single glowing shape in the center
> - Your own style, whatever that is
>
> **Send it as a PNG or JPG when you're done.** Name it after yourself (`koa-wallpaper-1.png`) so I can credit you.

## What Viraaj does with the result

1. Save to `assets/wallpapers/contrib/<name>-wallpaper-1.png`
2. Add an entry to the wallpaper picker in `js/shell/setup-wizard.js` (around line 6):
   ```js
   { id: 'koa1', name: "Koa's Abstract", colors: 'url("assets/wallpapers/contrib/koa-wallpaper-1.png")' },
   ```
3. **Credit them in the release notes.**
4. The friend's name now literally appears in Astrion OS every time someone opens Settings → Wallpaper. That's huge social reward — tell them.

## Follow-up task

Once their first wallpaper lands, ask for:
- An Astrion OS logo (square, any style)
- An app icon (128×128) for one of the existing apps they think looks bad
- A loading screen illustration
