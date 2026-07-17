# Antialiased font atlases (Inter + JetBrains Mono)

`gen_font.py` rasterizes two SIL OFL fonts into `src/af_font.h` — grayscale
glyph atlases the kernel alpha-blends (`src/af.c`) to render antialiased text:

- **Inter** — UI chrome (top bar, dock, window titles). Faces reg13/reg16/sb16/sb30.
- **JetBrains Mono** — terminal + app interiors (monospace, so columns line up
  and `Il1`/`O0` stay distinct). Face: mono (px20).

The generated `af_font.h` is committed, so a normal build needs no TTFs — they
are only needed to *regenerate* the atlas.

## Regenerate
```bash
cd kernel/tools/font
curl -sSL -o InterVar.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
curl -sSL -o JetBrainsMono-Regular.ttf "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf"
python3 gen_font.py            # writes af_font.h + af_preview.png
cp af_font.h ../../src/af_font.h
```
`af_preview.png` renders from the EXTRACTED atlas data (not PIL) — eyeball it to
confirm the atlas is correct before rebuilding the kernel.
