/**
 * NOVA OS Kernel — Main Entry Point
 *
 * This is where the kernel starts after the bootloader hands off control.
 * It sets up the display, input devices, and runs the desktop GUI loop.
 *
 * This is a REAL kernel — no Linux, no libraries, just our code and hardware.
 */

#include "../include/types.h"
#include "../include/bootinfo.h"
#include "../gui/framebuffer.h"
#include "../drivers/keyboard.h"
#include "../drivers/mouse.h"

// --- String helpers (no libc!) ---
static int nova_strlen(const char *s) {
    int len = 0;
    while (*s++) len++;
    return len;
}

static void nova_strcpy(char *dest, const char *src) {
    while ((*dest++ = *src++));
}

static int nova_strcmp(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return *a - *b;
}

static void nova_itoa(int num, char *buf) {
    if (num == 0) { buf[0] = '0'; buf[1] = 0; return; }
    int i = 0, neg = 0;
    if (num < 0) { neg = 1; num = -num; }
    char tmp[16];
    while (num > 0) { tmp[i++] = '0' + (num % 10); num /= 10; }
    int j = 0;
    if (neg) buf[j++] = '-';
    while (i > 0) buf[j++] = tmp[--i];
    buf[j] = 0;
}

// --- Desktop State ---
#define MAX_WINDOWS 16
#define MENUBAR_HEIGHT 24
#define DOCK_HEIGHT 52
#define DOCK_ICON_SIZE 36
#define TITLEBAR_HEIGHT 28

typedef struct {
    bool    active;
    char    title[64];
    int32_t x, y;
    uint32_t width, height;
    int32_t z_order;
    bool    focused;
    bool    dragging;
    int32_t drag_offset_x, drag_offset_y;
    Color   color;  // content background color
} Window;

static Window windows[MAX_WINDOWS];
static int window_count = 0;
static int top_z = 0;
static int focused_window = -1;

// Dock apps
typedef struct {
    char name[32];
    char icon;     // single char icon for now
    Color color;
} DockApp;

static DockApp dock_apps[] = {
    {"Files",      'F', {255, 122, 0, 255}},   // blue
    {"Notes",      'N', {0, 200, 200, 255}},    // yellow
    {"Terminal",   'T', {0, 0, 0, 255}},         // black
    {"Calculator", 'C', {100, 100, 100, 255}},   // gray
    {"Draw",       'D', {0, 0, 200, 255}},       // red
    {"Settings",   'S', {120, 120, 120, 255}},   // gray
};
static int dock_app_count = 6;
static int dock_hovered = -1;

// Mouse cursor
static void draw_cursor(int x, int y) {
    // Simple arrow cursor drawn pixel by pixel
    Color white = COLOR_WHITE;
    Color black = COLOR_BLACK;
    // Arrow shape
    for (int i = 0; i < 12; i++) {
        fb_put_pixel(x, y + i, white);
        fb_put_pixel(x + 1, y + i, black);
    }
    for (int i = 0; i < 8; i++) {
        fb_put_pixel(x + i, y + i, white);
        fb_put_pixel(x + i + 1, y + i, black);
    }
    fb_fill_rect(x + 1, y + 1, 1, 10, white);
    for (int i = 1; i < 7; i++) {
        for (int j = 1; j <= i; j++) {
            fb_put_pixel(x + j, y + i, white);
        }
    }
}

// --- Window management ---
static int create_window(const char *title, int x, int y, int w, int h, Color bg) {
    if (window_count >= MAX_WINDOWS) return -1;

    for (int i = 0; i < MAX_WINDOWS; i++) {
        if (!windows[i].active) {
            windows[i].active = true;
            nova_strcpy(windows[i].title, title);
            windows[i].x = x;
            windows[i].y = y;
            windows[i].width = w;
            windows[i].height = h;
            windows[i].z_order = ++top_z;
            windows[i].focused = true;
            windows[i].dragging = false;
            windows[i].color = bg;
            window_count++;

            // Unfocus all others
            for (int j = 0; j < MAX_WINDOWS; j++) {
                if (j != i && windows[j].active) windows[j].focused = false;
            }
            focused_window = i;
            return i;
        }
    }
    return -1;
}

static void close_window(int idx) {
    if (idx < 0 || idx >= MAX_WINDOWS || !windows[idx].active) return;
    windows[idx].active = false;
    window_count--;
    if (focused_window == idx) focused_window = -1;
}

static void focus_window(int idx) {
    if (idx < 0 || !windows[idx].active) return;
    for (int i = 0; i < MAX_WINDOWS; i++) {
        windows[i].focused = false;
    }
    windows[idx].focused = true;
    windows[idx].z_order = ++top_z;
    focused_window = idx;
}

// Find window at screen coordinate (highest z-order first)
static int window_at(int x, int y) {
    int best = -1, best_z = -1;
    for (int i = 0; i < MAX_WINDOWS; i++) {
        if (!windows[i].active) continue;
        if (x >= windows[i].x && x < windows[i].x + (int)windows[i].width &&
            y >= windows[i].y && y < windows[i].y + (int)windows[i].height) {
            if (windows[i].z_order > best_z) {
                best = i;
                best_z = windows[i].z_order;
            }
        }
    }
    return best;
}

// --- Drawing ---
static void draw_menubar(void) {
    fb_fill_rect_alpha(0, 0, fb_width(), MENUBAR_HEIGHT,
        (Color){30, 30, 30, 200});

    // NOVA logo
    fb_fill_circle(12, MENUBAR_HEIGHT / 2, 5, COLOR_ACCENT);

    // App name
    const char *app_name = focused_window >= 0 ? windows[focused_window].title : "NOVA OS";
    fb_draw_string(24, 6, app_name, COLOR_WHITE, 1);

    // Menu items
    fb_draw_string(24 + fb_text_width(app_name, 1) + 16, 6, "File  Edit  View  Help", COLOR_TEXT2, 1);

    // Clock (right side) — simple static for now
    fb_draw_string(fb_width() - 80, 6, "NOVA OS", COLOR_TEXT2, 1);
}

static void draw_window(Window *w) {
    Color titlebar_color = w->focused ? COLOR_TITLEBAR : (Color){50, 50, 50, 255};

    // Window shadow
    fb_fill_rect_alpha(w->x + 4, w->y + 4, w->width, w->height,
        (Color){0, 0, 0, 80});

    // Titlebar
    fb_fill_rect(w->x, w->y, w->width, TITLEBAR_HEIGHT, titlebar_color);

    // Traffic lights
    int bx = w->x + 10;
    int by = w->y + TITLEBAR_HEIGHT / 2;
    fb_fill_circle(bx, by, 5, (Color){87, 95, 255, 255});     // close (red)
    fb_fill_circle(bx + 16, by, 5, (Color){46, 188, 254, 255}); // minimize (yellow)
    fb_fill_circle(bx + 32, by, 5, (Color){64, 200, 40, 255});  // maximize (green)

    // Title text
    int title_w = fb_text_width(w->title, 1);
    fb_draw_string(w->x + (w->width - title_w) / 2, w->y + 8, w->title, COLOR_TEXT2, 1);

    // Window content area
    fb_fill_rect(w->x, w->y + TITLEBAR_HEIGHT, w->width, w->height - TITLEBAR_HEIGHT, w->color);

    // Border
    fb_draw_rect(w->x, w->y, w->width, w->height, (Color){60, 60, 60, 255});
}

static void draw_dock(void) {
    int dock_width = dock_app_count * (DOCK_ICON_SIZE + 8) + 16;
    int dock_x = (fb_width() - dock_width) / 2;
    int dock_y = fb_height() - DOCK_HEIGHT - 6;

    // Dock background (rounded, translucent)
    fb_fill_rounded_rect(dock_x, dock_y, dock_width, DOCK_HEIGHT, 12,
        (Color){40, 40, 40, 180});

    // Dock icons
    for (int i = 0; i < dock_app_count; i++) {
        int ix = dock_x + 12 + i * (DOCK_ICON_SIZE + 8);
        int iy = dock_y + (DOCK_HEIGHT - DOCK_ICON_SIZE) / 2;
        bool hovered = (i == dock_hovered);

        if (hovered) iy -= 4; // lift on hover

        // Icon background
        fb_fill_rounded_rect(ix, iy, DOCK_ICON_SIZE, DOCK_ICON_SIZE, 8, dock_apps[i].color);

        // Icon letter
        char label[2] = {dock_apps[i].icon, 0};
        int lw = fb_text_width(label, 2);
        fb_draw_string(ix + (DOCK_ICON_SIZE - lw) / 2, iy + 8, label, COLOR_WHITE, 2);

        // Tooltip on hover
        if (hovered) {
            int tw = fb_text_width(dock_apps[i].name, 1);
            fb_fill_rounded_rect(ix + (DOCK_ICON_SIZE - tw - 12) / 2, iy - 22,
                tw + 12, 18, 4, (Color){30, 30, 30, 230});
            fb_draw_string(ix + (DOCK_ICON_SIZE - tw) / 2, iy - 18, dock_apps[i].name, COLOR_WHITE, 1);
        }
    }
}

static void draw_desktop_background(void) {
    // Gradient wallpaper — purple/blue
    for (uint32_t y = 0; y < fb_height(); y++) {
        for (uint32_t x = 0; x < fb_width(); x++) {
            uint8_t r = (uint8_t)(20 + y * 15 / fb_height() + x * 10 / fb_width());
            uint8_t g = (uint8_t)(15 + y * 10 / fb_height());
            uint8_t b = (uint8_t)(40 + y * 25 / fb_height() + x * 15 / fb_width());
            fb_put_pixel(x, y, (Color){b, g, r, 255});
        }
    }
}

// --- Main kernel loop ---
void kernel_main(BootInfo *boot_info) {
    // Initialize subsystems
    fb_init(boot_info);
    keyboard_init();
    mouse_init(fb_width(), fb_height());

    // Draw the initial desktop wallpaper (only once, it's expensive)
    draw_desktop_background();
    fb_swap();

    // Create a welcome window
    create_window("Welcome to NOVA OS", fb_width()/2 - 200, fb_height()/2 - 120, 400, 240,
        (Color){30, 30, 30, 255});

    // Main event loop — this runs forever
    while (1) {
        // Poll input
        mouse_poll();
        MouseState mouse = mouse_get_state();

        // Check dock hover
        int dock_width = dock_app_count * (DOCK_ICON_SIZE + 8) + 16;
        int dock_x = (fb_width() - dock_width) / 2;
        int dock_y = fb_height() - DOCK_HEIGHT - 6;
        dock_hovered = -1;

        if (mouse.y >= dock_y && mouse.y < dock_y + DOCK_HEIGHT &&
            mouse.x >= dock_x && mouse.x < dock_x + dock_width) {
            dock_hovered = (mouse.x - dock_x - 12) / (DOCK_ICON_SIZE + 8);
            if (dock_hovered < 0 || dock_hovered >= dock_app_count) dock_hovered = -1;

            // Click dock to open window
            if (mouse.left_clicked && dock_hovered >= 0) {
                int wx = 100 + (window_count % 5) * 30;
                int wy = 60 + (window_count % 5) * 30;
                create_window(dock_apps[dock_hovered].name, wx, wy, 500, 350,
                    (Color){30, 30, 30, 255});
            }
        }

        // Handle window interactions
        if (mouse.left_clicked) {
            int clicked = window_at(mouse.x, mouse.y);
            if (clicked >= 0) {
                focus_window(clicked);
                Window *w = &windows[clicked];

                // Check close button
                int bx = w->x + 10;
                int by = w->y + TITLEBAR_HEIGHT / 2;
                int dx = mouse.x - bx;
                int dy = mouse.y - by;
                if (dx*dx + dy*dy <= 25) { // within 5px radius of close button
                    close_window(clicked);
                }
                // Start dragging if on titlebar
                else if (mouse.y < w->y + TITLEBAR_HEIGHT) {
                    w->dragging = true;
                    w->drag_offset_x = mouse.x - w->x;
                    w->drag_offset_y = mouse.y - w->y;
                }
            }
        }

        // Handle window dragging
        if (mouse.left_button) {
            for (int i = 0; i < MAX_WINDOWS; i++) {
                if (windows[i].active && windows[i].dragging) {
                    windows[i].x = mouse.x - windows[i].drag_offset_x;
                    windows[i].y = MAX(MENUBAR_HEIGHT, mouse.y - windows[i].drag_offset_y);
                }
            }
        }

        if (mouse.left_released) {
            for (int i = 0; i < MAX_WINDOWS; i++) {
                windows[i].dragging = false;
            }
        }

        // Handle keyboard
        while (keyboard_has_event()) {
            KeyEvent key = keyboard_get_event();
            if (!key.pressed) continue;

            // Ctrl+Q to quit/close window
            if (key.ctrl && key.ascii == 'q' && focused_window >= 0) {
                close_window(focused_window);
            }
        }

        // --- Render frame ---
        draw_desktop_background();

        // Draw windows (sorted by z-order)
        for (int z = 0; z <= top_z; z++) {
            for (int i = 0; i < MAX_WINDOWS; i++) {
                if (windows[i].active && windows[i].z_order == z) {
                    draw_window(&windows[i]);
                }
            }
        }

        // Draw window content (welcome text in first window)
        for (int i = 0; i < MAX_WINDOWS; i++) {
            if (!windows[i].active) continue;
            int cx = windows[i].x + 16;
            int cy = windows[i].y + TITLEBAR_HEIGHT + 16;

            if (nova_strcmp(windows[i].title, "Welcome to NOVA OS") == 0) {
                fb_draw_string(cx, cy, "Welcome to NOVA OS!", COLOR_WHITE, 2);
                fb_draw_string(cx, cy + 30, "This is a real operating system.", COLOR_TEXT2, 1);
                fb_draw_string(cx, cy + 48, "No Linux. No browser. Just NOVA.", COLOR_TEXT2, 1);
                fb_draw_string(cx, cy + 76, "Click the dock to open apps.", COLOR_TEXT2, 1);
                fb_draw_string(cx, cy + 94, "Drag windows by the titlebar.", COLOR_TEXT2, 1);
                fb_draw_string(cx, cy + 112, "Click the red dot to close.", COLOR_TEXT2, 1);
                fb_draw_string(cx, cy + 140, "Ctrl+Q also closes the active window.", COLOR_TEXT3, 1);
            } else {
                fb_draw_string(cx, cy, windows[i].title, COLOR_WHITE, 2);
                fb_draw_string(cx, cy + 30, "App content goes here.", COLOR_TEXT2, 1);
            }
        }

        draw_dock();
        draw_menubar();
        draw_cursor(mouse.x, mouse.y);

        fb_swap();

        // Small delay to prevent 100% CPU (busy-wait since we don't have interrupts yet)
        for (volatile int i = 0; i < 100000; i++);
    }
}
