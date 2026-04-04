/**
 * NOVA OS Kernel — Framebuffer Graphics Implementation
 * All drawing happens here. We write directly to video memory.
 */

#include "framebuffer.h"
#include "font.h"

static uint32_t *front_buffer;  // actual video memory
static uint32_t *back_buffer;   // off-screen buffer (prevents flicker)
static uint32_t screen_width;
static uint32_t screen_height;
static uint32_t screen_pitch;   // bytes per row

// Simple memory operations (we don't have libc)
static void *nova_memset(void *dest, int val, size_t n) {
    uint8_t *p = (uint8_t *)dest;
    while (n--) *p++ = (uint8_t)val;
    return dest;
}

static void *nova_memcpy(void *dest, const void *src, size_t n) {
    uint8_t *d = (uint8_t *)dest;
    const uint8_t *s = (const uint8_t *)src;
    while (n--) *d++ = *s++;
    return dest;
}

// Heap for back buffer (simple bump allocator)
static uint8_t heap[16 * 1024 * 1024]; // 16MB heap
static size_t heap_offset = 0;

static void *nova_alloc(size_t size) {
    void *ptr = &heap[heap_offset];
    heap_offset += size;
    return ptr;
}

void fb_init(BootInfo *info) {
    front_buffer = (uint32_t *)info->framebuffer_addr;
    screen_width = info->width;
    screen_height = info->height;
    screen_pitch = info->pitch;

    // Allocate back buffer for double buffering
    size_t buffer_size = screen_width * screen_height * 4;
    back_buffer = (uint32_t *)nova_alloc(buffer_size);

    // Clear to dark background
    fb_clear(COLOR_BG);
    fb_swap();
}

uint32_t fb_width(void) { return screen_width; }
uint32_t fb_height(void) { return screen_height; }

// Convert Color struct to packed 32-bit pixel
static inline uint32_t color_to_pixel(Color c) {
    return (uint32_t)c.a << 24 | (uint32_t)c.r << 16 | (uint32_t)c.g << 8 | (uint32_t)c.b;
}

void fb_put_pixel(int x, int y, Color color) {
    if (x < 0 || x >= (int)screen_width || y < 0 || y >= (int)screen_height) return;
    back_buffer[y * screen_width + x] = color_to_pixel(color);
}

Color fb_blend(Color bg, Color fg) {
    if (fg.a == 255) return fg;
    if (fg.a == 0) return bg;

    uint16_t alpha = fg.a;
    uint16_t inv = 255 - alpha;
    return (Color){
        .b = (uint8_t)((fg.b * alpha + bg.b * inv) / 255),
        .g = (uint8_t)((fg.g * alpha + bg.g * inv) / 255),
        .r = (uint8_t)((fg.r * alpha + bg.r * inv) / 255),
        .a = 255
    };
}

void fb_put_pixel_alpha(int x, int y, Color color) {
    if (x < 0 || x >= (int)screen_width || y < 0 || y >= (int)screen_height) return;
    if (color.a == 255) {
        back_buffer[y * screen_width + x] = color_to_pixel(color);
        return;
    }

    uint32_t existing = back_buffer[y * screen_width + x];
    Color bg = {
        .b = (uint8_t)(existing & 0xFF),
        .g = (uint8_t)((existing >> 8) & 0xFF),
        .r = (uint8_t)((existing >> 16) & 0xFF),
        .a = 255
    };
    Color blended = fb_blend(bg, color);
    back_buffer[y * screen_width + x] = color_to_pixel(blended);
}

void fb_fill_rect(int x, int y, int w, int h, Color color) {
    uint32_t pixel = color_to_pixel(color);
    int x0 = MAX(0, x);
    int y0 = MAX(0, y);
    int x1 = MIN((int)screen_width, x + w);
    int y1 = MIN((int)screen_height, y + h);

    for (int py = y0; py < y1; py++) {
        for (int px = x0; px < x1; px++) {
            back_buffer[py * screen_width + px] = pixel;
        }
    }
}

void fb_fill_rect_alpha(int x, int y, int w, int h, Color color) {
    int x0 = MAX(0, x);
    int y0 = MAX(0, y);
    int x1 = MIN((int)screen_width, x + w);
    int y1 = MIN((int)screen_height, y + h);

    for (int py = y0; py < y1; py++) {
        for (int px = x0; px < x1; px++) {
            fb_put_pixel_alpha(px, py, color);
        }
    }
}

void fb_draw_rect(int x, int y, int w, int h, Color color) {
    fb_fill_rect(x, y, w, 1, color);           // top
    fb_fill_rect(x, y + h - 1, w, 1, color);   // bottom
    fb_fill_rect(x, y, 1, h, color);            // left
    fb_fill_rect(x + w - 1, y, 1, h, color);   // right
}

void fb_fill_rounded_rect(int x, int y, int w, int h, int r, Color color) {
    // Fill the main body
    fb_fill_rect(x + r, y, w - 2 * r, h, color);     // center
    fb_fill_rect(x, y + r, r, h - 2 * r, color);     // left
    fb_fill_rect(x + w - r, y + r, r, h - 2 * r, color); // right

    // Draw rounded corners
    for (int cy = 0; cy < r; cy++) {
        for (int cx = 0; cx < r; cx++) {
            if (cx * cx + cy * cy <= r * r) {
                // Top-left
                fb_put_pixel(x + r - cx - 1, y + r - cy - 1, color);
                // Top-right
                fb_put_pixel(x + w - r + cx, y + r - cy - 1, color);
                // Bottom-left
                fb_put_pixel(x + r - cx - 1, y + h - r + cy, color);
                // Bottom-right
                fb_put_pixel(x + w - r + cx, y + h - r + cy, color);
            }
        }
    }
}

void fb_draw_line(int x0, int y0, int x1, int y1, Color color) {
    // Bresenham's line algorithm
    int dx = x1 - x0;
    int dy = y1 - y0;
    int sx = dx > 0 ? 1 : -1;
    int sy = dy > 0 ? 1 : -1;
    dx = dx < 0 ? -dx : dx;
    dy = dy < 0 ? -dy : dy;

    int err = dx - dy;
    while (1) {
        fb_put_pixel(x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx)  { err += dx; y0 += sy; }
    }
}

void fb_fill_circle(int cx, int cy, int r, Color color) {
    for (int y = -r; y <= r; y++) {
        for (int x = -r; x <= r; x++) {
            if (x * x + y * y <= r * r) {
                fb_put_pixel(cx + x, cy + y, color);
            }
        }
    }
}

void fb_draw_circle(int cx, int cy, int r, Color color) {
    // Midpoint circle algorithm
    int x = r, y = 0;
    int err = 1 - r;
    while (x >= y) {
        fb_put_pixel(cx + x, cy + y, color);
        fb_put_pixel(cx - x, cy + y, color);
        fb_put_pixel(cx + x, cy - y, color);
        fb_put_pixel(cx - x, cy - y, color);
        fb_put_pixel(cx + y, cy + x, color);
        fb_put_pixel(cx - y, cy + x, color);
        fb_put_pixel(cx + y, cy - x, color);
        fb_put_pixel(cx - y, cy - x, color);
        y++;
        if (err < 0) {
            err += 2 * y + 1;
        } else {
            x--;
            err += 2 * (y - x) + 1;
        }
    }
}

void fb_clear(Color color) {
    fb_fill_rect(0, 0, screen_width, screen_height, color);
}

// Draw a character from the built-in bitmap font
void fb_draw_char(int x, int y, char c, Color color, int scale) {
    if (c < 32 || c > 126) c = '?';
    int idx = c - 32;

    for (int row = 0; row < FONT_HEIGHT; row++) {
        uint8_t bits = font_data[idx][row];
        for (int col = 0; col < FONT_WIDTH; col++) {
            if (bits & (1 << (FONT_WIDTH - 1 - col))) {
                if (scale == 1) {
                    fb_put_pixel(x + col, y + row, color);
                } else {
                    fb_fill_rect(x + col * scale, y + row * scale, scale, scale, color);
                }
            }
        }
    }
}

void fb_draw_string(int x, int y, const char *str, Color color, int scale) {
    int cx = x;
    while (*str) {
        if (*str == '\n') {
            cx = x;
            y += (FONT_HEIGHT + 2) * scale;
        } else {
            fb_draw_char(cx, y, *str, color, scale);
            cx += (FONT_WIDTH + 1) * scale;
        }
        str++;
    }
}

int fb_text_width(const char *str, int scale) {
    int maxw = 0, w = 0;
    while (*str) {
        if (*str == '\n') {
            if (w > maxw) maxw = w;
            w = 0;
        } else {
            w += (FONT_WIDTH + 1) * scale;
        }
        str++;
    }
    return w > maxw ? w : maxw;
}

int fb_text_height(int scale) {
    return FONT_HEIGHT * scale;
}

void fb_swap(void) {
    // Copy back buffer to front buffer (video memory)
    nova_memcpy(front_buffer, back_buffer, screen_width * screen_height * 4);
}

void fb_copy_rect(int sx, int sy, int dx, int dy, int w, int h) {
    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            int src = (sy + row) * screen_width + (sx + col);
            int dst = (dy + row) * screen_width + (dx + col);
            if (src >= 0 && src < (int)(screen_width * screen_height) &&
                dst >= 0 && dst < (int)(screen_width * screen_height)) {
                back_buffer[dst] = back_buffer[src];
            }
        }
    }
}
