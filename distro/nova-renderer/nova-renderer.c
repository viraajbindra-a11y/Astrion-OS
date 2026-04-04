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
#define NOVA_TITLE       "NOVA OS"
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
            "console.log('[NOVA Renderer] Native mode active');";
        webkit_web_view_run_javascript(view, js, NULL, NULL, NULL);
    }
}

/* Handle web process crash — auto-reload */
static void on_web_process_crashed(WebKitWebView *view, gpointer data)
{
    g_warning("[NOVA Renderer] Web process crashed, reloading...");
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
            g_print("NOVA OS Renderer v" NOVA_VERSION "\n");
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

    /* ─── Create the window ─── */
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), NOVA_TITLE);
    gtk_window_set_default_size(GTK_WINDOW(window), 1920, 1080);

    /* Remove ALL window decorations — no title bar, no borders */
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);

    /* Skip taskbar and pager — this IS the desktop, not an app */
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);

    /* Set window type to desktop level */
    gtk_window_set_type_hint(GTK_WINDOW(window), GDK_WINDOW_TYPE_HINT_DESKTOP);

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
        "NOVA-OS/1.0 (Native; Linux x86_64) NovaRenderer/1.0");

    /* Developer mode */
    webkit_settings_set_enable_developer_extras(settings, dev_mode);

    /* Disable browser-like things */
    webkit_settings_set_enable_back_forward_navigation_gestures(settings, FALSE);

    /* ─── Create WebView ─── */
    webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_settings(settings));

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
    g_print("[NOVA Renderer] Starting NOVA OS...\n");
    g_print("[NOVA Renderer] Loading: %s\n", url);
    if (dev_mode) {
        g_print("[NOVA Renderer] Developer mode enabled (Ctrl+Shift+I)\n");
    }

    webkit_web_view_load_uri(webview, url);

    /* ─── Run the main loop ─── */
    gtk_main();

    g_print("[NOVA Renderer] Shutdown complete.\n");
    return 0;
}
