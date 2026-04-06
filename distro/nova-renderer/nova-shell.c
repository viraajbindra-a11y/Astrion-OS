/*
 * NOVA OS — Native Desktop Shell
 *
 * This IS the NOVA OS desktop environment, written in C with GTK3.
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

/* ═══════════════════════════════════════════════
 * Constants & Configuration
 * ═══════════════════════════════════════════════ */

#define NOVA_VERSION       "1.0"
#define NOVA_SERVER_URL    "http://localhost:3000"

#define PANEL_HEIGHT       28
#define DOCK_HEIGHT        64
#define DOCK_ICON_SIZE     48
#define DOCK_PADDING       8

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
    { "activity-monitor","Activity Monitor", "\xF0\x9F\x93\x8A", "/app/activity-monitor", FALSE, TRUE  },
    { "vault",           "Vault",            "\xF0\x9F\x94\x90", "/app/vault",            TRUE,  TRUE  },
    { "appstore",        "App Store",        "\xF0\x9F\x9B\x8D",  "/app/appstore",         FALSE, TRUE  },
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
 * CSS Theme
 * ═══════════════════════════════════════════════ */

static void apply_css_theme(void)
{
    GtkCssProvider *provider = gtk_css_provider_new();
    const char *css =
        "/* NOVA OS Native Theme */\n"
        "* {\n"
        "  font-family: 'Inter', 'SF Pro Display', 'Segoe UI', sans-serif;\n"
        "  color: #e0e0e0;\n"
        "}\n"
        "\n"
        ".nova-panel {\n"
        "  background: rgba(20, 20, 30, 0.85);\n"
        "  border-bottom: 1px solid rgba(255,255,255,0.06);\n"
        "}\n"
        "\n"
        ".nova-panel label {\n"
        "  font-size: 13px;\n"
        "  font-weight: 500;\n"
        "  color: #e0e0e0;\n"
        "  padding: 0 8px;\n"
        "}\n"
        "\n"
        ".nova-panel-apple {\n"
        "  font-weight: 700;\n"
        "  font-size: 14px;\n"
        "  color: #ffffff;\n"
        "  padding: 0 12px;\n"
        "}\n"
        "\n"
        ".nova-panel-right label {\n"
        "  font-size: 12px;\n"
        "  color: #c0c0c0;\n"
        "}\n"
        "\n"
        ".nova-dock {\n"
        "  background: rgba(30, 30, 46, 0.80);\n"
        "  border: 1px solid rgba(255,255,255,0.08);\n"
        "  border-radius: 16px;\n"
        "  padding: 4px 12px;\n"
        "}\n"
        "\n"
        ".nova-dock-icon {\n"
        "  font-size: 32px;\n"
        "  padding: 4px 6px;\n"
        "  border-radius: 12px;\n"
        "  transition: 200ms ease;\n"
        "}\n"
        "\n"
        ".nova-dock-icon:hover {\n"
        "  background: rgba(255,255,255,0.1);\n"
        "}\n"
        "\n"
        ".nova-dock-dot {\n"
        "  font-size: 6px;\n"
        "  color: rgba(255,255,255,0.5);\n"
        "}\n"
        "\n"
        ".nova-launcher {\n"
        "  background: rgba(30, 30, 46, 0.95);\n"
        "  border: 1px solid rgba(255,255,255,0.1);\n"
        "  border-radius: 12px;\n"
        "}\n"
        "\n"
        ".nova-launcher entry {\n"
        "  background: rgba(255,255,255,0.08);\n"
        "  border: none;\n"
        "  border-radius: 8px;\n"
        "  padding: 12px 16px;\n"
        "  font-size: 18px;\n"
        "  color: #ffffff;\n"
        "  min-height: 40px;\n"
        "}\n"
        "\n"
        ".nova-launcher entry:focus {\n"
        "  background: rgba(255,255,255,0.12);\n"
        "}\n"
        "\n"
        ".nova-launcher-result {\n"
        "  padding: 8px 16px;\n"
        "  border-radius: 8px;\n"
        "}\n"
        "\n"
        ".nova-launcher-result:hover {\n"
        "  background: rgba(0, 122, 255, 0.3);\n"
        "}\n"
        "\n"
        ".nova-window-titlebar {\n"
        "  background: linear-gradient(rgba(40, 40, 55, 0.98), rgba(35, 35, 48, 0.98));\n"
        "  border-bottom: 1px solid rgba(255,255,255,0.05);\n"
        "  border-radius: 10px 10px 0 0;\n"
        "  min-height: 36px;\n"
        "}\n"
        "\n"
        ".nova-window-titlebar label {\n"
        "  font-size: 13px;\n"
        "  font-weight: 600;\n"
        "  color: #d0d0d0;\n"
        "}\n"
        "\n"
        ".nova-window-btn {\n"
        "  min-width: 12px;\n"
        "  min-height: 12px;\n"
        "  border-radius: 50%;\n"
        "  padding: 0;\n"
        "  margin: 0 3px;\n"
        "  border: none;\n"
        "}\n"
        "\n"
        ".nova-window-close {\n"
        "  background: #ff5f57;\n"
        "}\n"
        ".nova-window-close:hover {\n"
        "  background: #ff3b30;\n"
        "}\n"
        "\n"
        ".nova-window-minimize {\n"
        "  background: #ffbd2e;\n"
        "}\n"
        ".nova-window-minimize:hover {\n"
        "  background: #ffc940;\n"
        "}\n"
        "\n"
        ".nova-window-maximize {\n"
        "  background: #28c840;\n"
        "}\n"
        ".nova-window-maximize:hover {\n"
        "  background: #32d74b;\n"
        "}\n"
        "\n"
        ".nova-about-dialog {\n"
        "  background: rgba(30, 30, 46, 0.95);\n"
        "  border: 1px solid rgba(255,255,255,0.1);\n"
        "  border-radius: 16px;\n"
        "}\n"
        "\n"
        ".nova-menu {\n"
        "  background: rgba(30, 30, 46, 0.95);\n"
        "  border: 1px solid rgba(255,255,255,0.1);\n"
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
        "  background: rgba(0, 122, 255, 0.4);\n"
        "}\n"
        "\n"
        "tooltip {\n"
        "  background: rgba(30, 30, 46, 0.95);\n"
        "  border: 1px solid rgba(255,255,255,0.1);\n"
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

    /* Subtle radial glow in center */
    cairo_pattern_t *glow = cairo_pattern_create_radial(
        w * 0.5, h * 0.4, 0,
        w * 0.5, h * 0.4, w * 0.5
    );
    cairo_pattern_add_color_stop_rgba(glow, 0.0, 0.0, 0.15, 0.5, 0.08);
    cairo_pattern_add_color_stop_rgba(glow, 1.0, 0.0, 0.0,  0.0, 0.0);
    cairo_set_source(cr, glow);
    cairo_paint(cr);
    cairo_pattern_destroy(glow);

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

    GtkWidget *drawing = gtk_drawing_area_new();
    gtk_container_add(GTK_CONTAINER(desktop_window), drawing);
    g_signal_connect(drawing, "draw", G_CALLBACK(on_desktop_draw), NULL);

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

    /* NOVA logo */
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
    gtk_window_set_title(GTK_WINDOW(panel_window), "NOVA Panel");
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

    /* Apple/NOVA button */
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

    /* WiFi icon */
    GtkWidget *wifi_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(wifi_label),
        "<span foreground='#c0c0c0'>\xF0\x9F\x93\xB6</span>");
    gtk_box_pack_start(GTK_BOX(right_box), wifi_label, FALSE, FALSE, 0);

    /* Battery */
    battery_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(battery_label),
        "<span foreground='#c0c0c0'>\xF0\x9F\x94\x8B 100%</span>");
    gtk_box_pack_start(GTK_BOX(right_box), battery_label, FALSE, FALSE, 0);

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

    /* Set panel to be fully opaque and on top */
    GdkRGBA panel_bg = { COLOR_PANEL_R, COLOR_PANEL_G, COLOR_PANEL_B, 0.92 };
    gtk_widget_override_background_color(panel_window, GTK_STATE_FLAG_NORMAL, &panel_bg);

    gtk_widget_show_all(panel_window);
}

/* ═══════════════════════════════════════════════
 * Dock — Bottom of Screen
 * ═══════════════════════════════════════════════ */

static void on_dock_icon_clicked(GtkWidget *widget, gpointer data)
{
    NovaApp *app = (NovaApp *)data;

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
    gtk_window_set_title(GTK_WINDOW(dock_window), "NOVA Dock");
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
    int pinned_count = 0;
    for (int i = 0; app_registry[i].id != NULL; i++) {
        if (!app_registry[i].pinned) continue;
        pinned_count++;

        GtkWidget *icon_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

        GtkWidget *btn = gtk_button_new();
        GtkWidget *icon_label = gtk_label_new(app_registry[i].icon);
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_size_new(28 * PANGO_SCALE));
        gtk_label_set_attributes(GTK_LABEL(icon_label), attrs);
        pango_attr_list_unref(attrs);
        gtk_container_add(GTK_CONTAINER(btn), icon_label);
        gtk_button_set_relief(GTK_BUTTON(btn), GTK_RELIEF_NONE);

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

        gtk_box_pack_start(GTK_BOX(dock_box), icon_box, FALSE, FALSE, 0);
    }

    /* Calculate dock size */
    int dock_width = pinned_count * (DOCK_ICON_SIZE + 16) + 32;
    int dock_x = (screen_width - dock_width) / 2;
    int dock_y = screen_height - DOCK_HEIGHT - 8;

    gtk_window_set_default_size(GTK_WINDOW(dock_window), dock_width, DOCK_HEIGHT);
    gtk_window_move(GTK_WINDOW(dock_window), dock_x, dock_y);

    /* Transparent background (the dock_box has its own bg via CSS) */
    gtk_widget_set_app_paintable(dock_window, TRUE);
    GdkScreen *screen = gtk_widget_get_screen(dock_window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(screen);
    if (visual) {
        gtk_widget_set_visual(dock_window, visual);
    }

    gtk_widget_show_all(dock_window);
}

static void update_dock(void)
{
    /* TODO: Update running indicator dots */
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
    gtk_window_set_title(GTK_WINDOW(launcher_window), "NOVA Spotlight");
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

    /* Transparent bg */
    GdkScreen *screen = gtk_widget_get_screen(launcher_window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(screen);
    if (visual) {
        gtk_widget_set_visual(launcher_window, visual);
    }
    gtk_widget_set_app_paintable(launcher_window, TRUE);

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_margin_start(vbox, 8);
    gtk_widget_set_margin_end(vbox, 8);
    gtk_widget_set_margin_top(vbox, 8);
    gtk_widget_set_margin_bottom(vbox, 8);
    gtk_container_add(GTK_CONTAINER(launcher_window), vbox);

    /* Search entry */
    launcher_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(launcher_entry), "Search or ask NOVA AI...");
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

static gboolean on_window_titlebar_press(GtkWidget *widget, GdkEventButton *event, gpointer data)
{
    NovaWindow *nwin = (NovaWindow *)data;
    if (event->type == GDK_2BUTTON_PRESS) {
        nova_maximize_window(nwin);
        return TRUE;
    }
    if (event->button == 1) {
        gtk_window_begin_move_drag(GTK_WINDOW(nwin->window),
            event->button, event->x_root, event->y_root, event->time);
        return TRUE;
    }
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
            "window.__NOVA_NATIVE__ = true;"
            "window.__NOVA_RENDERER__ = 'nova-shell';"
            "document.documentElement.classList.add('nova-native');",
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

    /* Default window size and position */
    nwin->w = 800;
    nwin->h = 560;
    nwin->x = 100 + (window_count % 5) * 40;
    nwin->y = 60 + (window_count % 5) * 30;

    /* Create the window */
    nwin->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(nwin->window), app->name);
    gtk_window_set_default_size(GTK_WINDOW(nwin->window), nwin->w, nwin->h);
    gtk_window_move(GTK_WINDOW(nwin->window), nwin->x, nwin->y);
    gtk_window_set_decorated(GTK_WINDOW(nwin->window), FALSE);  /* We draw our own titlebar */

    /* Transparent bg for rounded corners */
    GdkScreen *screen = gtk_widget_get_screen(nwin->window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(screen);
    if (visual) {
        gtk_widget_set_visual(nwin->window, visual);
    }

    /* Main vertical layout */
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(nwin->window), vbox);

    /* ─── Custom titlebar ─── */
    GtkWidget *titlebar = gtk_event_box_new();
    GtkStyleContext *tb_ctx = gtk_widget_get_style_context(titlebar);
    gtk_style_context_add_class(tb_ctx, "nova-window-titlebar");
    g_signal_connect(titlebar, "button-press-event",
        G_CALLBACK(on_window_titlebar_press), nwin);

    GtkWidget *tb_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_margin_start(tb_box, 8);
    gtk_widget_set_margin_end(tb_box, 8);
    gtk_container_add(GTK_CONTAINER(titlebar), tb_box);

    /* Traffic light buttons */
    GtkWidget *btn_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
    gtk_widget_set_valign(btn_box, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(tb_box), btn_box, FALSE, FALSE, 0);

    GtkWidget *close_btn = gtk_button_new();
    gtk_widget_set_size_request(close_btn, 12, 12);
    GtkStyleContext *close_ctx = gtk_widget_get_style_context(close_btn);
    gtk_style_context_add_class(close_ctx, "nova-window-btn");
    gtk_style_context_add_class(close_ctx, "nova-window-close");
    gtk_button_set_relief(GTK_BUTTON(close_btn), GTK_RELIEF_NONE);
    g_signal_connect(close_btn, "clicked", G_CALLBACK(on_window_close_clicked), nwin);
    gtk_box_pack_start(GTK_BOX(btn_box), close_btn, FALSE, FALSE, 0);

    GtkWidget *min_btn = gtk_button_new();
    gtk_widget_set_size_request(min_btn, 12, 12);
    GtkStyleContext *min_ctx = gtk_widget_get_style_context(min_btn);
    gtk_style_context_add_class(min_ctx, "nova-window-btn");
    gtk_style_context_add_class(min_ctx, "nova-window-minimize");
    gtk_button_set_relief(GTK_BUTTON(min_btn), GTK_RELIEF_NONE);
    g_signal_connect(min_btn, "clicked", G_CALLBACK(on_window_minimize_clicked), nwin);
    gtk_box_pack_start(GTK_BOX(btn_box), min_btn, FALSE, FALSE, 0);

    GtkWidget *max_btn = gtk_button_new();
    gtk_widget_set_size_request(max_btn, 12, 12);
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
        "NOVA-OS/1.0 (Native; Linux x86_64) NovaRenderer/1.0");

    nwin->webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_settings(ws));

    /* Transparent webview background */
    GdkRGBA trans = {0, 0, 0, 0};
    webkit_web_view_set_background_color(nwin->webview, &trans);

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

    /* Inject NOVA native mode flag after load */
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

    GdkRGBA notif_bg = {0.12, 0.12, 0.18, 0.95};
    gtk_widget_override_background_color(notif_win, GTK_STATE_FLAG_NORMAL, &notif_bg);

    gtk_widget_show_all(notif_win);

    /* Auto-dismiss after 4 seconds */
    g_timeout_add(4000, (GSourceFunc)gtk_widget_destroy, notif_win);
}

/* ═══════════════════════════════════════════════
 * Global Keyboard Shortcuts
 * ═══════════════════════════════════════════════ */

static GdkFilterReturn global_key_filter(GdkXEvent *xevent, GdkEvent *event, gpointer data)
{
    /* This is a placeholder — global keybinds would need X11 grabbing */
    return GDK_FILTER_CONTINUE;
}

/* Watch for Ctrl+Space globally (via timeout polling) */
static gboolean check_keys(gpointer data)
{
    /* Global shortcuts are handled by each window's key-press handler */
    return TRUE;
}

/* ═══════════════════════════════════════════════
 * Initialization
 * ═══════════════════════════════════════════════ */

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
