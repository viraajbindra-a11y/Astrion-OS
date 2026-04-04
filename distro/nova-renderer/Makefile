# NOVA OS — Native Desktop Shell & Renderer
# Compiles the NOVA OS native shell (C/GTK3/WebKitGTK)
#
# Dependencies (Debian/Ubuntu):
#   apt-get install -y libwebkit2gtk-4.0-dev libgtk-3-dev gcc pkg-config
#
# This builds two binaries:
#   nova-shell    — Full native desktop (panel, dock, window manager, app launcher)
#   nova-renderer — Lightweight fullscreen renderer (loads the web OS directly)
#
# Usage:
#   make              — build everything
#   make nova-shell   — build just the shell
#   make install      — install to /usr/bin/
#   make clean        — remove build artifacts

CC = gcc
CFLAGS = -O2 -Wall $(shell pkg-config --cflags gtk+-3.0 webkit2gtk-4.0) -lm
LDFLAGS = $(shell pkg-config --libs gtk+-3.0 webkit2gtk-4.0) -lm
PREFIX = /usr

all: nova-shell nova-renderer

nova-shell: nova-shell.c
	$(CC) $(CFLAGS) -o nova-shell nova-shell.c $(LDFLAGS)
	@echo "  Built: nova-shell (native desktop environment)"

nova-renderer: nova-renderer.c
	$(CC) $(CFLAGS) -o nova-renderer nova-renderer.c $(LDFLAGS)
	@echo "  Built: nova-renderer (fullscreen web renderer)"

install: all
	install -Dm755 nova-shell $(DESTDIR)$(PREFIX)/bin/nova-shell
	install -Dm755 nova-renderer $(DESTDIR)$(PREFIX)/bin/nova-renderer
	install -Dm755 nova-start.sh $(DESTDIR)$(PREFIX)/bin/nova-start
	@echo "  Installed: nova-shell, nova-renderer, nova-start"

clean:
	rm -f nova-shell nova-renderer

.PHONY: all install clean
