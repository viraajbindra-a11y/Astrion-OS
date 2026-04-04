/**
 * NOVA OS Kernel — Core Types
 * All basic types used throughout the kernel.
 */

#ifndef NOVA_TYPES_H
#define NOVA_TYPES_H

typedef unsigned char      uint8_t;
typedef unsigned short     uint16_t;
typedef unsigned int       uint32_t;
typedef unsigned long long uint64_t;

typedef signed char        int8_t;
typedef signed short       int16_t;
typedef signed int         int32_t;
typedef signed long long   int64_t;

typedef uint64_t size_t;
typedef int64_t  ssize_t;
typedef uint64_t uintptr_t;

typedef _Bool bool;
#define true  1
#define false 0

#define NULL ((void *)0)

// Color type (BGRA 32-bit)
typedef struct {
    uint8_t b, g, r, a;
} Color;

// Rectangle
typedef struct {
    int32_t x, y;
    uint32_t width, height;
} Rect;

// Point
typedef struct {
    int32_t x, y;
} Point;

// Common colors
#define COLOR_BLACK    (Color){0, 0, 0, 255}
#define COLOR_WHITE    (Color){255, 255, 255, 255}
#define COLOR_RED      (Color){0, 0, 255, 255}
#define COLOR_GREEN    (Color){0, 255, 0, 255}
#define COLOR_BLUE     (Color){255, 0, 0, 255}
#define COLOR_ACCENT   (Color){255, 122, 0, 255}    // #007AFF in BGRA
#define COLOR_BG       (Color){30, 30, 30, 255}      // Dark background
#define COLOR_BG2      (Color){45, 45, 45, 255}      // Secondary bg
#define COLOR_BG3      (Color){58, 58, 58, 255}      // Tertiary bg
#define COLOR_TEXT     (Color){255, 255, 255, 255}
#define COLOR_TEXT2    (Color){170, 170, 170, 255}    // Secondary text
#define COLOR_TEXT3    (Color){102, 102, 102, 255}    // Tertiary text
#define COLOR_TITLEBAR (Color){45, 45, 45, 255}
#define COLOR_DOCK     (Color){40, 40, 40, 200}
#define COLOR_MENUBAR  (Color){30, 30, 30, 180}

// Min/max helpers
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define CLAMP(val, lo, hi) (MAX(lo, MIN(hi, val)))

#endif
