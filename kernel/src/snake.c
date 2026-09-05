/*
 * Astrion v2.0 - Snake
 *
 * Classic Snake: arrow keys steer, food grows you, walls + self-collide end
 * the game. Game logic ticks every ~150ms, driven by the PIT.
 *
 * ─── Why this is full-screen, and why that is now a MODE rather than an escape
 *
 * It used to be the one screen in Astrion that did not look like Astrion. It
 * took the whole framebuffer, painted its own navy (0x0F1947 - not the
 * wallpaper, not the chrome, not a window body), set its type in the retired
 * 8x8 bitmap font blown up to 4x, and centred PRESS AN ARROW TO BEGIN in a way
 * nothing else in the OS does. Opening it genuinely read as though the machine
 * had rebooted into something else.
 *
 * The fix is NOT to put it in a window. Two reasons, both from the code:
 *
 *   1. snake_play() is a blocking call that owns task 0 for its entire run.
 *      Every windowed app in wm.c is a draw_content()/key() pair driven by the
 *      window manager's event loop. Windowing this means rewriting it as a
 *      tick/draw/key trio, adding it to the app enum, the slot/icon/title
 *      tables, giving it a savebuf, and giving it a mon_can_live_paint()-style
 *      guard so a live board never paints over a window stacked on top of it.
 *      That is a large change landing squarely in the savebuf/stale-pixel area
 *      this kernel has been bitten by three times.
 *   2. It would make the game worse. The board is 36x18 cells of 32px. A
 *      standard app window is 860x520, which fits about 24x13 - so either the
 *      board shrinks or the cells do.
 *
 * A game asking for the whole screen is legitimate. The problem was never
 * fullscreen; it was that fullscreen did not look like this operating system.
 * So the board now wears Astrion's chrome:
 *
 *   - the desktop's own wallpaper gradient behind everything, straight from
 *     desktop_wallpaper_band() (the user's Settings choice, not a colour this
 *     file invented),
 *   - a real Astrion top bar at the real TOPBAR_H, painted by the SAME
 *     desktop_draw_bar_lead() the desktop uses, so the mark does not move by a
 *     pixel when you enter or leave the game,
 *   - the play field as a lit window body: AC_TERM_BG, WIN_R corners, a real
 *     drop shadow and a hairline border - the same three calls every window
 *     gets,
 *   - antialiased Inter and JetBrains Mono (af.c) for every glyph, like every
 *     other app. That also retires the slashed-zero bug the old draw_score()
 *     comment documented at length: it was fb_font's '0' at 6x, and it is gone
 *     because fb_font is gone.
 *
 * NO DOCK, deliberately. Painting the dock under a game that blocks task 0
 * would put eight icons on screen that cannot be clicked, and chrome you
 * cannot use is a worse lie than chrome that is absent. The way out is named
 * in words in the footer instead.
 *
 * The mouse cursor is lifted once at the start (mouse_invalidate_rect over the
 * whole screen, announce-before-you-paint) and nothing redraws it while we
 * hold task 0, so it stays gone for the run.
 */

#include <stdint.h>
#include "snake.h"
#include "kbd.h"
#include "pit.h"
#include "task.h"
#include "af.h"
#include "desktop.h"
#include "mouse.h"

extern int      fb_present_x(void);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

#define CELL        32

/* ─── Palette ───
 *
 * Every colour here is either one of desktop.h's surfaces or a hue the product
 * already owns. Nothing is invented locally any more; that was the root of the
 * whole problem.
 *
 * COL_FIELD is the window body. The board is meant to read as one of this OS's
 * lit surfaces sitting on the wallpaper - the same relationship a window has -
 * which is why it gets the body colour, the body corner and the body shadow.
 *
 * COL_BODY is systemGreen, which is EXACTLY the Snake dock tile's colour
 * (see g_icons[] in desktop.c). The app and the icon you clicked to get here
 * are now the same green. It was 0x4ADE80, a green from nowhere in particular.
 *
 * COL_FOOD keeps the one rule this file already had and got right: warm means
 * points. The food and the score total are the only warm things on the board,
 * so your eye lands on the target with no competition. It stays systemOrange,
 * a hue the product owns (it is the Editor's dock tile).
 *
 * COL_GRID is gone. It was defined and never used - dead paint. */
#define COL_FIELD   AC_TERM_BG
#define COL_BODY    0x30D158u   /* systemGreen - the Snake dock tile exactly */
#define COL_HEAD    AC_WHITE
#define COL_FOOD    0xFF9F0Au   /* systemOrange - warm means points */

#define DIR_UP    0
#define DIR_RIGHT 1
#define DIR_DOWN  2
#define DIR_LEFT  3

#define MAX_LEN 1024

/* ─── Layout ───
 *
 * SNK_PAD is the field's inner margin: the gap between the rounded body edge
 * and the first cell. It must exceed WIN_R or a corner cell would paint over
 * the antialiased corner arc, leaving a square notch in a rounded panel.
 *
 * SNK_MARGIN is the minimum wallpaper visible left and right of the field, so
 * the board reads as a panel ON the desktop rather than a screen that failed
 * to fill. Same instinct as desktop.c's DESK_GAP. */
#define SNK_PAD     12u
#define SNK_MARGIN  48u
#define SNK_GAP     16u   /* field bottom -> footer line */

/* Score block on the bar: a FIXED clear band anchored to the right edge, for
 * the reason desktop_draw_clock() spells out - a number that gets NARROWER (a
 * new game resets 120 to 0) would otherwise start its clear too far right to
 * cover the wider string already there, leaving the head of the old score
 * behind. 170 clears "SCORE" plus six mono digits with room to spare. */
#define SNK_SCORE_R   20u
#define SNK_SCORE_W  170u
#define SNK_SCORE_GAP 10u   /* label -> number */

/* One baseline for everything in the bar, matching the desktop's: the clock is
 * drawn at top y=12 in AF_SB16 (ascent 16), so the baseline is 28 and each
 * face drops to meet it. Two faces at the same TOP sit on two lines. */
#define BAR_BASE    28u

typedef struct { int16_t x, y; } cell_t;

static cell_t snake[MAX_LEN];
static int    head_idx;     /* index of head in snake[] */
static int    length;
static int    dir;
static int    next_dir;
static int    grid_cols, grid_rows;
static int    grid_x0, grid_y0;
static cell_t food;
static int    score;
static int    dead;
static int    started;      /* 0 = READY, waiting for the player's first key */
static uint32_t SW, SH;     /* screen, read once per game */
static uint32_t foot_y;     /* top of the one-line footer */

/* Simple LCG, seeded fresh each game from PIT ticks. */
static uint64_t rng;
static uint32_t lcg(void) {
    rng = rng * 6364136223846793005ULL + 1442695040888963407ULL;
    return (uint32_t)(rng >> 32);
}

/* Decimal, u32 only: a 32-bit divide is a native instruction, where a 64-bit
 * one would pull in libgcc's __divdi3. b[] needs 11 bytes. */
static int u32_str(uint32_t v, char *b) {
    char t[12];
    int n = 0;
    do { t[n++] = (char)('0' + (v % 10u)); v /= 10u; } while (v);
    for (int i = 0; i < n; i++) b[i] = t[n - 1 - i];
    b[n] = 0;
    return n;
}

static int snake_contains(int x, int y) {
    for (int i = 0; i < length; i++) {
        int idx = (head_idx - i + MAX_LEN) % MAX_LEN;
        if (snake[idx].x == x && snake[idx].y == y) return 1;
    }
    return 0;
}

static void place_food(void) {
    /* Try random cells until we hit an empty one. */
    for (int attempts = 0; attempts < 200; attempts++) {
        int x = (int)(lcg() % grid_cols);
        int y = (int)(lcg() % grid_rows);
        if (!snake_contains(x, y)) { food.x = x; food.y = y; return; }
    }
    /* Fallback: linear scan. */
    for (int y = 0; y < grid_rows; y++) {
        for (int x = 0; x < grid_cols; x++) {
            if (!snake_contains(x, y)) { food.x = x; food.y = y; return; }
        }
    }
}

static void clear_cell(int gx, int gy) {
    fb_rect_x((uint32_t)(grid_x0 + gx * CELL), (uint32_t)(grid_y0 + gy * CELL),
              CELL, CELL, COL_FIELD);
}

/* One segment: a rounded square at the dock tile's proportion (~25%), so the
 * snake is made of the same shape language as everything else on this desktop.
 *
 * It CLEARS THE CELL FIRST, and that is load-bearing rather than tidy.
 * ac_fill_round antialiases its corners by reading back what is already on the
 * framebuffer, and tick_game() repaints the old head as a body segment without
 * erasing it - so without this the white head's corner pixels would survive
 * underneath the green and every segment would wear white fringes. Clearing
 * first makes draw_cell idempotent and order-independent, which is the only
 * safe property to have when there is no compositor. */
static void draw_cell(int gx, int gy, uint32_t color) {
    clear_cell(gx, gy);
    ac_fill_round((uint32_t)(grid_x0 + gx * CELL + 2),
                  (uint32_t)(grid_y0 + gy * CELL + 2),
                  CELL - 4, CELL - 4, 7, color);
}

/* Food is a disc, not a segment. The snake is squares and the target is round:
 * one glance tells you which is which, with no colour reasoning needed. */
static void draw_food(void) {
    clear_cell(food.x, food.y);
    ac_fill_disc(grid_x0 + food.x * CELL + CELL / 2,
                 grid_y0 + food.y * CELL + CELL / 2, 11, COL_FOOD);
}

/* The score, on the right of the bar where the desktop keeps its clock. Mono
 * digits (fixed advance, so they cannot jitter as the number grows) in the
 * food's own colour, with a small muted label - the same number/label pairing
 * the System Monitor uses, dropped to the shared bar baseline. */
static void draw_score(void) {
    char b[12];
    u32_str((uint32_t)score, b);
    uint32_t right = SW - SNK_SCORE_R;
    uint32_t bx    = right - SNK_SCORE_W;
    uint32_t lw    = af_text_width("SCORE", AF_REG13);
    uint32_t nw    = af_text_width(b, AF_MONO);
    uint32_t gw    = lw + SNK_SCORE_GAP + nw;

    mouse_invalidate_rect((int)bx, 6, (int)SNK_SCORE_W, (int)TOPBAR_H - 8);
    fb_rect_x(bx, 6, SNK_SCORE_W, TOPBAR_H - 8, AC_BAR);
    if (gw >= SNK_SCORE_W) return;   /* wrap-safe: never right - gw past the band */

    /* Label and number move together as ONE right-anchored group. Pinning the
     * label to the left of the band and the digits to the right of it put 160px
     * between the word and the number it names, and they stopped reading as a
     * pair. The group only slides when a digit is added. */
    uint32_t gx = right - gw;
    af_draw(gx, BAR_BASE - (uint32_t)af_ascent(AF_REG13), "SCORE", AC_MUTED, AF_REG13);
    af_draw(gx + lw + SNK_SCORE_GAP, BAR_BASE - (uint32_t)af_ascent(AF_MONO),
            b, COL_FOOD, AF_MONO);
}

/* The bar. desktop_draw_bar_lead() paints the ground, the mark, the wordmark
 * and the divider+label, exactly as it does for the desktop - so "Astrion v2.0
 * | Snake" here is the same pixels as "Astrion v2.0 | Terminal" there. That
 * single shared call is what makes fullscreen read as a mode of this OS. */
static void draw_bar(void) {
    desktop_draw_bar_lead("Snake");
    draw_score();
}

/* ─── The footer: one line, two states, always the way out ───
 *
 * Before the game starts it is the invitation, winking. Once it is running it
 * is the steady hint. One line either way, because two would mean the footer
 * moves, and it names where Esc GOES rather than just saying "quits" - the
 * complaint that started all of this was that there was no obvious way back.
 *
 * It always erases its own band first, and it erases it with the WALLPAPER,
 * not with a flat colour: the backdrop there is a gradient, and a flat fill
 * would leave a visible bar of the wrong blue across the bottom of the screen.
 * desktop_wallpaper_band() paints the exact rows the desktop would have. */
#define READY_MSG  "Press an arrow to begin"
#define PLAY_MSG   "Arrows steer      Esc returns to the desktop"

static void draw_footer(int lit) {
    uint32_t lh = (uint32_t)af_line_height(AF_REG16);
    desktop_wallpaper_band(foot_y, lh);
    if (!started) {
        if (lit) af_draw_center(SW / 2, foot_y, READY_MSG, AC_TEAL, AF_REG16);
    } else {
        af_draw_center(SW / 2, foot_y, PLAY_MSG, AC_MUTED, AF_REG16);
    }
}

/* Is the READY wink currently lit? 256ms per beat, three lit then one dark.
 * Shift + mask only - no 64-bit division, so no libgcc call. */
static int ready_lit(void) {
    return (int)(((pit_elapsed_ms() >> 8) & 3u) != 3u);
}

/* The head breathes on the same beat as the text. Two cues, one pulse: the
 * words say "press an arrow", the head says "and this is the thing that will
 * move". Both colours are already on the board - the wink borrows the body
 * green, it does not introduce anything new. */
static void draw_ready_head(int lit) {
    draw_cell(snake[head_idx].x, snake[head_idx].y, lit ? COL_HEAD : COL_BODY);
}

/* The whole screen, from the wallpaper up. */
static void draw_full(void) {
    /* ANNOUNCE BEFORE YOU PAINT (mouse.h). The cursor is holding a cache of
     * the dock pixels you just clicked; lifting it here means that cache is
     * spent while it is still true, and nothing of ours is on the framebuffer
     * when the fill below runs. Skipping this leaves the cursor's cache lying
     * about a screen that no longer exists, and the mouse_lift() inside the
     * wm's repaint after we exit would stamp a patch of Snake's board back
     * down. */
    mouse_invalidate_rect(0, 0, (int)SW, (int)SH);

    desktop_wallpaper_band(0, SH);
    draw_bar();

    /* The play field as a window body: shadow, rounded fill, hairline border -
     * the same three calls, in the same order, that desktop_draw_window_frame
     * makes. Order matters and is not negotiable: ac_shadow multiplies what it
     * finds, so it must run on the bare wallpaper and exactly once. */
    uint32_t fx = (uint32_t)grid_x0 - SNK_PAD;
    uint32_t fy = (uint32_t)grid_y0 - SNK_PAD;
    uint32_t fw = (uint32_t)(grid_cols * CELL) + 2 * SNK_PAD;
    uint32_t fh = (uint32_t)(grid_rows * CELL) + 2 * SNK_PAD;
    ac_shadow(fx, fy, fw, fh, WIN_R, 20);
    ac_fill_round(fx, fy, fw, fh, WIN_R, COL_FIELD);
    ac_stroke_round(fx, fy, fw, fh, WIN_R, AC_BORDER);

    for (int i = 0; i < length; i++) {
        int idx = (head_idx - i + MAX_LEN) % MAX_LEN;
        draw_cell(snake[idx].x, snake[idx].y, (i == 0) ? COL_HEAD : COL_BODY);
    }
    draw_food();
    draw_footer(1);
}

static void start_game(void) {
    SW = fb_width_x();
    SH = fb_height_x();

    /* Everything below the bar's hairline belongs to the game. */
    uint32_t top   = TOPBAR_H + 1;
    uint32_t avail = (SH > top) ? SH - top : 0;
    uint32_t lh    = (uint32_t)af_line_height(AF_REG16);
    /* What the field may occupy: the region below the bar, less the footer
     * line, its gap, and one field pad top and bottom. Written as a subtract
     * with a guard rather than an addition compared against avail - a mode
     * small enough to make this negative must give 0 rows, not a huge one. */
    uint32_t chrome = lh + SNK_GAP + 2 * SNK_PAD;
    uint32_t fieldh = (avail > chrome) ? avail - chrome : 0;

    grid_cols = (SW > 2 * SNK_MARGIN) ? (int)((SW - 2 * SNK_MARGIN) / CELL) : 0;
    grid_rows = (int)(fieldh / CELL);
    if (grid_cols > 36) grid_cols = 36;
    if (grid_rows > 18) grid_rows = 18;
    if (grid_cols < 8)  grid_cols = 8;    /* an unplayable board is still a board */
    if (grid_rows < 6)  grid_rows = 6;

    /* Centre the field-plus-footer as ONE block in the space below the bar, so
     * the margin above the field and below the hint are the same. Centring the
     * field alone would leave the hint hugging the bottom edge. */
    uint32_t bh = (uint32_t)(grid_rows * CELL) + 2 * SNK_PAD + SNK_GAP + lh;
    uint32_t by = top + ((avail > bh) ? (avail - bh) / 2 : 0);

    grid_x0 = (int)((SW - (uint32_t)(grid_cols * CELL)) / 2);
    grid_y0 = (int)(by + SNK_PAD);
    foot_y  = (uint32_t)grid_y0 + (uint32_t)(grid_rows * CELL) + SNK_PAD + SNK_GAP;

    /* Initial snake: 3 segments horizontally, head facing right. */
    int cx = grid_cols / 2, cy = grid_rows / 2;
    length = 3;
    head_idx = 2;
    snake[0].x = (int16_t)(cx - 2); snake[0].y = (int16_t)cy;
    snake[1].x = (int16_t)(cx - 1); snake[1].y = (int16_t)cy;
    snake[2].x = (int16_t)cx;       snake[2].y = (int16_t)cy;
    dir = DIR_RIGHT;
    next_dir = DIR_RIGHT;
    score = 0;
    dead = 0;
    started = 0;    /* nothing moves until the player asks it to */

    rng ^= pit_ticks() * 0x9E3779B97F4A7C15ULL;
    rng += 0x9E3779B97F4A7C15ULL;
    place_food();

    draw_full();
}

static int handle_key(char c) {
    /* Returns 1 if game should exit (ESC). */
    if (c == 0x1B) return 1;
    if (c == KEY_UP    && dir != DIR_DOWN)  next_dir = DIR_UP;
    if (c == KEY_DOWN  && dir != DIR_UP)    next_dir = DIR_DOWN;
    if (c == KEY_LEFT  && dir != DIR_RIGHT) next_dir = DIR_LEFT;
    if (c == KEY_RIGHT && dir != DIR_LEFT)  next_dir = DIR_RIGHT;
    return 0;
}

/* Which keys wake a READY board. Arrows are what we advertise and what a
 * player will reach for, but space and enter are accepted too: someone who taps
 * those and gets nothing back would reasonably conclude the game is broken, and
 * no keypress should ever land on silence. */
static int is_start_key(char c) {
    return c == KEY_UP || c == KEY_DOWN || c == KEY_LEFT || c == KEY_RIGHT ||
           c == ' '    || c == '\n'     || c == '\r';
}

static void tick_game(void) {
    if (dead) return;
    dir = next_dir;
    cell_t head = snake[head_idx];
    int nx = head.x, ny = head.y;
    switch (dir) {
        case DIR_UP:    ny--; break;
        case DIR_DOWN:  ny++; break;
        case DIR_LEFT:  nx--; break;
        case DIR_RIGHT: nx++; break;
    }
    /* Wall collision. */
    if (nx < 0 || ny < 0 || nx >= grid_cols || ny >= grid_rows) {
        dead = 1;
        return;
    }
    /* Self collision (skip the tail because it'll move). */
    for (int i = 0; i < length - 1; i++) {
        int idx = (head_idx - i + MAX_LEN) % MAX_LEN;
        if (snake[idx].x == nx && snake[idx].y == ny) { dead = 1; return; }
    }

    int ate = (nx == food.x && ny == food.y);

    if (ate) {
        /* Grow: extend length, new head goes at next slot. */
        int new_head = (head_idx + 1) % MAX_LEN;
        snake[new_head].x = (int16_t)nx;
        snake[new_head].y = (int16_t)ny;
        head_idx = new_head;
        if (length < MAX_LEN) length++;
        score += 10;
        draw_cell(nx, ny, COL_HEAD);
        /* Repaint the old head as body. */
        int prev = (head_idx - 1 + MAX_LEN) % MAX_LEN;
        draw_cell(snake[prev].x, snake[prev].y, COL_BODY);
        place_food();
        draw_food();
        draw_score();
    } else {
        /* Move: erase tail, advance head. */
        int tail = (head_idx - length + 1 + MAX_LEN) % MAX_LEN;
        clear_cell(snake[tail].x, snake[tail].y);
        int new_head = (head_idx + 1) % MAX_LEN;
        snake[new_head].x = (int16_t)nx;
        snake[new_head].y = (int16_t)ny;
        /* Repaint previous head as body. */
        draw_cell(snake[head_idx].x, snake[head_idx].y, COL_BODY);
        head_idx = new_head;
        draw_cell(nx, ny, COL_HEAD);
    }
}

/* The end card, in the power dialog's exact vocabulary: a real shadow, a
 * rounded AC_PANEL body, a hairline border, radius 14. Astrion has one way of
 * saying "here is a thing to read and then dismiss", and this is it - it used
 * to be a black box with a 6px teal keyline, which is a shape from no OS. */
static void draw_game_over(void) {
    uint32_t bw = 380, bh = 190;
    uint32_t bx = (SW - bw) / 2;
    uint32_t by = (SH - bh) / 2;

    mouse_invalidate_rect((int)bx - 30, (int)by - 30, (int)bw + 60, (int)bh + 60);
    ac_shadow(bx, by, bw, bh, 14, 26);
    ac_fill_round(bx, by, bw, bh, 14, AC_PANEL);
    ac_stroke_round(bx, by, bw, bh, 14, AC_BORDER);

    char b[12];
    u32_str((uint32_t)score, b);
    af_draw_center(bx + bw / 2, by + 30, "Game over", AC_WHITE, AF_SB30);

    /* Score label and number share a baseline, the Monitor's pairing again. */
    uint32_t ny = by + 92;
    uint32_t lw = af_text_width("Final score", AF_REG16);
    uint32_t nw = af_text_width(b, AF_MONO);
    uint32_t gx = bx + (bw - (lw + 12 + nw)) / 2;
    af_draw(gx, ny + (uint32_t)(af_ascent(AF_MONO) - af_ascent(AF_REG16)),
            "Final score", AC_MUTED, AF_REG16);
    af_draw(gx + lw + 12, ny, b, COL_FOOD, AF_MONO);

    af_draw_center(bx + bw / 2, by + bh - 42, "Press any key to return to the desktop",
                   AC_MUTED, AF_REG13);
}

/* Why the board waits instead of counting down.
 *
 * It used to start moving the instant the window opened, which meant you had
 * about two seconds to find the arrow keys before the snake put itself into the
 * right-hand wall. Anyone who clicked the icon to see what it was got a GAME
 * OVER box and a score of zero as their first impression.
 *
 * A countdown or a fixed grace period was the obvious fix and it is the wrong
 * one: both are still a window that closes on its own. Somebody opening this to
 * show it off talks for an unknowable number of seconds, and any fixed number
 * we picked would eventually be too short. Waiting for the player is the only
 * version that is never too short.
 *
 * The press that starts the game is also the first steer - handle_key() has
 * already turned it into next_dir - so no input is spent on ceremony and the
 * control scheme teaches itself on the very first keystroke.
 */
int snake_play(void) {
    if (!fb_present_x()) return 0;
    start_game();

    uint64_t last_tick_ms = pit_elapsed_ms();
    uint64_t tick_period_ms = 150;
    int shown_lit = -1;             /* -1 forces the first prompt paint */

    for (;;) {
        /* Drain keyboard. */
        while (kbd_available()) {
            char c = kbd_getchar();
            if (handle_key(c)) return score;
            if (dead) return score;  /* any key after death */
            if (!started && is_start_key(c)) {
                /* handle_key() above already set next_dir, and already
                 * refused a reversal - so an impatient LEFT here starts
                 * the run heading right rather than doing nothing. */
                started = 1;
                draw_footer(1);         /* invitation out, steady hint in */
                draw_ready_head(1);     /* head back to solid white */
                last_tick_ms = pit_elapsed_ms();
                tick_game();            /* move on the same keypress */
            }
        }

        if (!started) {
            /* Waiting for the player. Wink the invitation and the head on
             * one shared beat so a motionless board still reads as alive. */
            int lit = ready_lit();
            if (lit != shown_lit) {
                shown_lit = lit;
                draw_footer(lit);
                draw_ready_head(lit);
            }
            task_yield();
            __asm__ volatile("sti; hlt");
            continue;
        }

        if (dead) {
            draw_game_over();
            /* Block until any key - still yielding so background
             * tasks keep running over the corpse. */
            for (;;) {
                task_yield();
                __asm__ volatile("sti; hlt");
                if (kbd_available()) {
                    (void)kbd_getchar();
                    return score;
                }
            }
        }

        uint64_t now = pit_elapsed_ms();
        if (now - last_tick_ms >= tick_period_ms) {
            last_tick_ms = now;
            tick_game();
        }

        /* Cooperative slice for any spawned tasks. The clock task deliberately
         * does NOT paint while we are up (desktop_set_exclusive), because it
         * would be stamping a band over a screen it does not own - that bug put
         * a black box across the score, and snake_clock_test.py is the
         * tripwire that keeps it fixed. */
        task_yield();
        __asm__ volatile("sti; hlt");
    }
}
