/*
 * Astrion v2.0 - Snake game
 *
 * Classic Snake: arrow keys steer, food grows you, walls + self-collide
 * end the game. Renders directly to the framebuffer in 32-px cells.
 * Game logic ticks every ~150ms, driven by the PIT.
 *
 * Mouse cursor is hidden while the game runs (we just stop calling
 * mouse_redraw_if_dirty; the cursor's last-drawn pixels get overpainted
 * by the game's full-screen fill and stay gone until the shell repaint
 * after exit).
 */

#include <stdint.h>
#include "snake.h"
#include "kbd.h"
#include "pit.h"
#include "fb_font.h"
#include "task.h"

extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern int      fb_present_x(void);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);

#define CELL        32
#define COL_BG      0x0F1947u   /* deeper navy */
#define COL_GRID    0x1E2761u
#define COL_BORDER  0xFF7A00u   /* Astrion orange */
#define COL_BODY    0x4ADE80u   /* green snake body */
#define COL_HEAD    0xFFFFFFu
#define COL_FOOD    0xFF7A00u
#define COL_TEXT    0xFFFFFFu
#define COL_MUTED   0xCADCFCu

#define DIR_UP    0
#define DIR_RIGHT 1
#define DIR_DOWN  2
#define DIR_LEFT  3

#define MAX_LEN 1024

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

/* Simple LCG, seeded fresh each game from PIT ticks. */
static uint64_t rng;
static uint32_t lcg(void) {
    rng = rng * 6364136223846793005ULL + 1442695040888963407ULL;
    return (uint32_t)(rng >> 32);
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

static void draw_cell(int gx, int gy, uint32_t color) {
    int px = grid_x0 + gx * CELL;
    int py = grid_y0 + gy * CELL;
    fb_rect_x(px + 2, py + 2, CELL - 4, CELL - 4, color);
}

static void clear_cell(int gx, int gy) {
    int px = grid_x0 + gx * CELL;
    int py = grid_y0 + gy * CELL;
    fb_rect_x(px, py, CELL, CELL, COL_BG);
}

static void draw_full(void) {
    /* Background. */
    fb_rect_x(0, 0, fb_width_x(), fb_height_x(), COL_BG);

    /* Title at top. */
    fb_puts_x(grid_x0, 30, "ASTRION SNAKE", COL_BORDER, 4);
    fb_puts_x(grid_x0, 100, "arrows steer  -  ESC quits", COL_MUTED, 2);

    /* Live score on the right. */
    fb_puts_x(grid_x0 + grid_cols * CELL - 280, 30, "SCORE", COL_BORDER, 4);

    /* Border around play area. */
    int gw = grid_cols * CELL;
    int gh = grid_rows * CELL;
    fb_rect_x(grid_x0 - 4, grid_y0 - 4, gw + 8, 4, COL_BORDER);
    fb_rect_x(grid_x0 - 4, grid_y0 + gh, gw + 8, 4, COL_BORDER);
    fb_rect_x(grid_x0 - 4, grid_y0 - 4, 4, gh + 8, COL_BORDER);
    fb_rect_x(grid_x0 + gw, grid_y0 - 4, 4, gh + 8, COL_BORDER);

    /* Snake. */
    for (int i = 0; i < length; i++) {
        int idx = (head_idx - i + MAX_LEN) % MAX_LEN;
        uint32_t c = (i == 0) ? COL_HEAD : COL_BODY;
        draw_cell(snake[idx].x, snake[idx].y, c);
    }
    draw_cell(food.x, food.y, COL_FOOD);
}

static void draw_score(void) {
    /* Just the number - blank then redraw. */
    fb_rect_x(grid_x0 + grid_cols * CELL - 280, 100, 280, 60, COL_BG);
    fb_put_u32_x(grid_x0 + grid_cols * CELL - 280, 100, (uint32_t)score, COL_FOOD, 6);
}

static void start_game(void) {
    int sw = (int)fb_width_x();
    int sh = (int)fb_height_x();
    /* Title bar 0..180, then grid. Footer 60 px reserve. */
    grid_cols = (sw - 80) / CELL;
    grid_rows = (sh - 180 - 60) / CELL;
    if (grid_cols > 36) grid_cols = 36;
    if (grid_rows > 18) grid_rows = 18;
    grid_x0 = (sw - grid_cols * CELL) / 2;
    grid_y0 = 180;

    /* Initial snake: 3 segments horizontally, head facing right. */
    int cx = grid_cols / 2, cy = grid_rows / 2;
    length = 3;
    head_idx = 2;
    snake[0].x = cx - 2; snake[0].y = cy;
    snake[1].x = cx - 1; snake[1].y = cy;
    snake[2].x = cx;     snake[2].y = cy;
    dir = DIR_RIGHT;
    next_dir = DIR_RIGHT;
    score = 0;
    dead = 0;

    rng ^= pit_ticks() * 0x9E3779B97F4A7C15ULL;
    rng += 0x9E3779B97F4A7C15ULL;
    place_food();

    draw_full();
    draw_score();
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
        snake[new_head].x = nx;
        snake[new_head].y = ny;
        head_idx = new_head;
        if (length < MAX_LEN) length++;
        score += 10;
        draw_cell(nx, ny, COL_HEAD);
        /* Repaint the old head as body. */
        int prev = (head_idx - 1 + MAX_LEN) % MAX_LEN;
        draw_cell(snake[prev].x, snake[prev].y, COL_BODY);
        place_food();
        draw_cell(food.x, food.y, COL_FOOD);
        draw_score();
    } else {
        /* Move: erase tail, advance head. */
        int tail = (head_idx - length + 1 + MAX_LEN) % MAX_LEN;
        clear_cell(snake[tail].x, snake[tail].y);
        int new_head = (head_idx + 1) % MAX_LEN;
        snake[new_head].x = nx;
        snake[new_head].y = ny;
        /* Repaint previous head as body. */
        draw_cell(snake[head_idx].x, snake[head_idx].y, COL_BODY);
        head_idx = new_head;
        draw_cell(nx, ny, COL_HEAD);
    }
}

static void draw_game_over(void) {
    int sw = (int)fb_width_x();
    int sh = (int)fb_height_x();
    int bw = 700, bh = 220;
    int bx = (sw - bw) / 2;
    int by = (sh - bh) / 2;
    fb_rect_x(bx, by, bw, bh, 0x000000u);
    fb_rect_x(bx, by, bw, 6, COL_BORDER);
    fb_rect_x(bx, by + bh - 6, bw, 6, COL_BORDER);
    fb_rect_x(bx, by, 6, bh, COL_BORDER);
    fb_rect_x(bx + bw - 6, by, 6, bh, COL_BORDER);

    fb_puts_x(bx + 40, by + 30, "GAME OVER", COL_BORDER, 6);
    fb_puts_x(bx + 40, by + 110, "final score:", COL_MUTED, 2);
    fb_put_u32_x(bx + 280, by + 110, (uint32_t)score, COL_HEAD, 3);
    fb_puts_x(bx + 40, by + 170, "press any key to exit", COL_MUTED, 2);
}

int snake_play(void) {
    start_game();

    uint64_t last_tick_ms = pit_elapsed_ms();
    uint64_t tick_period_ms = 150;

    for (;;) {
        /* Drain keyboard. */
        while (kbd_available()) {
            char c = kbd_getchar();
            if (handle_key(c)) return score;
            if (dead) return score;  /* any key after death */
        }

        if (dead) {
            draw_game_over();
            /* Block until any key - still yielding so background
             * tasks (the clock!) keep running over the corpse. */
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

        /* Cooperative slice for the clock + any spawned tasks. The
         * visible effect: the corner clock keeps ticking mid-game. */
        task_yield();
        __asm__ volatile("sti; hlt");
    }
}
