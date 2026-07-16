# Antialiased font atlas (Inter)

`gen_font.py` rasterizes Inter (SIL OFL) into `src/af_font.h` — grayscale glyph
atlases the kernel alpha-blends (`src/af.c`) to render antialiased UI text that
matches the web build. Faces: reg13/reg16/sb16/sb30.

## Regenerate
```bash
cd kernel/tools/font
curl -sSL -o InterVar.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
python3 gen_font.py            # writes af_font.h + af_preview.png
cp af_font.h ../../src/af_font.h
```
`af_preview.png` renders from the EXTRACTED atlas data (not PIL) — eyeball it to
confirm the atlas is correct before rebuilding the kernel.
