/*
 * NOVA OS — Native Renderer
 *
 * This is NOVA OS's own rendering engine. It uses WebKitGTK under the hood
 * to render HTML/CSS/JS — but it's NOT a browser. There's no URL bar, no tabs,
 * no back button, no bookmarks. It's a native application that renders the
 * NOVA OS desktop, the same way Windows uses its own renderer for its UI.
 *
 * In process lists, this shows up as "nova-renderer", not "chromium" or "firefox".
 *
 * Build: gcc -o nova-renderer nova-renderer.c $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.0)
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>

#define NOVA_DEFAULT_URL "http://localhost:3000"
#define NOVA_TITLE       "Astrion OS"
#define NOVA_VERSION     "1.0"

static GtkWidget *window = NULL;
static WebKitWebView *webview = NULL;
static gboolean is_fullscreen = TRUE;

/* ─── Disable all browser-like behavior ─── */

/* Block context menu (right-click menu) — NOVA has its own */
static gboolean on_context_menu(WebKitWebView *view,
                                 WebKitContextMenu *menu,
                                 GdkEvent *event,
                                 WebKitHitTestResult *hit,
                                 gpointer data)
{
    return TRUE; /* Suppress default context menu */
}

/* Block new window creation — everything stays inside NOVA */
static GtkWidget* on_create(WebKitWebView *view,
                             WebKitNavigationAction *action,
                             gpointer data)
{
    /* Load the URL in the same view instead of opening a new window */
    WebKitURIRequest *request = webkit_navigation_action_get_request(action);
    webkit_web_view_load_request(view, request);
    return NULL;
}

/* Handle keyboard shortcuts */
static gboolean on_key_press(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    /* F11 — toggle fullscreen */
    if (event->keyval == GDK_KEY_F11) {
        if (is_fullscreen) {
            gtk_window_unfullscreen(GTK_WINDOW(window));
            is_fullscreen = FALSE;
        } else {
            gtk_window_fullscreen(GTK_WINDOW(window));
            is_fullscreen = TRUE;
        }
        return TRUE;
    }

    /* Ctrl+Shift+I — open web inspector (dev mode only) */
    if ((event->state & GDK_CONTROL_MASK) && (event->state & GDK_SHIFT_MASK) &&
        event->keyval == GDK_KEY_I)
    {
        WebKitSettings *settings = webkit_web_view_get_settings(webview);
        if (webkit_settings_get_enable_developer_extras(settings)) {
            WebKitWebInspector *inspector = webkit_web_view_get_inspector(webview);
            webkit_web_inspector_show(inspector);
        }
        return TRUE;
    }

    /* Ctrl+R — reload (for development) */
    if ((event->state & GDK_CONTROL_MASK) && event->keyval == GDK_KEY_r) {
        webkit_web_view_reload(webview);
        return TRUE;
    }

    return FALSE; /* Let all other keys pass through to the web content */
}

/* Handle window state changes */
static gboolean on_window_state(GtkWidget *widget, GdkEventWindowState *event, gpointer data)
{
    is_fullscreen = (event->new_window_state & GDK_WINDOW_STATE_FULLSCREEN) != 0;
    return FALSE;
}

/* When the webview is ready, inject NOVA OS environment info */
static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data)
{
    if (event == WEBKIT_LOAD_FINISHED) {
        /* Tell NOVA OS it's running in native mode */
        const gchar *js =
            "window.__NOVA_NATIVE__ = true;"
            "window.__NOVA_VERSION__ = '" NOVA_VERSION "';"
            "window.__NOVA_RENDERER__ = 'nova-renderer';"
            "document.documentElement.classList.add('nova-native');"
            "console.log('[Astrion Renderer] Native mode active');";
        webkit_web_view_run_javascript(view, js, NULL, NULL, NULL);
    }
}

/* Handle web process crash — auto-reload */
static void on_web_process_crashed(WebKitWebView *view, gpointer data)
{
    g_warning("[Astrion Renderer] Web process crashed, reloading...");
    webkit_web_view_reload(view);
}

/* Clean shutdown */
static void on_destroy(GtkWidget *widget, gpointer data)
{
    gtk_main_quit();
}

/* Signal handler for clean exit */
static void signal_handler(int sig)
{
    gtk_main_quit();
}

int main(int argc, char *argv[])
{
    const char *url = NOVA_DEFAULT_URL;
    gboolean dev_mode = FALSE;
    gboolean windowed = FALSE;

    /* Parse command line arguments */
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--url") == 0 && i + 1 < argc) {
            url = argv[++i];
        } else if (strcmp(argv[i], "--dev") == 0) {
            dev_mode = TRUE;
        } else if (strcmp(argv[i], "--windowed") == 0) {
            windowed = TRUE;
        } else if (strcmp(argv[i], "--help") == 0) {
            g_print("Astrion OS Renderer v" NOVA_VERSION "\n");
            g_print("Usage: nova-renderer [OPTIONS]\n\n");
            g_print("Options:\n");
            g_print("  --url URL    Load a specific URL (default: %s)\n", NOVA_DEFAULT_URL);
            g_print("  --dev        Enable developer tools (Ctrl+Shift+I)\n");
            g_print("  --windowed   Start in windowed mode instead of fullscreen\n");
            g_print("  --help       Show this help\n");
            return 0;
        }
    }

    /* Set process name to "nova-renderer" */
    /* This is what shows in `ps`, `top`, `htop` — NOT "chromium" */
    if (argc > 0) {
        strncpy(argv[0], "nova-renderer", strlen(argv[0]));
    }

    /* Initialize GTK */
    gtk_init(&argc, &argv);

    /* Handle SIGINT/SIGTERM for clean shutdown */
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    /* ─── Get actual screen dimensions ─── */
    GdkScreen *screen = gdk_screen_get_default();
    int screen_w = gdk_screen_get_width(screen);
    int screen_h = gdk_screen_get_height(screen);
    g_print("[Astrion Renderer] Screen size: %dx%d\n", screen_w, screen_h);

    /* ─── Create the window ─── */
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), NOVA_TITLE);

    /* Set size to ACTUAL screen dimensions — not hardcoded 1920x1080.
     * gtk_window_fullscreen() requires a window manager to process the
     * _NET_WM_STATE_FULLSCREEN hint. We don't run a WM, so we manually
     * size + position the window to fill the screen. */
    gtk_window_set_default_size(GTK_WINDOW(window), screen_w, screen_h);
    gtk_window_move(GTK_WINDOW(window), 0, 0);
    gtk_window_resize(GTK_WINDOW(window), screen_w, screen_h);

    /* Remove ALL window decorations — no title bar, no borders */
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);

    /* Skip taskbar and pager — this IS the desktop, not an app */
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);

    /* Use NORMAL type hint */
    gtk_window_set_type_hint(GTK_WINDOW(window), GDK_WINDOW_TYPE_HINT_NORMAL);

    /* Make it black while loading */
    GdkRGBA bg_color = {0.04, 0.04, 0.10, 1.0};
    gtk_widget_override_background_color(window, GTK_STATE_FLAG_NORMAL, &bg_color);

    /* ─── Configure WebKit ─── */
    WebKitSettings *settings = webkit_settings_new();

    /* Enable modern web features NOVA OS needs */
    webkit_settings_set_enable_javascript(settings, TRUE);
    webkit_settings_set_javascript_can_access_clipboard(settings, TRUE);
    webkit_settings_set_enable_html5_database(settings, TRUE);
    webkit_settings_set_enable_html5_local_storage(settings, TRUE);
    webkit_settings_set_enable_offline_web_application_cache(settings, TRUE);
    webkit_settings_set_enable_smooth_scrolling(settings, TRUE);
    webkit_settings_set_enable_webgl(settings, TRUE);
    webkit_settings_set_enable_media_stream(settings, TRUE);
    webkit_settings_set_enable_mediasource(settings, TRUE);
    webkit_settings_set_enable_webaudio(settings, TRUE);
    webkit_settings_set_allow_file_access_from_file_urls(settings, TRUE);

    /* Hardware acceleration */
    webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);

    /* Set user agent to NOVA OS (not a browser) */
    webkit_settings_set_user_agent(settings,
        "Astrion-OS/1.0 (Native; Linux x86_64) NovaRenderer/1.0");

    /* Developer mode */
    webkit_settings_set_enable_developer_extras(settings, dev_mode);

    /* Disable browser-like things */
    webkit_settings_set_enable_back_forward_navigation_gestures(settings, FALSE);

    /* ─── Persistent WebsiteDataManager ─── */
    /* By default, WebKitGTK creates an ephemeral context where localStorage,
     * IndexedDB, and cookies are lost when the process exits. We need
     * persistent storage so the NOVA OS setup wizard, user preferences,
     * file system, and vault survive reboots. */
    const gchar *home = g_get_home_dir();
    gchar *data_dir = g_build_filename(home, ".local", "share", "nova-renderer", NULL);
    gchar *cache_dir = g_build_filename(home, ".cache", "nova-renderer", NULL);
    g_mkdir_with_parents(data_dir, 0755);
    g_mkdir_with_parents(cache_dir, 0755);

    WebKitWebsiteDataManager *data_manager = webkit_website_data_manager_new(
        "base-data-directory", data_dir,
        "base-cache-directory", cache_dir,
        NULL);

    WebKitWebContext *web_context = webkit_web_context_new_with_website_data_manager(data_manager);

    g_print("[Astrion Renderer] Data dir: %s\n", data_dir);
    g_free(data_dir);
    g_free(cache_dir);

    /* ─── Create WebView with persistent context ─── */
    webview = WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW,
        "settings", settings,
        "web-context", web_context,
        NULL));

    /* Make webview background transparent (NOVA OS handles its own bg) */
    GdkRGBA transparent = {0, 0, 0, 0};
    webkit_web_view_set_background_color(webview, &transparent);

    /* ─── Connect signals ─── */
    g_signal_connect(window, "destroy", G_CALLBACK(on_destroy), NULL);
    g_signal_connect(window, "key-press-event", G_CALLBACK(on_key_press), NULL);
    g_signal_connect(window, "window-state-event", G_CALLBACK(on_window_state), NULL);
    g_signal_connect(webview, "context-menu", G_CALLBACK(on_context_menu), NULL);
    g_signal_connect(webview, "create", G_CALLBACK(on_create), NULL);
    g_signal_connect(webview, "load-changed", G_CALLBACK(on_load_changed), NULL);
    g_signal_connect(webview, "web-process-crashed", G_CALLBACK(on_web_process_crashed), NULL);

    /* ─── Assemble and show ─── */
    gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(webview));
    gtk_widget_show_all(window);

    /* Go fullscreen unless --windowed */
    if (!windowed) {
        gtk_window_fullscreen(GTK_WINDOW(window));
        is_fullscreen = TRUE;
    }

    /* ─── Load NOVA OS ─── */
    g_print("[Astrion Renderer] Starting Astrion OS...\n");
    g_print("[Astrion Renderer] Loading: %s\n", url);
    if (dev_mode) {
        g_print("[Astrion Renderer] Developer mode enabled (Ctrl+Shift+I)\n");
    }

    webkit_web_view_load_uri(webview, url);

    /* ─── HiDPI scaling ─── */
    /* CSS zoom doesn't work in WebKitGTK, so we use the proper WebKit
     * zoom API. This is equivalent to Ctrl+Plus in a browser.
     * Priority: 1) config file 2) screen-size auto-detection */
    {
        double zoom = 0;

        /* 1) Check config file (~/.config/nova-renderer/zoom) */
        gchar *zoom_path = g_build_filename(g_get_home_dir(), ".config", "nova-renderer", "zoom", NULL);
        FILE *zf = fopen(zoom_path, "r");
        if (zf) {
            char buf[32];
            if (fgets(buf, sizeof(buf), zf)) {
                zoom = atof(buf);
                g_print("[Astrion Renderer] Zoom from config: %.2f\n", zoom);
            }
            fclose(zf);
        }
        g_free(zoom_path);

        /* 2) Auto-detect from screen size if no config */
        if (zoom <= 0) {
            if (screen_w >= 3600)       zoom = 1.6;
            else if (screen_w >= 2700)  zoom = 1.75;
            else if (screen_w >= 2400)  zoom = 1.5;
            else if (screen_w >= 2000)  zoom = 1.35;
            else if (screen_w >= 1800)  zoom = 1.2;
            else                        zoom = 1.0;
        }

        webkit_web_view_set_zoom_level(webview, zoom);
        g_print("[Astrion Renderer] Zoom: %.2f (screen: %dx%d)\n", zoom, screen_w, screen_h);
    }

    /* ─── Run the main loop ─── */
    gtk_main();

    g_print("[Astrion Renderer] Shutdown complete.\n");
    return 0;
}
