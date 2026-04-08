/*
 * Astrion OS — Native Desktop Shell
 *
 * This IS the Astrion OS desktop environment, written in C with GTK3.
 * It creates:
 *   - Desktop layer (wallpaper + icons)
 *   - Top panel / menubar (clock, battery, menus)
 *   - Bottom dock (app launcher)
 *   - Window manager (native GTK windows for apps)
 *   - App launcher (spotlight)
 *   - Notification system
 *
 * Apps are rendered as WebKitGTK views inside native windows.
 * The shell itself is 100% native C/GTK — no HTML for the desktop chrome.
 *
 * Build: make nova-shell
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <gdk/gdkx.h>
#include <time.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <signal.h>
#include <ctype.h>

/* ═══════════════════════════════════════════════
 * Constants & Configuration
 * ═══════════════════════════════════════════════ */

#define NOVA_VERSION       "1.0"
#define NOVA_SERVER_URL    "http://localhost:3000"

#define PANEL_HEIGHT       32
#define DOCK_HEIGHT        78
#define DOCK_ICON_SIZE     64
#define DOCK_PADDING       10

#define COLOR_BG_R         0.04
#define COLOR_BG_G         0.04
#define COLOR_BG_B         0.10

#define COLOR_PANEL_R      0.08
#define COLOR_PANEL_G      0.08
#define COLOR_PANEL_B      0.12

#define COLOR_DOCK_R       0.10
#define COLOR_DOCK_G       0.10
#define COLOR_DOCK_B       0.14

#define COLOR_ACCENT_R     0.0
#define COLOR_ACCENT_G     0.478
#define COLOR_ACCENT_B     1.0

#define MAX_APPS           32
#define MAX_WINDOWS        64
#define MAX_NOTIFICATIONS  20

/* ═══════════════════════════════════════════════
 * Type Definitions
 * ═══════════════════════════════════════════════ */

typedef struct {
    const char *id;
    const char *name;
    const char *icon;      /* Unicode emoji or path */
    const char *url;       /* Relative URL for web app, NULL for native */
    gboolean    pinned;    /* Show in dock */
    gboolean    single;    /* Single instance only */
} NovaApp;

typedef struct {
    int          id;
    NovaApp     *app;
    GtkWidget   *window;
    WebKitWebView *webview;
    gboolean     minimized;
    gboolean     maximized;
    int          x, y, w, h;         /* Normal geometry */
    int          save_x, save_y;     /* Pre-maximize position */
    int          save_w, save_h;     /* Pre-maximize size */
} NovaWindow;

typedef struct {
    char    title[128];
    char    body[256];
    time_t  timestamp;
} NovaNotification;

/* ═══════════════════════════════════════════════
 * Global State
 * ═══════════════════════════════════════════════ */

static GtkWidget     *desktop_window   = NULL;
static GtkWidget     *panel_window     = NULL;
static GtkWidget     *dock_window      = NULL;
static GtkWidget     *launcher_window  = NULL;

static GtkWidget     *clock_label      = NULL;
static GtkWidget     *battery_label    = NULL;
static GtkWidget     *wifi_label       = NULL;
static GtkWidget     *date_label       = NULL;

static NovaWindow     windows[MAX_WINDOWS];
static int            window_count     = 0;
static int            next_window_id   = 1;
static NovaWindow    *focused_window   = NULL;

static NovaNotification notifications[MAX_NOTIFICATIONS];
static int            notif_count      = 0;

static int            screen_width     = 1920;
static int            screen_height    = 1080;

static gboolean       launcher_visible = FALSE;
static GtkWidget     *launcher_entry   = NULL;
static GtkWidget     *launcher_results = NULL;

/* Dock dot indicators — one per pinned app, indexed by position */
static GtkWidget     *dock_dots[MAX_APPS];
static NovaApp       *dock_apps[MAX_APPS];
static int            dock_pinned_count = 0;

/* App switcher state */
static GtkWidget     *switcher_window   = NULL;
static GtkWidget     *switcher_labels[MAX_WINDOWS];
static NovaWindow    *switcher_wins[MAX_WINDOWS];
static int            switcher_count    = 0;
static int            switcher_index    = 0;
static gboolean       switcher_visible  = FALSE;

/* Window snap preview state */
static int            snap_zone         = 0; /* 0=none, 1=left, 2=right, 3=top(maximize) */

/* Popup overlay windows (opaque, shown on demand) */
static GtkWidget     *screensaver_win   = NULL;
static WebKitWebView *screensaver_wv    = NULL;
static gboolean       screensaver_on    = FALSE;
static time_t         last_user_activity = 0;
#define SCREENSAVER_TIMEOUT 300 /* 5 minutes */

static GtkWidget     *popup_emoji_win   = NULL;
static GtkWidget     *popup_clipboard_win = NULL;
static GtkWidget     *popup_volume_win  = NULL;

/* ═══════════════════════════════════════════════
 * App Registry
 * ═══════════════════════════════════════════════ */

static NovaApp app_registry[] = {
    { "finder",          "Finder",           "\xF0\x9F\x93\x81", "/app/finder",           TRUE,  TRUE  },
    { "terminal",        "Terminal",         "\xF0\x9F\x96\xA5",  "/app/terminal",         TRUE,  FALSE },
    { "notes",           "Notes",            "\xF0\x9F\x93\x9D", "/app/notes",            TRUE,  FALSE },
    { "text-editor",     "Text Editor",      "\xF0\x9F\x92\xBB", "/app/text-editor",      TRUE,  FALSE },
    { "calculator",      "Calculator",       "\xF0\x9F\xA7\xAE", "/app/calculator",       TRUE,  TRUE  },
    { "browser",         "Browser",          "\xF0\x9F\x8C\x90", "/app/browser",          TRUE,  FALSE },
    { "settings",        "Settings",         "\xE2\x9A\x99\xEF\xB8\x8F",  "/app/settings",         TRUE,  TRUE  },
    { "music",           "Music",            "\xF0\x9F\x8E\xB5", "/app/music",            TRUE,  TRUE  },
    { "photos",          "Photos",           "\xF0\x9F\x96\xBC",  "/app/photos",           TRUE,  TRUE  },
    { "calendar",        "Calendar",         "\xF0\x9F\x93\x85", "/app/calendar",         TRUE,  TRUE  },
    { "weather",         "Weather",          "\xE2\x9B\x85",     "/app/weather",          FALSE, TRUE  },
    { "clock",           "Clock",            "\xE2\x8F\xB0",     "/app/clock",            FALSE, TRUE  },
    { "draw",            "Draw",             "\xF0\x9F\x8E\xA8", "/app/draw",             FALSE, FALSE },
    { "reminders",       "Reminders",        "\xE2\x9C\x85",     "/app/reminders",        FALSE, TRUE  },
    { "activity-monitor","Task Manager",     "\xF0\x9F\x93\x8A", "/app/activity-monitor", FALSE, TRUE  },
    { "messages",        "Messages",         "\xF0\x9F\x92\xAC", "/app/messages",         TRUE,  TRUE  },
    { "vault",           "Vault",            "\xF0\x9F\x94\x90", "/app/vault",            TRUE,  TRUE  },
    { "screen-recorder", "Screen Recorder",  "\xE2\x8F\xBA\xEF\xB8\x8F", "/app/screen-recorder",  FALSE, TRUE  },
    { "trash",           "Trash",            "\xF0\x9F\x97\x91\xEF\xB8\x8F", "/app/trash",      TRUE,  TRUE  },
    { "sticky-notes",   "Sticky Notes",     "\xF0\x9F\x97\x82\xEF\xB8\x8F", "/app/sticky-notes", TRUE, TRUE  },
    { "contacts",        "Contacts",         "\xF0\x9F\x91\xA5", "/app/contacts",         TRUE,  TRUE  },
    { "maps",            "Maps",             "\xF0\x9F\x97\xBA\xEF\xB8\x8F", "/app/maps",   TRUE,  TRUE  },
    { "voice-memos",    "Voice Memos",      "\xF0\x9F\x8E\x99\xEF\xB8\x8F", "/app/voice-memos", TRUE, TRUE },
    { "pomodoro",        "Pomodoro",         "\xF0\x9F\x8D\x85", "/app/pomodoro",         FALSE, TRUE  },
    { "pdf-viewer",      "PDF Viewer",       "\xF0\x9F\x93\x84", "/app/pdf-viewer",       FALSE, FALSE },
    { "kanban",          "Kanban",           "\xF0\x9F\x93\x8B", "/app/kanban",           TRUE,  TRUE  },
    { "habit-tracker",   "Habits",           "\xE2\x9C\x85",     "/app/habit-tracker",    FALSE, TRUE  },
    { "video-player",   "Video Player",     "\xE2\x96\xB6\xEF\xB8\x8F", "/app/video-player", FALSE, FALSE },
    { "system-info",    "System Info",      "\xE2\x84\xB9\xEF\xB8\x8F", "/app/system-info",  FALSE, TRUE  },
    { "translator",     "Translator",       "\xF0\x9F\x8C\x90", "/app/translator",       FALSE, TRUE  },
    { "unit-converter", "Converter",        "\xF0\x9F\x94\x84", "/app/unit-converter",   FALSE, TRUE  },
    { "color-picker",   "Color Picker",     "\xF0\x9F\x8E\xA8", "/app/color-picker",     FALSE, TRUE  },
    { "stopwatch",      "Stopwatch",        "\xE2\x8F\xB1\xEF\xB8\x8F", "/app/stopwatch",  FALSE, TRUE  },
    { "timer-app",      "Timer",            "\xE2\x8F\xB2\xEF\xB8\x8F", "/app/timer-app",  FALSE, TRUE  },
    { "whiteboard",     "Whiteboard",       "\xF0\x9F\x93\x9D", "/app/whiteboard",       FALSE, FALSE },
    { "password-gen",   "Password Gen",     "\xF0\x9F\x94\x91", "/app/password-gen",     FALSE, TRUE  },
    { "markdown",       "Markdown",         "\xF0\x9F\x93\x9D", "/app/markdown",         FALSE, FALSE },
    { "qr-code",        "QR Code",          "\xF0\x9F\x93\xB2", "/app/qr-code",          FALSE, TRUE  },
    { "dictionary",     "Dictionary",       "\xF0\x9F\x93\x96", "/app/dictionary",       FALSE, TRUE  },
    { "journal",        "Journal",          "\xF0\x9F\x93\x93", "/app/journal",          FALSE, TRUE  },
    { "flashcards",     "Flashcards",       "\xF0\x9F\x83\x8F", "/app/flashcards",       FALSE, TRUE  },
    { "chess",          "Chess",            "\xE2\x99\x9A",     "/app/chess",            FALSE, TRUE  },
    { "snake",          "Snake",            "\xF0\x9F\x90\x8D", "/app/snake",            FALSE, TRUE  },
    { "2048",           "2048",             "\xF0\x9F\x8E\xB2", "/app/2048",             FALSE, TRUE  },
    { "budget",         "Budget",           "\xF0\x9F\x92\xB0", "/app/budget",           FALSE, TRUE  },
    { "quotes",         "Quotes",           "\xF0\x9F\x92\xAC", "/app/quotes",           FALSE, TRUE  },
    { "typing-test",    "Typing Test",      "\xE2\x8C\xA8\xEF\xB8\x8F", "/app/typing-test", FALSE, TRUE },
    { "todo",           "Todo",             "\xE2\x98\x91\xEF\xB8\x8F", "/app/todo",       FALSE, TRUE  },
    { "installer",       "Install Astrion",  "\xF0\x9F\x92\xBF", "/app/installer",        FALSE, TRUE  },
    { "appstore",        "App Store",        "\xF0\x9F\x9B\x8D",  "/app/appstore",         TRUE,  TRUE  },
    { NULL, NULL, NULL, NULL, FALSE, FALSE } /* Sentinel */
};

static int app_count = 0;

/* Forward declarations */
static void nova_launch_app(NovaApp *app);
static void nova_close_window(NovaWindow *nwin);
static void nova_focus_window(NovaWindow *nwin);
static void nova_minimize_window(NovaWindow *nwin);
static void nova_maximize_window(NovaWindow *nwin);
static void nova_show_launcher(void);
static void nova_hide_launcher(void);
static void nova_toggle_launcher(void);
static void nova_show_notification(const char *title, const char *body);
static void update_clock(void);
static void update_dock(void);
static gboolean update_battery(gpointer data);
static gboolean update_wifi(gpointer data);
static double get_hidpi_zoom(void);

/* App switcher forward declarations */
static void show_app_switcher(void);
static void cycle_app_switcher(void);
static void commit_app_switcher(void);
static void hide_app_switcher(void);

/* Desktop right-click menu */
static void on_apple_menu_about(GtkMenuItem *item, gpointer data);

/* Popup overlay forward declarations */
static void hide_screensaver_cb(GtkWidget *w, gpointer data);
static void toggle_popup(GtkWidget **win_ptr, const char *title,
    const char *url, int w, int h);
static gboolean popup_key_handler(GtkWidget *w, GdkEventKey *e, gpointer data);
static void show_screensaver(void);

/* ═══════════════════════════════════════════════
 * Utility: Draw rounded rectangle
 * ═══════════════════════════════════════════════ */

static void draw_rounded_rect(cairo_t *cr, double x, double y,
                               double w, double h, double r)
{
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r,     r, -M_PI / 2, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0,          M_PI / 2);
    cairo_arc(cr, x + r,     y + h - r, r, M_PI / 2,   M_PI);
    cairo_arc(cr, x + r,     y + r,     r, M_PI,        3 * M_PI / 2);
    cairo_close_path(cr);
}

/* ═══════════════════════════════════════════════
 * Battery Monitor — reads from /sys/class/power_supply
 * ═══════════════════════════════════════════════ */

static gboolean update_battery(gpointer data)
{
    GtkLabel *label = GTK_LABEL(data);
    char cap_buf[16] = "??";
    char stat_buf[32] = "";

    const char *paths[] = {
        "/sys/class/power_supply/BAT0",
        "/sys/class/power_supply/BAT1",
        "/sys/class/power_supply/battery",
        NULL
    };

    for (int i = 0; paths[i]; i++) {
        char path[256];
        snprintf(path, sizeof(path), "%s/capacity", paths[i]);
        FILE *f = fopen(path, "r");
        if (f) {
            if (fgets(cap_buf, sizeof(cap_buf), f))
                cap_buf[strcspn(cap_buf, "\n")] = 0;
            fclose(f);

            snprintf(path, sizeof(path), "%s/status", paths[i]);
            f = fopen(path, "r");
            if (f) {
                if (fgets(stat_buf, sizeof(stat_buf), f))
                    stat_buf[strcspn(stat_buf, "\n")] = 0;
                fclose(f);
            }
            break;
        }
    }

    char display[128];
    if (strstr(stat_buf, "Charging"))
        snprintf(display, sizeof(display),
            "<span foreground='#c0c0c0'>\xE2\x9A\xA1 %s%%</span>", cap_buf);
    else
        snprintf(display, sizeof(display),
            "<span foreground='#c0c0c0'>\xF0\x9F\x94\x8B %s%%</span>", cap_buf);

    gtk_label_set_markup(label, display);
    return TRUE;
}

/* ═══════════════════════════════════════════════
 * Wi-Fi Monitor — reads via nmcli
 * ═══════════════════════════════════════════════ */

static gboolean update_wifi(gpointer data)
{
    GtkLabel *label = GTK_LABEL(data);
    char display[128];
    char line[256] = "";

    FILE *fp = popen("nmcli -t -f ACTIVE,SSID dev wifi 2>/dev/null | grep '^yes' | head -1", "r");
    if (fp) {
        if (fgets(line, sizeof(line), fp)) {
            line[strcspn(line, "\n")] = 0;
            /* Format: yes:SSID */
            char *ssid = strchr(line, ':');
            if (ssid && *(ssid + 1)) {
                ssid++;
                snprintf(display, sizeof(display),
                    "<span foreground='#c0c0c0'>\xF0\x9F\x93\xB6 %s</span>", ssid);
            } else {
                snprintf(display, sizeof(display),
                    "<span foreground='#c0c0c0'>\xF0\x9F\x93\xB6 Connected</span>");
            }
        } else {
            snprintf(display, sizeof(display),
                "<span foreground='#888888'>\xF0\x9F\x93\xB6 Off</span>");
        }
        pclose(fp);
    } else {
        snprintf(display, sizeof(display),
            "<span foreground='#888888'>\xF0\x9F\x93\xB6 N/A</span>");
    }

    gtk_label_set_markup(label, display);
    return TRUE;
}

/* ═══════════════════════════════════════════════
 * HiDPI Zoom — reads from config file
 * ═══════════════════════════════════════════════ */

static double get_hidpi_zoom(void)
{
    double zoom = 1.0;
    const char *home = g_get_home_dir();
    char path[512];
    snprintf(path, sizeof(path), "%s/.config/nova-renderer/zoom", home);

    FILE *f = fopen(path, "r");
    if (f) {
        char buf[32];
        if (fgets(buf, sizeof(buf), f)) {
            double val = atof(buf);
            if (val >= 0.5 && val <= 4.0)
                zoom = val;
        }
        fclose(f);
    }
    return zoom;
}

/* ═══════════════════════════════════════════════
 * CSS Theme
 * ═══════════════════════════════════════════════ */

static void apply_css_theme(void)
{
    GtkCssProvider *provider = gtk_css_provider_new();
    const char *css =
        "/* Astrion OS Native Theme — No compositor required */\n"
        "* {\n"
        "  font-family: 'Inter', 'SF Pro Display', 'Segoe UI', sans-serif;\n"
        "  color: #e0e0e0;\n"
        "}\n"
        "\n"
        ".nova-panel {\n"
        "  background: #14141e;\n"
        "  border-bottom: 1px solid #2a2a3a;\n"
        "}\n"
        "\n"
        ".nova-panel label {\n"
        "  font-size: 18px;\n"
        "  font-weight: 500;\n"
        "  color: #e0e0e0;\n"
        "  padding: 0 10px;\n"
        "}\n"
        "\n"
        ".nova-panel-apple {\n"
        "  font-weight: 700;\n"
        "  font-size: 20px;\n"
        "  color: #ffffff;\n"
        "  padding: 0 14px;\n"
        "}\n"
        "\n"
        ".nova-panel-right label {\n"
        "  font-size: 16px;\n"
        "  color: #c0c0c0;\n"
        "}\n"
        "\n"
        ".nova-dock {\n"
        "  background: #1e1e2e;\n"
        "  border: 1px solid #3a3a4a;\n"
        "  border-radius: 16px;\n"
        "  padding: 4px 12px;\n"
        "}\n"
        "\n"
        ".nova-dock-icon {\n"
        "  font-size: 42px;\n"
        "  padding: 6px 8px;\n"
        "  border-radius: 14px;\n"
        "  transition: 200ms ease;\n"
        "}\n"
        "\n"
        ".nova-dock-icon:hover {\n"
        "  background: #3a3a4a;\n"
        "}\n"
        "\n"
        ".nova-dock-dot {\n"
        "  font-size: 6px;\n"
        "  color: #808080;\n"
        "}\n"
        "\n"
        ".nova-launcher {\n"
        "  background: #1e1e2e;\n"
        "  border: 1px solid #3a3a4a;\n"
        "  border-radius: 12px;\n"
        "}\n"
        "\n"
        ".nova-launcher {\n"
        "  min-width: 500px;\n"
        "}\n"
        "\n"
        ".nova-launcher entry {\n"
        "  background: #2a2a3a;\n"
        "  border: none;\n"
        "  border-radius: 8px;\n"
        "  padding: 12px 16px;\n"
        "  font-size: 18px;\n"
        "  color: #ffffff;\n"
        "  min-height: 40px;\n"
        "}\n"
        "\n"
        ".nova-launcher entry:focus {\n"
        "  background: #333344;\n"
        "}\n"
        "\n"
        ".nova-launcher-result {\n"
        "  padding: 8px 16px;\n"
        "  border-radius: 8px;\n"
        "}\n"
        "\n"
        ".nova-launcher-result:hover {\n"
        "  background: #1a3a6e;\n"
        "}\n"
        "\n"
        ".nova-window-titlebar {\n"
        "  background: #282837;\n"
        "  border-bottom: 1px solid #1a1a28;\n"
        "  padding: 6px 0;\n"
        "  min-height: 32px;\n"
        "}\n"
        "\n"
        ".nova-window-titlebar label {\n"
        "  font-size: 14px;\n"
        "  font-weight: 600;\n"
        "  color: #ffffff;\n"
        "}\n"
        "\n"
        ".nova-window-btn {\n"
        "  min-width: 16px;\n"
        "  min-height: 16px;\n"
        "  border-radius: 50%;\n"
        "  padding: 0;\n"
        "  margin: 2px;\n"
        "  border: none;\n"
        "}\n"
        "\n"
        ".nova-window-close {\n"
        "  background: #ff5f57;\n"
        "  border-radius: 50%;\n"
        "  border: none;\n"
        "}\n"
        ".nova-window-close:hover {\n"
        "  background: #ff3b30;\n"
        "  border: none;\n"
        "}\n"
        "\n"
        ".nova-window-minimize {\n"
        "  background: #ffbd2e;\n"
        "  border-radius: 50%;\n"
        "  border: none;\n"
        "}\n"
        ".nova-window-minimize:hover {\n"
        "  background: #ff9500;\n"
        "  border: none;\n"
        "}\n"
        "\n"
        ".nova-window-maximize {\n"
        "  background: #28c840;\n"
        "  border-radius: 50%;\n"
        "  border: none;\n"
        "}\n"
        ".nova-window-maximize:hover {\n"
        "  background: #34c759;\n"
        "  border: none;\n"
        "}\n"
        "\n"
        ".nova-about-dialog {\n"
        "  background: #1e1e2e;\n"
        "  border: 1px solid #3a3a4a;\n"
        "  border-radius: 16px;\n"
        "}\n"
        "\n"
        ".nova-menu {\n"
        "  background: #1e1e2e;\n"
        "  border: 1px solid #3a3a4a;\n"
        "  border-radius: 8px;\n"
        "  padding: 4px;\n"
        "}\n"
        "\n"
        ".nova-menu menuitem {\n"
        "  padding: 6px 20px;\n"
        "  border-radius: 4px;\n"
        "}\n"
        "\n"
        ".nova-menu menuitem:hover {\n"
        "  background: #1a4a8e;\n"
        "}\n"
        "\n"
        "tooltip {\n"
        "  background: #1e1e2e;\n"
        "  border: 1px solid #3a3a4a;\n"
        "  border-radius: 6px;\n"
        "  color: #e0e0e0;\n"
        "}\n";

    gtk_css_provider_load_from_data(provider, css, -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(provider),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    g_object_unref(provider);
}

/* ═══════════════════════════════════════════════
 * Desktop Background
 * ═══════════════════════════════════════════════ */

static gboolean on_desktop_draw(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    int w = gtk_widget_get_allocated_width(widget);
    int h = gtk_widget_get_allocated_height(widget);

    /* Dark gradient background */
    cairo_pattern_t *grad = cairo_pattern_create_linear(0, 0, 0, h);
    cairo_pattern_add_color_stop_rgb(grad, 0.0, 0.04, 0.04, 0.10);
    cairo_pattern_add_color_stop_rgb(grad, 0.5, 0.06, 0.06, 0.16);
    cairo_pattern_add_color_stop_rgb(grad, 1.0, 0.08, 0.08, 0.22);
    cairo_set_source(cr, grad);
    cairo_paint(cr);
    cairo_pattern_destroy(grad);

    /* Subtle radial glow in center — fully opaque, no compositor needed */
    cairo_pattern_t *glow = cairo_pattern_create_radial(
        w * 0.5, h * 0.4, 0,
        w * 0.5, h * 0.4, w * 0.5
    );
    cairo_pattern_add_color_stop_rgba(glow, 0.0, 0.05, 0.08, 0.20, 1.0);
    cairo_pattern_add_color_stop_rgba(glow, 1.0, 0.0,  0.0,  0.0,  0.0);
    cairo_set_source(cr, glow);
    cairo_paint(cr);
    cairo_pattern_destroy(glow);

    return FALSE;
}

/* ─── Desktop right-click menu callbacks ─── */

static NovaApp *find_app_by_id(const char *id)
{
    for (int i = 0; app_registry[i].id != NULL; i++) {
        if (strcmp(app_registry[i].id, id) == 0)
            return &app_registry[i];
    }
    return NULL;
}

static void on_desktop_menu_wallpaper(GtkMenuItem *item, gpointer data)
{
    NovaApp *app = find_app_by_id("settings");
    if (app) nova_launch_app(app);
}

static void on_desktop_menu_display(GtkMenuItem *item, gpointer data)
{
    NovaApp *app = find_app_by_id("settings");
    if (app) nova_launch_app(app);
}

static void on_desktop_menu_terminal(GtkMenuItem *item, gpointer data)
{
    NovaApp *app = find_app_by_id("terminal");
    if (app) nova_launch_app(app);
}

static void on_desktop_menu_finder(GtkMenuItem *item, gpointer data)
{
    NovaApp *app = find_app_by_id("finder");
    if (app) nova_launch_app(app);
}

static gboolean on_desktop_button_press(GtkWidget *widget, GdkEventButton *event, gpointer data)
{
    if (event->button == 3) { /* Right click */
        GtkWidget *menu = gtk_menu_new();
        GtkStyleContext *ctx = gtk_widget_get_style_context(menu);
        gtk_style_context_add_class(ctx, "nova-menu");

        /* New Folder (disabled) */
        GtkWidget *new_folder = gtk_menu_item_new_with_label("New Folder");
        gtk_widget_set_sensitive(new_folder, FALSE);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), new_folder);

        gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

        /* Change Wallpaper */
        GtkWidget *wallpaper = gtk_menu_item_new_with_label("Change Wallpaper");
        g_signal_connect(wallpaper, "activate", G_CALLBACK(on_desktop_menu_wallpaper), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), wallpaper);

        /* Display Settings */
        GtkWidget *display = gtk_menu_item_new_with_label("Display Settings");
        g_signal_connect(display, "activate", G_CALLBACK(on_desktop_menu_display), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), display);

        gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

        /* Open Terminal */
        GtkWidget *terminal = gtk_menu_item_new_with_label("Open Terminal");
        g_signal_connect(terminal, "activate", G_CALLBACK(on_desktop_menu_terminal), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), terminal);

        /* Open Finder */
        GtkWidget *finder = gtk_menu_item_new_with_label("Open Finder");
        g_signal_connect(finder, "activate", G_CALLBACK(on_desktop_menu_finder), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), finder);

        gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

        /* About Astrion OS */
        GtkWidget *about = gtk_menu_item_new_with_label("About Astrion OS");
        g_signal_connect(about, "activate", G_CALLBACK(on_apple_menu_about), NULL);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), about);

        gtk_widget_show_all(menu);
        gtk_menu_popup_at_pointer(GTK_MENU(menu), (GdkEvent *)event);
        return TRUE;
    }
    return FALSE;
}

static void create_desktop(void)
{
    desktop_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(desktop_window), "Astrion OS Desktop");
    gtk_window_set_decorated(GTK_WINDOW(desktop_window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(desktop_window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(desktop_window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(desktop_window), GDK_WINDOW_TYPE_HINT_DESKTOP);
    gtk_window_set_default_size(GTK_WINDOW(desktop_window), screen_width, screen_height);
    gtk_window_move(GTK_WINDOW(desktop_window), 0, 0);

    GtkWidget *overlay = gtk_overlay_new();
    gtk_container_add(GTK_CONTAINER(desktop_window), overlay);

    GtkWidget *drawing = gtk_drawing_area_new();
    gtk_container_add(GTK_CONTAINER(overlay), drawing);
    g_signal_connect(drawing, "draw", G_CALLBACK(on_desktop_draw), NULL);

    /* Invisible event box on top to catch right-clicks */
    GtkWidget *evbox = gtk_event_box_new();
    gtk_event_box_set_visible_window(GTK_EVENT_BOX(evbox), FALSE);
    gtk_widget_set_events(evbox, GDK_BUTTON_PRESS_MASK);
    g_signal_connect(evbox, "button-press-event", G_CALLBACK(on_desktop_button_press), NULL);
    gtk_overlay_add_overlay(GTK_OVERLAY(overlay), evbox);

    gtk_widget_set_app_paintable(desktop_window, TRUE);
    gtk_widget_show_all(desktop_window);
    gtk_window_fullscreen(GTK_WINDOW(desktop_window));
}

/* ═══════════════════════════════════════════════
 * Panel (Menubar) — Top of Screen
 * ═══════════════════════════════════════════════ */

static void on_apple_menu_about(GtkMenuItem *item, gpointer data)
{
    /* Show About Astrion OS dialog */
    GtkWidget *dialog = gtk_dialog_new();
    gtk_window_set_title(GTK_WINDOW(dialog), "About Astrion OS");
    gtk_window_set_modal(GTK_WINDOW(dialog), TRUE);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 320, 280);
    gtk_window_set_resizable(GTK_WINDOW(dialog), FALSE);
    gtk_window_set_position(GTK_WINDOW(dialog), GTK_WIN_POS_CENTER);
    gtk_window_set_decorated(GTK_WINDOW(dialog), FALSE);

    GtkStyleContext *ctx = gtk_widget_get_style_context(dialog);
    gtk_style_context_add_class(ctx, "nova-about-dialog");

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_widget_set_margin_start(content, 30);
    gtk_widget_set_margin_end(content, 30);
    gtk_widget_set_margin_top(content, 30);
    gtk_widget_set_margin_bottom(content, 20);

    /* Astrion logo */
    GtkWidget *logo = gtk_label_new(NULL);
    gtk_label_set_markup(logo,
        "<span size='48000' weight='bold' foreground='#007aff'>\xE2\x97\x86</span>");
    gtk_box_pack_start(GTK_BOX(content), logo, FALSE, FALSE, 0);

    GtkWidget *name = gtk_label_new(NULL);
    gtk_label_set_markup(name,
        "<span size='18000' weight='bold' foreground='#ffffff'>Astrion OS</span>");
    gtk_box_pack_start(GTK_BOX(content), name, FALSE, FALSE, 4);

    GtkWidget *ver = gtk_label_new(NULL);
    gtk_label_set_markup(ver,
        "<span size='11000' foreground='#888888'>Version " NOVA_VERSION " (Andromeda)\n"
        "Native Renderer</span>");
    gtk_box_pack_start(GTK_BOX(content), ver, FALSE, FALSE, 4);

    GtkWidget *info = gtk_label_new(NULL);
    gtk_label_set_markup(info,
        "<span size='10000' foreground='#666666'>\n"
        "Built with GTK3 + WebKitGTK\n"
        "An AI-native operating system</span>");
    gtk_box_pack_start(GTK_BOX(content), info, FALSE, FALSE, 8);

    GtkWidget *close_btn = gtk_button_new_with_label("OK");
    gtk_box_pack_end(GTK_BOX(content), close_btn, FALSE, FALSE, 8);
    g_signal_connect_swapped(close_btn, "clicked", G_CALLBACK(gtk_widget_destroy), dialog);

    gtk_widget_show_all(dialog);
}

static void on_apple_menu_force_quit(GtkMenuItem *item, gpointer data)
{
    /* Force quit dialog */
    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        "Force Quit Applications",
        NULL,
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        "Force Quit", GTK_RESPONSE_ACCEPT,
        "Cancel", GTK_RESPONSE_CANCEL,
        NULL
    );
    gtk_window_set_default_size(GTK_WINDOW(dialog), 380, 300);
    gtk_window_set_position(GTK_WINDOW(dialog), GTK_WIN_POS_CENTER);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));

    GtkWidget *label = gtk_label_new("Select an application to force quit:");
    gtk_box_pack_start(GTK_BOX(content), label, FALSE, FALSE, 10);

    /* List of running windows */
    GtkWidget *listbox = gtk_list_box_new();
    gtk_box_pack_start(GTK_BOX(content), listbox, TRUE, TRUE, 0);

    for (int i = 0; i < window_count; i++) {
        if (windows[i].window && windows[i].app) {
            GtkWidget *row = gtk_label_new(NULL);
            char buf[256];
            snprintf(buf, sizeof(buf), "  %s  %s",
                     windows[i].app->icon, windows[i].app->name);
            gtk_label_set_text(GTK_LABEL(row), buf);
            gtk_label_set_xalign(GTK_LABEL(row), 0);
            gtk_list_box_insert(GTK_LIST_BOX(listbox), row, -1);
        }
    }

    gtk_widget_show_all(dialog);

    if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
        GtkListBoxRow *selected = gtk_list_box_get_selected_row(GTK_LIST_BOX(listbox));
        if (selected) {
            int idx = gtk_list_box_row_get_index(selected);
            int count = 0;
            for (int i = 0; i < window_count; i++) {
                if (windows[i].window && windows[i].app) {
                    if (count == idx) {
                        nova_close_window(&windows[i]);
                        break;
                    }
                    count++;
                }
            }
        }
    }
    gtk_widget_destroy(dialog);
}

static void on_apple_menu_quit(GtkMenuItem *item, gpointer data)
{
    gtk_main_quit();
}

static void on_apple_button_clicked(GtkWidget *widget, gpointer data)
{
    GtkWidget *menu = gtk_menu_new();
    GtkStyleContext *ctx = gtk_widget_get_style_context(menu);
    gtk_style_context_add_class(ctx, "nova-menu");

    GtkWidget *about = gtk_menu_item_new_with_label("About Astrion OS");
    g_signal_connect(about, "activate", G_CALLBACK(on_apple_menu_about), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), about);

    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    GtkWidget *fq = gtk_menu_item_new_with_label("Force Quit...");
    g_signal_connect(fq, "activate", G_CALLBACK(on_apple_menu_force_quit), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), fq);

    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    GtkWidget *quit = gtk_menu_item_new_with_label("Shut Down...");
    g_signal_connect(quit, "activate", G_CALLBACK(on_apple_menu_quit), NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), quit);

    gtk_widget_show_all(menu);
    gtk_menu_popup_at_widget(GTK_MENU(menu), widget, GDK_GRAVITY_SOUTH_WEST,
                             GDK_GRAVITY_NORTH_WEST, NULL);
}

static gboolean update_clock_cb(gpointer data)
{
    update_clock();
    return TRUE;
}

static void update_clock(void)
{
    time_t now = time(NULL);
    struct tm *tm = localtime(&now);

    if (clock_label) {
        char time_str[32];
        strftime(time_str, sizeof(time_str), "%l:%M %p", tm);
        /* Trim leading space */
        char *t = time_str;
        while (*t == ' ') t++;
        gtk_label_set_text(GTK_LABEL(clock_label), t);
    }
    if (date_label) {
        char date_str[64];
        strftime(date_str, sizeof(date_str), "%a %b %d", tm);
        gtk_label_set_text(GTK_LABEL(date_label), date_str);
    }
}

static void create_panel(void)
{
    panel_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(panel_window), "Astrion Panel");
    gtk_window_set_decorated(GTK_WINDOW(panel_window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(panel_window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(panel_window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(panel_window), GDK_WINDOW_TYPE_HINT_DOCK);
    gtk_window_set_default_size(GTK_WINDOW(panel_window), screen_width, PANEL_HEIGHT);
    gtk_window_move(GTK_WINDOW(panel_window), 0, 0);
    gtk_window_set_keep_above(GTK_WINDOW(panel_window), TRUE);

    GtkStyleContext *ctx = gtk_widget_get_style_context(panel_window);
    gtk_style_context_add_class(ctx, "nova-panel");

    /* Main horizontal box */
    GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_container_add(GTK_CONTAINER(panel_window), hbox);

    /* ─── Left side: Apple menu + app name ─── */
    GtkWidget *left_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_box_pack_start(GTK_BOX(hbox), left_box, FALSE, FALSE, 0);

    /* Astrion menu button */
    GtkWidget *apple_btn = gtk_button_new();
    GtkWidget *apple_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(apple_label),
        "<span weight='bold' foreground='#007aff'> \xE2\x97\x86 </span>");
    gtk_container_add(GTK_CONTAINER(apple_btn), apple_label);
    gtk_button_set_relief(GTK_BUTTON(apple_btn), GTK_RELIEF_NONE);
    GtkStyleContext *apple_ctx = gtk_widget_get_style_context(apple_btn);
    gtk_style_context_add_class(apple_ctx, "nova-panel-apple");
    g_signal_connect(apple_btn, "clicked", G_CALLBACK(on_apple_button_clicked), NULL);
    gtk_box_pack_start(GTK_BOX(left_box), apple_btn, FALSE, FALSE, 0);

    /* Active app name */
    GtkWidget *app_name = gtk_label_new("Astrion OS");
    PangoAttrList *attrs = pango_attr_list_new();
    pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
    gtk_label_set_attributes(GTK_LABEL(app_name), attrs);
    pango_attr_list_unref(attrs);
    gtk_box_pack_start(GTK_BOX(left_box), app_name, FALSE, FALSE, 4);

    /* Menu items: File, Edit, View */
    const char *menu_items[] = { "File", "Edit", "View", "Window", "Help", NULL };
    for (int i = 0; menu_items[i]; i++) {
        GtkWidget *lbl = gtk_label_new(menu_items[i]);
        GtkWidget *evbox = gtk_event_box_new();
        gtk_container_add(GTK_CONTAINER(evbox), lbl);
        gtk_box_pack_start(GTK_BOX(left_box), evbox, FALSE, FALSE, 8);
    }

    /* ─── Spacer ─── */
    GtkWidget *spacer = gtk_label_new("");
    gtk_box_pack_start(GTK_BOX(hbox), spacer, TRUE, TRUE, 0);

    /* ─── Right side: status icons + clock ─── */
    GtkWidget *right_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
    GtkStyleContext *right_ctx = gtk_widget_get_style_context(right_box);
    gtk_style_context_add_class(right_ctx, "nova-panel-right");
    gtk_box_pack_end(GTK_BOX(hbox), right_box, FALSE, FALSE, 8);

    /* WiFi status — real, updated every 15 seconds */
    wifi_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(wifi_label),
        "<span foreground='#c0c0c0'>\xF0\x9F\x93\xB6</span>");
    gtk_box_pack_start(GTK_BOX(right_box), wifi_label, FALSE, FALSE, 0);
    update_wifi(wifi_label);
    g_timeout_add(15000, update_wifi, wifi_label);

    /* Battery — real, updated every 10 seconds */
    battery_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(battery_label),
        "<span foreground='#c0c0c0'>\xF0\x9F\x94\x8B ??%</span>");
    gtk_box_pack_start(GTK_BOX(right_box), battery_label, FALSE, FALSE, 0);
    update_battery(battery_label);
    g_timeout_add(10000, update_battery, battery_label);

    /* Search (spotlight) icon */
    GtkWidget *search_btn = gtk_button_new();
    GtkWidget *search_icon = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(search_icon),
        "<span foreground='#c0c0c0'>\xF0\x9F\x94\x8D</span>");
    gtk_container_add(GTK_CONTAINER(search_btn), search_icon);
    gtk_button_set_relief(GTK_BUTTON(search_btn), GTK_RELIEF_NONE);
    g_signal_connect(search_btn, "clicked", G_CALLBACK(nova_toggle_launcher), NULL);
    gtk_box_pack_start(GTK_BOX(right_box), search_btn, FALSE, FALSE, 0);

    /* Date */
    date_label = gtk_label_new("...");
    gtk_box_pack_start(GTK_BOX(right_box), date_label, FALSE, FALSE, 0);

    /* Clock */
    clock_label = gtk_label_new("...");
    PangoAttrList *clock_attrs = pango_attr_list_new();
    pango_attr_list_insert(clock_attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
    gtk_label_set_attributes(GTK_LABEL(clock_label), clock_attrs);
    pango_attr_list_unref(clock_attrs);
    gtk_box_pack_start(GTK_BOX(right_box), clock_label, FALSE, FALSE, 0);

    /* Update clock every second */
    update_clock();
    g_timeout_add(1000, update_clock_cb, NULL);

    /* Set panel to be fully opaque and on top — no compositor needed */
    GdkRGBA panel_bg = { COLOR_PANEL_R, COLOR_PANEL_G, COLOR_PANEL_B, 1.0 };
    gtk_widget_override_background_color(panel_window, GTK_STATE_FLAG_NORMAL, &panel_bg);

    gtk_widget_show_all(panel_window);
}

/* ═══════════════════════════════════════════════
 * Dock — Bottom of Screen
 * ═══════════════════════════════════════════════ */

static void on_dock_icon_clicked(GtkWidget *widget, gpointer data)
{
    NovaApp *app = (NovaApp *)data;

    /* Browser: launch native astrion-browser instead of web app */
    if (strcmp(app->id, "browser") == 0) {
        g_spawn_command_line_async("astrion-browser", NULL);
        return;
    }

    /* Check if already open → focus it */
    if (app->single) {
        for (int i = 0; i < window_count; i++) {
            if (windows[i].app == app && windows[i].window) {
                if (windows[i].minimized) {
                    gtk_widget_show(windows[i].window);
                    windows[i].minimized = FALSE;
                }
                nova_focus_window(&windows[i]);
                return;
            }
        }
    }

    nova_launch_app(app);
}

static void create_dock(void)
{
    dock_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(dock_window), "Astrion Dock");
    gtk_window_set_decorated(GTK_WINDOW(dock_window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(dock_window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(dock_window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(dock_window), GDK_WINDOW_TYPE_HINT_DOCK);
    gtk_window_set_keep_above(GTK_WINDOW(dock_window), TRUE);
    gtk_window_set_resizable(GTK_WINDOW(dock_window), FALSE);

    GtkWidget *outer_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(dock_window), outer_box);

    /* Dock container with background */
    GtkWidget *dock_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 2);
    GtkStyleContext *dock_ctx = gtk_widget_get_style_context(dock_box);
    gtk_style_context_add_class(dock_ctx, "nova-dock");
    gtk_box_pack_start(GTK_BOX(outer_box), dock_box, FALSE, FALSE, 0);

    /* Add pinned apps to dock */
    dock_pinned_count = 0;
    for (int i = 0; app_registry[i].id != NULL; i++) {
        if (!app_registry[i].pinned) continue;

        GtkWidget *icon_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

        GtkWidget *btn = gtk_button_new();
        gtk_button_set_relief(GTK_BUTTON(btn), GTK_RELIEF_NONE);

        /* Try to load SVG icon from /opt/nova-os/assets/icons/<id>.svg */
        char icon_path[512];
        snprintf(icon_path, sizeof(icon_path), "/opt/nova-os/assets/icons/%s.svg", app_registry[i].id);
        GdkPixbuf *pixbuf = gdk_pixbuf_new_from_file_at_size(icon_path, DOCK_ICON_SIZE, DOCK_ICON_SIZE, NULL);
        if (pixbuf) {
            GtkWidget *icon_img = gtk_image_new_from_pixbuf(pixbuf);
            g_object_unref(pixbuf);
            gtk_container_add(GTK_CONTAINER(btn), icon_img);
        } else {
            /* Fallback to emoji if SVG not found */
            GtkWidget *icon_label = gtk_label_new(app_registry[i].icon);
            PangoAttrList *attrs = pango_attr_list_new();
            pango_attr_list_insert(attrs, pango_attr_size_new(42 * PANGO_SCALE));
            gtk_label_set_attributes(GTK_LABEL(icon_label), attrs);
            pango_attr_list_unref(attrs);
            gtk_container_add(GTK_CONTAINER(btn), icon_label);
        }

        GtkStyleContext *btn_ctx = gtk_widget_get_style_context(btn);
        gtk_style_context_add_class(btn_ctx, "nova-dock-icon");

        gtk_widget_set_tooltip_text(btn, app_registry[i].name);
        g_signal_connect(btn, "clicked", G_CALLBACK(on_dock_icon_clicked), &app_registry[i]);

        gtk_box_pack_start(GTK_BOX(icon_box), btn, FALSE, FALSE, 0);

        /* Running indicator dot */
        GtkWidget *dot = gtk_label_new("\xC2\xB7");
        GtkStyleContext *dot_ctx = gtk_widget_get_style_context(dot);
        gtk_style_context_add_class(dot_ctx, "nova-dock-dot");
        gtk_widget_set_opacity(dot, 0.0); /* Hidden by default */
        gtk_box_pack_start(GTK_BOX(icon_box), dot, FALSE, FALSE, 0);

        /* Store references for update_dock() */
        dock_dots[dock_pinned_count] = dot;
        dock_apps[dock_pinned_count] = &app_registry[i];
        dock_pinned_count++;

        gtk_box_pack_start(GTK_BOX(dock_box), icon_box, FALSE, FALSE, 0);
    }

    /* Calculate dock size */
    int dock_width = dock_pinned_count * (DOCK_ICON_SIZE + 16) + 32;
    int dock_x = (screen_width - dock_width) / 2;
    int dock_y = screen_height - DOCK_HEIGHT - 8;

    gtk_window_set_default_size(GTK_WINDOW(dock_window), dock_width, DOCK_HEIGHT);
    gtk_window_move(GTK_WINDOW(dock_window), dock_x, dock_y);

    /* Solid background — no compositor needed */
    GdkRGBA dock_bg = { COLOR_DOCK_R, COLOR_DOCK_G, COLOR_DOCK_B, 1.0 };
    gtk_widget_override_background_color(dock_window, GTK_STATE_FLAG_NORMAL, &dock_bg);

    gtk_widget_show_all(dock_window);
}

static void update_dock(void)
{
    /* Update running indicator dots for each pinned app */
    for (int d = 0; d < dock_pinned_count; d++) {
        if (!dock_dots[d] || !dock_apps[d]) continue;

        gboolean running = FALSE;
        for (int w = 0; w < window_count; w++) {
            if (windows[w].app == dock_apps[d] && windows[w].window) {
                running = TRUE;
                break;
            }
        }
        gtk_widget_set_opacity(dock_dots[d], running ? 1.0 : 0.0);
    }
}

/* ═══════════════════════════════════════════════
 * App Launcher (Spotlight)
 * ═══════════════════════════════════════════════ */

static void on_launcher_entry_changed(GtkEditable *editable, gpointer data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(launcher_entry));
    if (!text || strlen(text) == 0) {
        /* Clear results */
        GList *children = gtk_container_get_children(GTK_CONTAINER(launcher_results));
        for (GList *l = children; l; l = l->next) {
            gtk_widget_destroy(GTK_WIDGET(l->data));
        }
        g_list_free(children);
        return;
    }

    /* Clear previous results */
    GList *children = gtk_container_get_children(GTK_CONTAINER(launcher_results));
    for (GList *l = children; l; l = l->next) {
        gtk_widget_destroy(GTK_WIDGET(l->data));
    }
    g_list_free(children);

    /* Search apps */
    char lower[256];
    strncpy(lower, text, sizeof(lower) - 1);
    lower[sizeof(lower) - 1] = '\0';
    for (char *p = lower; *p; p++) *p = tolower(*p);

    for (int i = 0; app_registry[i].id != NULL; i++) {
        char app_lower[128];
        strncpy(app_lower, app_registry[i].name, sizeof(app_lower) - 1);
        app_lower[sizeof(app_lower) - 1] = '\0';
        for (char *p = app_lower; *p; p++) *p = tolower(*p);

        if (strstr(app_lower, lower) || strstr(app_registry[i].id, lower)) {
            GtkWidget *row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
            GtkStyleContext *row_ctx = gtk_widget_get_style_context(row);
            gtk_style_context_add_class(row_ctx, "nova-launcher-result");

            GtkWidget *icon = gtk_label_new(app_registry[i].icon);
            PangoAttrList *attrs = pango_attr_list_new();
            pango_attr_list_insert(attrs, pango_attr_size_new(20 * PANGO_SCALE));
            gtk_label_set_attributes(GTK_LABEL(icon), attrs);
            pango_attr_list_unref(attrs);
            gtk_box_pack_start(GTK_BOX(row), icon, FALSE, FALSE, 8);

            GtkWidget *name = gtk_label_new(app_registry[i].name);
            gtk_box_pack_start(GTK_BOX(row), name, FALSE, FALSE, 0);

            GtkWidget *type_label = gtk_label_new("Application");
            gtk_widget_set_opacity(type_label, 0.5);
            gtk_box_pack_end(GTK_BOX(row), type_label, FALSE, FALSE, 8);

            /* Make it clickable */
            GtkWidget *evbox = gtk_event_box_new();
            gtk_container_add(GTK_CONTAINER(evbox), row);

            NovaApp *app = &app_registry[i];
            g_signal_connect(evbox, "button-press-event",
                G_CALLBACK(on_dock_icon_clicked), app);

            gtk_box_pack_start(GTK_BOX(launcher_results), evbox, FALSE, FALSE, 2);
        }
    }

    gtk_widget_show_all(launcher_results);
}

static void on_launcher_entry_activate(GtkEntry *entry, gpointer data)
{
    const char *text = gtk_entry_get_text(entry);
    if (!text || strlen(text) == 0) return;

    char lower[256];
    strncpy(lower, text, sizeof(lower) - 1);
    lower[sizeof(lower) - 1] = '\0';
    for (char *p = lower; *p; p++) *p = tolower(*p);

    /* Launch first matching app */
    for (int i = 0; app_registry[i].id != NULL; i++) {
        char app_lower[128];
        strncpy(app_lower, app_registry[i].name, sizeof(app_lower) - 1);
        app_lower[sizeof(app_lower) - 1] = '\0';
        for (char *p = app_lower; *p; p++) *p = tolower(*p);

        if (strstr(app_lower, lower) || strstr(app_registry[i].id, lower)) {
            nova_launch_app(&app_registry[i]);
            nova_hide_launcher();
            return;
        }
    }
}

static gboolean on_launcher_key_press(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    if (event->keyval == GDK_KEY_Escape) {
        nova_hide_launcher();
        return TRUE;
    }
    return FALSE;
}

static void create_launcher(void)
{
    launcher_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(launcher_window), "Astrion Spotlight");
    gtk_window_set_decorated(GTK_WINDOW(launcher_window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(launcher_window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(launcher_window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(launcher_window), GDK_WINDOW_TYPE_HINT_DIALOG);
    gtk_window_set_default_size(GTK_WINDOW(launcher_window), 560, 60);
    gtk_window_set_resizable(GTK_WINDOW(launcher_window), FALSE);
    gtk_window_set_position(GTK_WINDOW(launcher_window), GTK_WIN_POS_CENTER);
    gtk_window_set_keep_above(GTK_WINDOW(launcher_window), TRUE);
    gtk_window_set_modal(GTK_WINDOW(launcher_window), TRUE);

    GtkStyleContext *ctx = gtk_widget_get_style_context(launcher_window);
    gtk_style_context_add_class(ctx, "nova-launcher");

    /* Solid background — no compositor needed */
    GdkRGBA launcher_bg = {0.12, 0.12, 0.18, 1.0};
    gtk_widget_override_background_color(launcher_window, GTK_STATE_FLAG_NORMAL, &launcher_bg);

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_margin_start(vbox, 8);
    gtk_widget_set_margin_end(vbox, 8);
    gtk_widget_set_margin_top(vbox, 8);
    gtk_widget_set_margin_bottom(vbox, 8);
    gtk_container_add(GTK_CONTAINER(launcher_window), vbox);

    /* Search entry */
    launcher_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(launcher_entry), "Search or ask Astrion AI...");
    gtk_box_pack_start(GTK_BOX(vbox), launcher_entry, FALSE, FALSE, 0);

    /* Results */
    launcher_results = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_box_pack_start(GTK_BOX(vbox), launcher_results, TRUE, TRUE, 0);

    g_signal_connect(launcher_entry, "changed", G_CALLBACK(on_launcher_entry_changed), NULL);
    g_signal_connect(launcher_entry, "activate", G_CALLBACK(on_launcher_entry_activate), NULL);
    g_signal_connect(launcher_window, "key-press-event", G_CALLBACK(on_launcher_key_press), NULL);

    /* Don't show yet */
    gtk_widget_realize(launcher_window);
}

static void nova_show_launcher(void)
{
    if (launcher_visible) return;
    gtk_entry_set_text(GTK_ENTRY(launcher_entry), "");

    /* Clear results */
    GList *children = gtk_container_get_children(GTK_CONTAINER(launcher_results));
    for (GList *l = children; l; l = l->next) {
        gtk_widget_destroy(GTK_WIDGET(l->data));
    }
    g_list_free(children);

    /* Position at top-center of screen */
    int lx = (screen_width - 560) / 2;
    int ly = screen_height / 4;
    gtk_window_move(GTK_WINDOW(launcher_window), lx, ly);

    gtk_widget_show_all(launcher_window);
    gtk_window_present(GTK_WINDOW(launcher_window));
    gtk_widget_grab_focus(launcher_entry);
    launcher_visible = TRUE;
}

static void nova_hide_launcher(void)
{
    if (!launcher_visible) return;
    gtk_widget_hide(launcher_window);
    launcher_visible = FALSE;
}

static void nova_toggle_launcher(void)
{
    if (launcher_visible) nova_hide_launcher();
    else nova_show_launcher();
}

/* ═══════════════════════════════════════════════
 * Window Manager — Native GTK Windows for Apps
 * ═══════════════════════════════════════════════ */

/* Manual window dragging (no WM needed) */
static int drag_start_x, drag_start_y, drag_win_x, drag_win_y;
static gboolean dragging = FALSE;

static gboolean on_window_titlebar_press(GtkWidget *widget, GdkEventButton *event, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    if (event->type == GDK_2BUTTON_PRESS) {
        nova_maximize_window(nwin);
        return TRUE;
    }
    if (event->button == 1) {
        dragging = TRUE;
        drag_start_x = (int)event->x_root;
        drag_start_y = (int)event->y_root;
        gtk_window_get_position(GTK_WINDOW(nwin->window), &drag_win_x, &drag_win_y);
        return TRUE;
    }
    return FALSE;
}

static gboolean on_window_titlebar_motion(GtkWidget *widget, GdkEventMotion *event, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    if (dragging && nwin->window) {
        int dx = (int)event->x_root - drag_start_x;
        int dy = (int)event->y_root - drag_start_y;
        gtk_window_move(GTK_WINDOW(nwin->window), drag_win_x + dx, drag_win_y + dy);

        /* Detect snap zones */
        int mx = (int)event->x_root;
        int my = (int)event->y_root;
        if (mx < 20) {
            snap_zone = 1; /* left half */
        } else if (mx > screen_width - 20) {
            snap_zone = 2; /* right half */
        } else if (my < 20) {
            snap_zone = 3; /* maximize */
        } else {
            snap_zone = 0; /* no snap */
        }
    }
    return FALSE;
}

static gboolean on_window_titlebar_release(GtkWidget *widget, GdkEventButton *event, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;

    if (dragging && snap_zone != 0 && nwin && nwin->window) {
        int snap_y = PANEL_HEIGHT;
        int snap_h = screen_height - PANEL_HEIGHT - DOCK_HEIGHT - 16;

        /* Save current geometry for un-snap later */
        if (!nwin->maximized) {
            gtk_window_get_position(GTK_WINDOW(nwin->window), &nwin->save_x, &nwin->save_y);
            gtk_window_get_size(GTK_WINDOW(nwin->window), &nwin->save_w, &nwin->save_h);
        }

        if (snap_zone == 1) {
            /* Snap left half */
            gtk_window_move(GTK_WINDOW(nwin->window), 0, snap_y);
            gtk_window_resize(GTK_WINDOW(nwin->window), screen_width / 2, snap_h);
            nwin->maximized = TRUE;
        } else if (snap_zone == 2) {
            /* Snap right half */
            gtk_window_move(GTK_WINDOW(nwin->window), screen_width / 2, snap_y);
            gtk_window_resize(GTK_WINDOW(nwin->window), screen_width / 2, snap_h);
            nwin->maximized = TRUE;
        } else if (snap_zone == 3) {
            /* Maximize (top edge) */
            gtk_window_move(GTK_WINDOW(nwin->window), 0, snap_y);
            gtk_window_resize(GTK_WINDOW(nwin->window), screen_width, snap_h);
            nwin->maximized = TRUE;
        }
        snap_zone = 0;
    }

    dragging = FALSE;
    return FALSE;
}

static void on_window_close_clicked(GtkButton *btn, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    nova_close_window(nwin);
}

static void on_window_minimize_clicked(GtkButton *btn, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    nova_minimize_window(nwin);
}

static void on_window_maximize_clicked(GtkButton *btn, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    nova_maximize_window(nwin);
}

static gboolean on_window_focus_in(GtkWidget *widget, GdkEvent *event, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    focused_window = nwin;
    return FALSE;
}

/* ─── App window callbacks (pure C, no C++ lambdas) ─── */

static gboolean on_app_context_menu(WebKitWebView *v, WebKitContextMenu *m,
                                     GdkEvent *e, WebKitHitTestResult *h,
                                     gpointer d)
{
    return TRUE; /* Suppress browser context menu */
}

static void on_app_window_destroy(gpointer data)
{
    NovaWindow *nw = (NovaWindow *)data;
    nw->window = NULL;
    nw->webview = NULL;
}

static void on_app_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data)
{
    if (event == WEBKIT_LOAD_FINISHED) {
        webkit_web_view_run_javascript(view,
            "window.__ASTRION_NATIVE__ = true;"
            "window.__ASTRION_RENDERER__ = 'astrion-shell';"
            "document.documentElement.classList.add('astrion-native');",
            NULL, NULL, NULL);
    }
}

static void nova_launch_app(NovaApp *app)
{
    if (window_count >= MAX_WINDOWS) return;

    /* Check single instance */
    if (app->single) {
        for (int i = 0; i < window_count; i++) {
            if (windows[i].app == app && windows[i].window) {
                if (windows[i].minimized) {
                    gtk_widget_show(windows[i].window);
                    windows[i].minimized = FALSE;
                }
                nova_focus_window(&windows[i]);
                return;
            }
        }
    }

    NovaWindow *nwin = &windows[window_count];
    memset(nwin, 0, sizeof(NovaWindow));
    nwin->id = next_window_id++;
    nwin->app = app;

    /* Default window size: 50% screen width, 70% screen height, centered */
    nwin->w = screen_width / 2;
    nwin->h = (int)(screen_height * 0.7);
    nwin->x = (screen_width - nwin->w) / 2 + (window_count % 5) * 30;
    nwin->y = PANEL_HEIGHT + ((screen_height - PANEL_HEIGHT - DOCK_HEIGHT - 16 - nwin->h) / 2)
              + (window_count % 5) * 20;

    /* Create the window */
    nwin->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(nwin->window), app->name);
    gtk_window_set_default_size(GTK_WINDOW(nwin->window), nwin->w, nwin->h);
    gtk_window_move(GTK_WINDOW(nwin->window), nwin->x, nwin->y);
    gtk_window_set_decorated(GTK_WINDOW(nwin->window), FALSE);  /* We draw our own titlebar */

    /* Solid background — no compositor needed */
    GdkRGBA win_bg = {0.07, 0.07, 0.13, 1.0};
    gtk_widget_override_background_color(nwin->window, GTK_STATE_FLAG_NORMAL, &win_bg);

    /* Main vertical layout */
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(nwin->window), vbox);

    /* ─── Custom titlebar ─── */
    GtkWidget *titlebar = gtk_event_box_new();
    GtkStyleContext *tb_ctx = gtk_widget_get_style_context(titlebar);
    gtk_style_context_add_class(tb_ctx, "nova-window-titlebar");
    gtk_widget_set_events(titlebar, GDK_BUTTON_PRESS_MASK | GDK_BUTTON_RELEASE_MASK | GDK_POINTER_MOTION_MASK);
    g_signal_connect(titlebar, "button-press-event",
        G_CALLBACK(on_window_titlebar_press), nwin);
    g_signal_connect(titlebar, "motion-notify-event",
        G_CALLBACK(on_window_titlebar_motion), nwin);
    g_signal_connect(titlebar, "button-release-event",
        G_CALLBACK(on_window_titlebar_release), nwin);

    GtkWidget *tb_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_margin_start(tb_box, 8);
    gtk_widget_set_margin_end(tb_box, 8);
    gtk_container_add(GTK_CONTAINER(titlebar), tb_box);

    /* Traffic light buttons */
    GtkWidget *btn_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
    gtk_widget_set_valign(btn_box, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(tb_box), btn_box, FALSE, FALSE, 0);

    GtkWidget *close_btn = gtk_button_new();
    gtk_widget_set_size_request(close_btn, 16, 16);
    GtkStyleContext *close_ctx = gtk_widget_get_style_context(close_btn);
    gtk_style_context_add_class(close_ctx, "nova-window-btn");
    gtk_style_context_add_class(close_ctx, "nova-window-close");
    gtk_button_set_relief(GTK_BUTTON(close_btn), GTK_RELIEF_NONE);
    g_signal_connect(close_btn, "clicked", G_CALLBACK(on_window_close_clicked), nwin);
    gtk_box_pack_start(GTK_BOX(btn_box), close_btn, FALSE, FALSE, 0);

    GtkWidget *min_btn = gtk_button_new();
    gtk_widget_set_size_request(min_btn, 16, 16);
    GtkStyleContext *min_ctx = gtk_widget_get_style_context(min_btn);
    gtk_style_context_add_class(min_ctx, "nova-window-btn");
    gtk_style_context_add_class(min_ctx, "nova-window-minimize");
    gtk_button_set_relief(GTK_BUTTON(min_btn), GTK_RELIEF_NONE);
    g_signal_connect(min_btn, "clicked", G_CALLBACK(on_window_minimize_clicked), nwin);
    gtk_box_pack_start(GTK_BOX(btn_box), min_btn, FALSE, FALSE, 0);

    GtkWidget *max_btn = gtk_button_new();
    gtk_widget_set_size_request(max_btn, 16, 16);
    GtkStyleContext *max_ctx = gtk_widget_get_style_context(max_btn);
    gtk_style_context_add_class(max_ctx, "nova-window-btn");
    gtk_style_context_add_class(max_ctx, "nova-window-maximize");
    gtk_button_set_relief(GTK_BUTTON(max_btn), GTK_RELIEF_NONE);
    g_signal_connect(max_btn, "clicked", G_CALLBACK(on_window_maximize_clicked), nwin);
    gtk_box_pack_start(GTK_BOX(btn_box), max_btn, FALSE, FALSE, 0);

    /* Title text (centered) */
    GtkWidget *title_label = gtk_label_new(app->name);
    gtk_label_set_ellipsize(GTK_LABEL(title_label), PANGO_ELLIPSIZE_MIDDLE);
    gtk_box_pack_start(GTK_BOX(tb_box), title_label, TRUE, TRUE, 0);

    /* Empty spacer to balance the buttons */
    GtkWidget *spacer = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_size_request(spacer, 56, -1);
    gtk_box_pack_end(GTK_BOX(tb_box), spacer, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(vbox), titlebar, FALSE, FALSE, 0);

    /* ─── WebKitGTK view for the app content ─── */
    WebKitSettings *ws = webkit_settings_new();
    webkit_settings_set_enable_javascript(ws, TRUE);
    webkit_settings_set_javascript_can_access_clipboard(ws, TRUE);
    webkit_settings_set_enable_html5_database(ws, TRUE);
    webkit_settings_set_enable_html5_local_storage(ws, TRUE);
    webkit_settings_set_enable_smooth_scrolling(ws, TRUE);
    webkit_settings_set_enable_webgl(ws, TRUE);
    webkit_settings_set_enable_webaudio(ws, TRUE);
    webkit_settings_set_enable_media_stream(ws, TRUE);
    webkit_settings_set_allow_file_access_from_file_urls(ws, TRUE);
    webkit_settings_set_hardware_acceleration_policy(ws,
        WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
    webkit_settings_set_user_agent(ws,
        "AstrionOS/1.0 (Native; Linux x86_64) AstrionRenderer/1.0");

    nwin->webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_settings(ws));

    /* Solid webview background — no compositor needed */
    GdkRGBA bg = {0.07, 0.07, 0.13, 1.0};
    webkit_web_view_set_background_color(nwin->webview, &bg);

    /* Apply HiDPI zoom from config */
    double zoom = get_hidpi_zoom();
    if (zoom != 1.0) {
        webkit_web_view_set_zoom_level(nwin->webview, zoom);
    }

    /* Suppress default context menu */
    g_signal_connect(nwin->webview, "context-menu",
        G_CALLBACK(on_app_context_menu), NULL);

    gtk_box_pack_start(GTK_BOX(vbox), GTK_WIDGET(nwin->webview), TRUE, TRUE, 0);

    /* Connect focus signal */
    g_signal_connect(nwin->window, "focus-in-event",
        G_CALLBACK(on_window_focus_in), nwin);

    /* Handle window close via WM */
    g_signal_connect_swapped(nwin->window, "destroy",
        G_CALLBACK(on_app_window_destroy), nwin);

    /* Enable resize */
    gtk_window_set_resizable(GTK_WINDOW(nwin->window), TRUE);

    /* Load the app URL */
    char full_url[512];
    if (app->url) {
        snprintf(full_url, sizeof(full_url), "%s%s", NOVA_SERVER_URL, app->url);
    } else {
        snprintf(full_url, sizeof(full_url), "%s", NOVA_SERVER_URL);
    }

    /* Inject Astrion native mode flag after load */
    g_signal_connect(nwin->webview, "load-changed",
        G_CALLBACK(on_app_load_changed), NULL);

    webkit_web_view_load_uri(nwin->webview, full_url);

    /* Show the window */
    gtk_widget_show_all(nwin->window);
    focused_window = nwin;
    window_count++;

    update_dock();
}

static void nova_close_window(NovaWindow *nwin)
{
    if (!nwin || !nwin->window) return;
    gtk_widget_destroy(nwin->window);
    nwin->window = NULL;
    nwin->webview = NULL;
    nwin->app = NULL;

    if (focused_window == nwin) {
        focused_window = NULL;
    }

    update_dock();
}

static void nova_focus_window(NovaWindow *nwin)
{
    if (!nwin || !nwin->window) return;
    gtk_window_present(GTK_WINDOW(nwin->window));
    focused_window = nwin;
}

static void nova_minimize_window(NovaWindow *nwin)
{
    if (!nwin || !nwin->window) return;
    gtk_window_iconify(GTK_WINDOW(nwin->window));
    nwin->minimized = TRUE;
}

static void nova_maximize_window(NovaWindow *nwin)
{
    if (!nwin || !nwin->window) return;

    if (nwin->maximized) {
        /* Restore */
        gtk_window_unmaximize(GTK_WINDOW(nwin->window));
        gtk_window_resize(GTK_WINDOW(nwin->window), nwin->save_w, nwin->save_h);
        gtk_window_move(GTK_WINDOW(nwin->window), nwin->save_x, nwin->save_y);
        nwin->maximized = FALSE;
    } else {
        /* Save current position */
        gtk_window_get_position(GTK_WINDOW(nwin->window), &nwin->save_x, &nwin->save_y);
        gtk_window_get_size(GTK_WINDOW(nwin->window), &nwin->save_w, &nwin->save_h);
        /* Maximize to fill screen minus panel */
        gtk_window_move(GTK_WINDOW(nwin->window), 0, PANEL_HEIGHT);
        gtk_window_resize(GTK_WINDOW(nwin->window),
            screen_width, screen_height - PANEL_HEIGHT - DOCK_HEIGHT - 16);
        nwin->maximized = TRUE;
    }
}

/* ═══════════════════════════════════════════════
 * Notifications
 * ═══════════════════════════════════════════════ */

static void nova_show_notification(const char *title, const char *body)
{
    if (notif_count < MAX_NOTIFICATIONS) {
        strncpy(notifications[notif_count].title, title, 127);
        strncpy(notifications[notif_count].body, body, 255);
        notifications[notif_count].timestamp = time(NULL);
        notif_count++;
    }

    /* Show a toast notification */
    GtkWidget *notif_win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_decorated(GTK_WINDOW(notif_win), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(notif_win), TRUE);
    gtk_window_set_keep_above(GTK_WINDOW(notif_win), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(notif_win), GDK_WINDOW_TYPE_HINT_NOTIFICATION);
    gtk_window_set_default_size(GTK_WINDOW(notif_win), 320, 80);
    gtk_window_move(GTK_WINDOW(notif_win), screen_width - 340, 40);

    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_start(box, 16);
    gtk_widget_set_margin_end(box, 16);
    gtk_widget_set_margin_top(box, 12);
    gtk_widget_set_margin_bottom(box, 12);

    GtkWidget *title_lbl = gtk_label_new(NULL);
    char markup[256];
    snprintf(markup, sizeof(markup),
        "<span weight='bold' foreground='#ffffff'>%s</span>", title);
    gtk_label_set_markup(GTK_LABEL(title_lbl), markup);
    gtk_label_set_xalign(GTK_LABEL(title_lbl), 0);
    gtk_box_pack_start(GTK_BOX(box), title_lbl, FALSE, FALSE, 0);

    GtkWidget *body_lbl = gtk_label_new(body);
    gtk_label_set_xalign(GTK_LABEL(body_lbl), 0);
    gtk_widget_set_opacity(body_lbl, 0.7);
    gtk_box_pack_start(GTK_BOX(box), body_lbl, FALSE, FALSE, 0);

    gtk_container_add(GTK_CONTAINER(notif_win), box);

    GdkRGBA notif_bg = {0.12, 0.12, 0.18, 1.0};
    gtk_widget_override_background_color(notif_win, GTK_STATE_FLAG_NORMAL, &notif_bg);

    gtk_widget_show_all(notif_win);

    /* Auto-dismiss after 4 seconds */
    g_timeout_add(4000, (GSourceFunc)gtk_widget_destroy, notif_win);
}

/* ═══════════════════════════════════════════════
 * Alt+Tab App Switcher
 * ═══════════════════════════════════════════════ */

static void hide_app_switcher(void)
{
    if (!switcher_visible || !switcher_window) return;
    gtk_widget_hide(switcher_window);
    switcher_visible = FALSE;
}

static void commit_app_switcher(void)
{
    if (!switcher_visible) return;
    if (switcher_count > 0 && switcher_index < switcher_count) {
        NovaWindow *nwin = switcher_wins[switcher_index];
        if (nwin && nwin->window) {
            if (nwin->minimized) {
                gtk_widget_show(nwin->window);
                nwin->minimized = FALSE;
            }
            nova_focus_window(nwin);
        }
    }
    hide_app_switcher();
}

static void cycle_app_switcher(void)
{
    if (!switcher_visible || switcher_count == 0) return;

    /* Un-highlight current */
    if (switcher_labels[switcher_index]) {
        GdkRGBA normal_bg = {0.12, 0.12, 0.18, 1.0};
        gtk_widget_override_background_color(switcher_labels[switcher_index],
            GTK_STATE_FLAG_NORMAL, &normal_bg);
    }

    switcher_index = (switcher_index + 1) % switcher_count;

    /* Highlight new selection */
    if (switcher_labels[switcher_index]) {
        GdkRGBA hl_bg = {0.0, 0.478, 1.0, 1.0}; /* #007aff */
        gtk_widget_override_background_color(switcher_labels[switcher_index],
            GTK_STATE_FLAG_NORMAL, &hl_bg);
    }
}

static void show_app_switcher(void)
{
    /* Collect open windows */
    switcher_count = 0;
    for (int i = 0; i < window_count; i++) {
        if (windows[i].window != NULL && windows[i].app != NULL) {
            switcher_wins[switcher_count] = &windows[i];
            switcher_count++;
        }
    }
    if (switcher_count == 0) return;

    /* If already visible, just cycle */
    if (switcher_visible) {
        cycle_app_switcher();
        return;
    }

    switcher_index = 0;

    /* Destroy old switcher window if lingering */
    if (switcher_window) {
        gtk_widget_destroy(switcher_window);
        switcher_window = NULL;
    }

    /* Create popup */
    switcher_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_decorated(GTK_WINDOW(switcher_window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(switcher_window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(switcher_window), TRUE);
    gtk_window_set_keep_above(GTK_WINDOW(switcher_window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(switcher_window), GDK_WINDOW_TYPE_HINT_DIALOG);
    gtk_window_set_position(GTK_WINDOW(switcher_window), GTK_WIN_POS_CENTER);
    gtk_window_set_resizable(GTK_WINDOW(switcher_window), FALSE);

    GdkRGBA sw_bg = {0.118, 0.118, 0.180, 1.0}; /* #1e1e2e */
    gtk_widget_override_background_color(switcher_window, GTK_STATE_FLAG_NORMAL, &sw_bg);

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_start(vbox, 12);
    gtk_widget_set_margin_end(vbox, 12);
    gtk_widget_set_margin_top(vbox, 12);
    gtk_widget_set_margin_bottom(vbox, 12);
    gtk_container_add(GTK_CONTAINER(switcher_window), vbox);

    /* Title */
    GtkWidget *title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(title),
        "<span foreground='#888888' size='10000'>Switch Application</span>");
    gtk_label_set_xalign(GTK_LABEL(title), 0);
    gtk_box_pack_start(GTK_BOX(vbox), title, FALSE, FALSE, 4);

    /* List each open window */
    for (int i = 0; i < switcher_count; i++) {
        GtkWidget *row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
        gtk_widget_set_margin_start(row, 8);
        gtk_widget_set_margin_end(row, 8);
        gtk_widget_set_margin_top(row, 4);
        gtk_widget_set_margin_bottom(row, 4);

        /* App icon */
        GtkWidget *icon = gtk_label_new(switcher_wins[i]->app->icon);
        gtk_box_pack_start(GTK_BOX(row), icon, FALSE, FALSE, 4);

        /* App name */
        GtkWidget *name = gtk_label_new(NULL);
        char markup[256];
        snprintf(markup, sizeof(markup),
            "<span foreground='#ffffff' size='12000'>%s</span>",
            switcher_wins[i]->app->name);
        gtk_label_set_markup(GTK_LABEL(name), markup);
        gtk_box_pack_start(GTK_BOX(row), name, FALSE, FALSE, 4);

        /* Highlight first entry */
        if (i == 0) {
            GdkRGBA hl_bg = {0.0, 0.478, 1.0, 1.0};
            gtk_widget_override_background_color(row, GTK_STATE_FLAG_NORMAL, &hl_bg);
        } else {
            GdkRGBA normal_bg = {0.12, 0.12, 0.18, 1.0};
            gtk_widget_override_background_color(row, GTK_STATE_FLAG_NORMAL, &normal_bg);
        }

        switcher_labels[i] = row;
        gtk_box_pack_start(GTK_BOX(vbox), row, FALSE, FALSE, 0);
    }

    int sw_width = 300;
    int sw_height = 60 + switcher_count * 40;
    gtk_window_set_default_size(GTK_WINDOW(switcher_window), sw_width, sw_height);

    gtk_widget_show_all(switcher_window);
    switcher_visible = TRUE;
}

/* ═══════════════════════════════════════════════
 * Global Keyboard Shortcuts
 * ═══════════════════════════════════════════════ */

/* Global key snooper — catches Ctrl+Space and Alt+Tab from ANY window */
static gint global_key_snooper(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    /* Alt release — commit app switcher selection */
    if (event->type == GDK_KEY_RELEASE &&
        (event->keyval == GDK_KEY_Alt_L || event->keyval == GDK_KEY_Alt_R)) {
        if (switcher_visible) {
            commit_app_switcher();
            return TRUE;
        }
    }

    if (event->type != GDK_KEY_PRESS) return FALSE;

    /* Alt+Tab — app switcher */
    if ((event->state & GDK_MOD1_MASK) && event->keyval == GDK_KEY_Tab) {
        show_app_switcher();
        return TRUE;
    }

    gboolean ctrl = (event->state & GDK_CONTROL_MASK);

    /* Ctrl+Space — toggle Spotlight launcher */
    if (ctrl && event->keyval == GDK_KEY_space) {
        nova_toggle_launcher();
        return TRUE; /* consumed */
    }

    /* Super/Meta key — also toggle Spotlight */
    if (event->keyval == GDK_KEY_Super_L || event->keyval == GDK_KEY_Super_R) {
        nova_toggle_launcher();
        return TRUE;
    }

    /* Ctrl+; — emoji picker */
    if (ctrl && event->keyval == GDK_KEY_semicolon) {
        toggle_popup(&popup_emoji_win, "Emoji Picker",
            "/popup/emoji", 480, 500);
        return TRUE;
    }

    /* Ctrl+Shift+V — clipboard manager */
    if (ctrl && (event->state & GDK_SHIFT_MASK) &&
        (event->keyval == GDK_KEY_v || event->keyval == GDK_KEY_V)) {
        toggle_popup(&popup_clipboard_win, "Clipboard",
            "/popup/clipboard", 480, 500);
        return TRUE;
    }

    /* Track user activity for screensaver */
    last_user_activity = time(NULL);
    if (screensaver_on) {
        hide_screensaver_cb(NULL, NULL);
        if (screensaver_win) gtk_widget_hide(screensaver_win);
    }

    return FALSE; /* pass through */
}

/* ═══════════════════════════════════════════════
 * Initialization
 * ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
 * Popup Overlay Windows (opaque, on-demand)
 * Each loads a minimal HTML page from the server.
 * ═══════════════════════════════════════════════ */

static GtkWidget* create_popup_window(const char *title, const char *url,
    int w, int h, int x, int y, gboolean fullscreen)
{
    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(win), title);
    gtk_window_set_decorated(GTK_WINDOW(win), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(win), TRUE);
    gtk_window_set_keep_above(GTK_WINDOW(win), TRUE);

    if (fullscreen) {
        gtk_window_set_default_size(GTK_WINDOW(win), screen_width, screen_height);
        gtk_window_move(GTK_WINDOW(win), 0, 0);
    } else {
        gtk_window_set_default_size(GTK_WINDOW(win), w, h);
        gtk_window_move(GTK_WINDOW(win), x, y);
    }

    GdkRGBA bg = {0.05, 0.05, 0.10, 1.0};
    gtk_widget_override_background_color(win, GTK_STATE_FLAG_NORMAL, &bg);

    WebKitSettings *s = webkit_settings_new();
    webkit_settings_set_enable_javascript(s, TRUE);
    webkit_settings_set_enable_html5_local_storage(s, TRUE);
    webkit_settings_set_enable_webaudio(s, TRUE);

    const gchar *home = g_get_home_dir();
    gchar *d = g_build_filename(home, ".local", "share", "nova-renderer", NULL);
    gchar *c = g_build_filename(home, ".cache", "nova-renderer", NULL);
    WebKitWebsiteDataManager *dm = webkit_website_data_manager_new(
        "base-data-directory", d, "base-cache-directory", c, NULL);
    WebKitWebContext *ctx = webkit_web_context_new_with_website_data_manager(dm);
    g_free(d); g_free(c);

    WebKitWebView *wv = WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW,
        "settings", s, "web-context", ctx, NULL));

    GdkRGBA wv_bg = {0.05, 0.05, 0.10, 1.0};
    webkit_web_view_set_background_color(wv, &wv_bg);

    double zoom = get_hidpi_zoom();
    if (zoom > 0) webkit_web_view_set_zoom_level(wv, zoom);

    gtk_container_add(GTK_CONTAINER(win), GTK_WIDGET(wv));

    char full_url[512];
    snprintf(full_url, sizeof(full_url), "%s%s", NOVA_SERVER_URL, url);
    webkit_web_view_load_uri(wv, full_url);

    return win;
}

/* ── Popup callbacks (must be declared before use) ── */
static gboolean popup_key_handler(GtkWidget *w, GdkEventKey *e, gpointer data)
{
    if (e->keyval == GDK_KEY_Escape) {
        gtk_widget_hide(w);
        return TRUE;
    }
    return FALSE;
}

static void hide_screensaver_cb(GtkWidget *w, gpointer data)
{
    screensaver_on = FALSE;
    last_user_activity = time(NULL);
}

static gboolean screensaver_dismiss(GtkWidget *w, GdkEvent *e, gpointer data)
{
    gtk_widget_hide(w);
    screensaver_on = FALSE;
    last_user_activity = time(NULL);
    return TRUE;
}

/* ── Screensaver ── */
static void show_screensaver(void)
{
    if (screensaver_on) return;
    if (!screensaver_win) {
        screensaver_win = create_popup_window("Screensaver",
            "/popup/screensaver", 0, 0, 0, 0, TRUE);
        g_signal_connect(screensaver_win, "key-press-event",
            G_CALLBACK(screensaver_dismiss), NULL);
        g_signal_connect(screensaver_win, "button-press-event",
            G_CALLBACK(screensaver_dismiss), NULL);
        g_signal_connect(screensaver_win, "hide",
            G_CALLBACK(hide_screensaver_cb), NULL);
    }
    gtk_widget_show_all(screensaver_win);
    screensaver_on = TRUE;
}

/* ── Idle checker for screensaver ── */
static gboolean check_idle_for_screensaver(gpointer data)
{
    if (screensaver_on) return TRUE;
    time_t now = time(NULL);
    if (last_user_activity == 0) last_user_activity = now;
    if (now - last_user_activity >= SCREENSAVER_TIMEOUT) {
        show_screensaver();
    }
    return TRUE;
}

/* ── Generic popup toggle ── */
static void toggle_popup(GtkWidget **win_ptr, const char *title,
    const char *url, int w, int h)
{
    if (*win_ptr && gtk_widget_get_visible(*win_ptr)) {
        gtk_widget_hide(*win_ptr);
        return;
    }
    if (!*win_ptr) {
        int x = (screen_width - w) / 2;
        int y = (screen_height - h) / 2;
        *win_ptr = create_popup_window(title, url, w, h, x, y, FALSE);
        g_signal_connect(*win_ptr, "key-press-event",
            G_CALLBACK(popup_key_handler), NULL);
    }
    gtk_widget_show_all(*win_ptr);
    gtk_window_present(GTK_WINDOW(*win_ptr));
}

static void signal_handler(int sig)
{
    gtk_main_quit();
}

int main(int argc, char *argv[])
{
    gboolean dev_mode = FALSE;
    const char *server_url = NOVA_SERVER_URL;

    /* Parse args */
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--dev") == 0) dev_mode = TRUE;
        if (strcmp(argv[i], "--url") == 0 && i + 1 < argc) server_url = argv[++i];
        if (strcmp(argv[i], "--help") == 0) {
            g_print("Astrion OS Shell v" NOVA_VERSION "\n");
            g_print("Usage: nova-shell [OPTIONS]\n\n");
            g_print("Options:\n");
            g_print("  --dev        Enable developer tools\n");
            g_print("  --url URL    Server URL (default: %s)\n", NOVA_SERVER_URL);
            g_print("  --help       Show this help\n");
            return 0;
        }
    }

    /* Set process name */
    if (argc > 0 && strlen(argv[0]) >= strlen("nova-shell")) {
        strncpy(argv[0], "nova-shell\0", strlen(argv[0]));
    }

    /* Init GTK */
    gtk_init(&argc, &argv);

    /* Register global keyboard shortcut handler */
    gtk_key_snooper_install(global_key_snooper, NULL);

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    /* Get screen dimensions */
    GdkScreen *screen = gdk_screen_get_default();
    screen_width = gdk_screen_get_width(screen);
    screen_height = gdk_screen_get_height(screen);
    g_print("[Astrion Shell] Screen: %dx%d\n", screen_width, screen_height);

    /* Count apps */
    for (app_count = 0; app_registry[app_count].id != NULL; app_count++);
    g_print("[Astrion Shell] Registered %d apps\n", app_count);

    /* Apply CSS theme */
    apply_css_theme();

    /* Create desktop layers */
    g_print("[Astrion Shell] Creating desktop...\n");
    create_desktop();

    g_print("[Astrion Shell] Creating panel...\n");
    create_panel();

    g_print("[Astrion Shell] Creating dock...\n");
    create_dock();

    g_print("[Astrion Shell] Creating launcher...\n");
    create_launcher();

    /* Start screensaver idle checker (every 10 seconds) */
    last_user_activity = time(NULL);
    g_timeout_add(10000, check_idle_for_screensaver, NULL);

    /* Show welcome notification */
    nova_show_notification("Welcome to Astrion OS",
        "Your AI-native operating system is ready.");

    g_print("[Astrion Shell] Desktop ready!\n");
    g_print("[Astrion Shell] Press Ctrl+Space or click the search icon for Spotlight\n");

    /* Run GTK main loop */
    gtk_main();

    g_print("[Astrion Shell] Shutting down...\n");
    return 0;
}
