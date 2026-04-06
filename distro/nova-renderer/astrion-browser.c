/*
 * Astrion Browser — Custom lightweight browser for Astrion OS
 *
 * Fast WebKitGTK browser with:
 * - Dark theme matching Astrion OS
 * - URL bar, back/forward/reload
 * - Tab-free single window (clean)
 * - No bloat — just a WebView + controls
 *
 * Usage: astrion-browser [URL]
 * Build: gcc -o astrion-browser astrion-browser.c $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.0)
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <string.h>

static GtkWidget *url_entry = NULL;
static WebKitWebView *webview = NULL;
static GtkWidget *back_btn, *fwd_btn;
static GtkWidget *status_label = NULL;

/* ── URL bar submit ── */
static void on_url_activate(GtkEntry *entry, gpointer data)
{
    const gchar *text = gtk_entry_get_text(entry);
    if (!text || !*text) return;

    gchar *url;
    if (g_str_has_prefix(text, "http://") || g_str_has_prefix(text, "https://")) {
        url = g_strdup(text);
    } else if (strchr(text, '.') && !strchr(text, ' ')) {
        url = g_strdup_printf("https://%s", text);
    } else {
        url = g_strdup_printf("https://www.google.com/search?q=%s", text);
    }

    webkit_web_view_load_uri(webview, url);
    g_free(url);
}

/* ── Update URL bar when page navigates ── */
static void on_uri_changed(WebKitWebView *view, GParamSpec *pspec, gpointer data)
{
    const gchar *uri = webkit_web_view_get_uri(view);
    if (uri && url_entry) {
        gtk_entry_set_text(GTK_ENTRY(url_entry), uri);
    }
}

/* ── Update title ── */
static void on_title_changed(WebKitWebView *view, GParamSpec *pspec, gpointer data)
{
    GtkWidget *win = GTK_WIDGET(data);
    const gchar *title = webkit_web_view_get_title(view);
    if (title && *title) {
        gchar *full = g_strdup_printf("%s — Astrion", title);
        gtk_window_set_title(GTK_WINDOW(win), full);
        g_free(full);
    }
}

/* ── Update nav buttons ── */
static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data)
{
    gtk_widget_set_sensitive(back_btn, webkit_web_view_can_go_back(view));
    gtk_widget_set_sensitive(fwd_btn, webkit_web_view_can_go_forward(view));

    if (event == WEBKIT_LOAD_STARTED && status_label) {
        gtk_label_set_text(GTK_LABEL(status_label), "Loading...");
    } else if (event == WEBKIT_LOAD_FINISHED && status_label) {
        gtk_label_set_text(GTK_LABEL(status_label), "");
    }
}

/* ── Handle new window requests (open in same view) ── */
static GtkWidget* on_create(WebKitWebView *view, WebKitNavigationAction *action, gpointer data)
{
    WebKitURIRequest *req = webkit_navigation_action_get_request(action);
    webkit_web_view_load_request(view, req);
    return NULL;
}

/* ── Suppress default context menu ── */
static gboolean on_context_menu(WebKitWebView *v, WebKitContextMenu *m,
                                 GdkEvent *e, WebKitHitTestResult *h, gpointer d)
{
    return FALSE; /* Allow default context menu (it's a real browser) */
}

/* ── Keyboard shortcuts ── */
static gboolean on_key_press(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    gboolean ctrl = (event->state & GDK_CONTROL_MASK);

    if (ctrl && event->keyval == GDK_KEY_l) {
        gtk_widget_grab_focus(url_entry);
        gtk_editable_select_region(GTK_EDITABLE(url_entry), 0, -1);
        return TRUE;
    }
    if (ctrl && event->keyval == GDK_KEY_r) {
        webkit_web_view_reload(webview);
        return TRUE;
    }
    if (ctrl && event->keyval == GDK_KEY_w) {
        gtk_widget_destroy(widget);
        return TRUE;
    }
    if (event->keyval == GDK_KEY_F5) {
        webkit_web_view_reload(webview);
        return TRUE;
    }
    if (ctrl && event->keyval == GDK_KEY_plus) {
        double z = webkit_web_view_get_zoom_level(webview);
        webkit_web_view_set_zoom_level(webview, z + 0.1);
        return TRUE;
    }
    if (ctrl && event->keyval == GDK_KEY_minus) {
        double z = webkit_web_view_get_zoom_level(webview);
        webkit_web_view_set_zoom_level(webview, z - 0.1);
        return TRUE;
    }
    if (ctrl && event->keyval == GDK_KEY_0) {
        webkit_web_view_set_zoom_level(webview, 1.0);
        return TRUE;
    }
    return FALSE;
}

/* ── Apply dark CSS to GTK ── */
static void apply_dark_theme(void)
{
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css,
        "window, headerbar, toolbar, box {"
        "  background-color: #1a1a22;"
        "  color: #e0e0e0;"
        "}"
        "entry {"
        "  background-color: #2a2a34;"
        "  color: #ffffff;"
        "  border: 1px solid #3a3a44;"
        "  border-radius: 8px;"
        "  padding: 6px 12px;"
        "  font-size: 13px;"
        "}"
        "entry:focus {"
        "  border-color: #007aff;"
        "}"
        "button {"
        "  background: #2a2a34;"
        "  color: #e0e0e0;"
        "  border: 1px solid #3a3a44;"
        "  border-radius: 6px;"
        "  padding: 4px 8px;"
        "  min-width: 28px;"
        "  min-height: 28px;"
        "}"
        "button:hover {"
        "  background: #3a3a48;"
        "}"
        "label {"
        "  color: rgba(255,255,255,0.5);"
        "  font-size: 11px;"
        "}"
        , -1, NULL);

    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(css),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
}

int main(int argc, char *argv[])
{
    const char *initial_url = "https://www.google.com";
    if (argc > 1 && argv[1][0] != '-') {
        initial_url = argv[1];
    }

    gtk_init(&argc, &argv);
    apply_dark_theme();

    /* ─── Window ─── */
    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "Astrion Browser");
    gtk_window_set_default_size(GTK_WINDOW(window), 1200, 800);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
    g_signal_connect(window, "key-press-event", G_CALLBACK(on_key_press), NULL);

    /* ─── Layout ─── */
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(window), vbox);

    /* ─── Toolbar ─── */
    GtkWidget *toolbar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
    gtk_widget_set_margin_start(toolbar, 8);
    gtk_widget_set_margin_end(toolbar, 8);
    gtk_widget_set_margin_top(toolbar, 6);
    gtk_widget_set_margin_bottom(toolbar, 6);

    back_btn = gtk_button_new_with_label("\u25C0");
    fwd_btn = gtk_button_new_with_label("\u25B6");
    GtkWidget *reload_btn = gtk_button_new_with_label("\u21BB");
    GtkWidget *home_btn = gtk_button_new_with_label("\u2302");

    gtk_widget_set_sensitive(back_btn, FALSE);
    gtk_widget_set_sensitive(fwd_btn, FALSE);

    g_signal_connect_swapped(back_btn, "clicked", G_CALLBACK(webkit_web_view_go_back), NULL);
    g_signal_connect_swapped(fwd_btn, "clicked", G_CALLBACK(webkit_web_view_go_forward), NULL);
    g_signal_connect_swapped(reload_btn, "clicked", G_CALLBACK(webkit_web_view_reload), NULL);
    g_signal_connect_swapped(home_btn, "clicked",
        G_CALLBACK(webkit_web_view_load_uri), NULL);

    url_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(url_entry), initial_url);
    gtk_entry_set_placeholder_text(GTK_ENTRY(url_entry), "Search or enter URL...");
    g_signal_connect(url_entry, "activate", G_CALLBACK(on_url_activate), NULL);

    gtk_box_pack_start(GTK_BOX(toolbar), back_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(toolbar), fwd_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(toolbar), reload_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(toolbar), url_entry, TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(toolbar), home_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(vbox), toolbar, FALSE, FALSE, 0);

    /* ─── Status bar ─── */
    status_label = gtk_label_new("");
    gtk_label_set_xalign(GTK_LABEL(status_label), 0);
    gtk_widget_set_margin_start(status_label, 12);
    gtk_widget_set_margin_bottom(status_label, 2);

    /* ─── WebView ─── */
    WebKitSettings *settings = webkit_settings_new();
    webkit_settings_set_enable_javascript(settings, TRUE);
    webkit_settings_set_enable_html5_database(settings, TRUE);
    webkit_settings_set_enable_html5_local_storage(settings, TRUE);
    webkit_settings_set_enable_smooth_scrolling(settings, TRUE);
    webkit_settings_set_enable_webgl(settings, TRUE);
    webkit_settings_set_enable_media_stream(settings, TRUE);
    webkit_settings_set_enable_webaudio(settings, TRUE);
    webkit_settings_set_enable_developer_extras(settings, TRUE);
    webkit_settings_set_javascript_can_access_clipboard(settings, TRUE);
    webkit_settings_set_hardware_acceleration_policy(settings,
        WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
    webkit_settings_set_user_agent(settings,
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "AstrionBrowser/1.0 Safari/537.36");

    /* Persistent data (cookies, localStorage) */
    const gchar *home = g_get_home_dir();
    gchar *data_dir = g_build_filename(home, ".local", "share", "astrion-browser", NULL);
    gchar *cache_dir = g_build_filename(home, ".cache", "astrion-browser", NULL);
    g_mkdir_with_parents(data_dir, 0755);
    g_mkdir_with_parents(cache_dir, 0755);

    WebKitWebsiteDataManager *dm = webkit_website_data_manager_new(
        "base-data-directory", data_dir,
        "base-cache-directory", cache_dir,
        NULL);
    WebKitWebContext *ctx = webkit_web_context_new_with_website_data_manager(dm);

    /* Enable cookie persistence */
    WebKitCookieManager *cookies = webkit_web_context_get_cookie_manager(ctx);
    gchar *cookie_file = g_build_filename(data_dir, "cookies.sqlite", NULL);
    webkit_cookie_manager_set_persistent_storage(cookies, cookie_file,
        WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);
    g_free(cookie_file);

    g_free(data_dir);
    g_free(cache_dir);

    webview = WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW,
        "settings", settings,
        "web-context", ctx,
        NULL));

    /* Connect swapped signals now that webview exists */
    g_signal_connect_swapped(back_btn, "clicked", G_CALLBACK(webkit_web_view_go_back), webview);
    g_signal_connect_swapped(fwd_btn, "clicked", G_CALLBACK(webkit_web_view_go_forward), webview);
    g_signal_connect_swapped(reload_btn, "clicked", G_CALLBACK(webkit_web_view_reload), webview);

    g_signal_connect(webview, "notify::uri", G_CALLBACK(on_uri_changed), NULL);
    g_signal_connect(webview, "notify::title", G_CALLBACK(on_title_changed), window);
    g_signal_connect(webview, "load-changed", G_CALLBACK(on_load_changed), NULL);
    g_signal_connect(webview, "create", G_CALLBACK(on_create), NULL);

    gtk_box_pack_start(GTK_BOX(vbox), GTK_WIDGET(webview), TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(vbox), status_label, FALSE, FALSE, 0);

    /* ─── HiDPI zoom (read from config) ─── */
    gchar *zoom_path = g_build_filename(home, ".config", "nova-renderer", "zoom", NULL);
    FILE *zf = fopen(zoom_path, "r");
    if (zf) {
        char buf[32];
        if (fgets(buf, sizeof(buf), zf)) {
            double z = atof(buf);
            if (z > 0) webkit_web_view_set_zoom_level(webview, z);
        }
        fclose(zf);
    }
    g_free(zoom_path);

    /* ─── Load initial URL ─── */
    webkit_web_view_load_uri(webview, initial_url);

    gtk_widget_show_all(window);
    gtk_main();

    return 0;
}
