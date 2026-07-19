/*
 * Astrion v2.0 — calculator engine (see calc.h).
 *
 * Freestanding: integer-only, no libc, no floats anywhere.
 *
 * ─── The numbers ───
 * A value is an int64 scaled by SCALE = 1,000,000, i.e. six decimal places.
 * Every value the machine stores obeys ONE invariant:
 *
 *      |v| <= LIMIT   (LIMIT = 1e15, so |real value| <= 1,000,000,000)
 *
 * Digit entry enforces it, and every operation checks it on the way out. A
 * billion with six decimals is more range than a desk calculator needs, and
 * picking a ceiling this far below INT64_MAX (9.22e18) is what lets every
 * intermediate below be shown not to overflow with a one-line argument instead
 * of a 128-bit type we'd have to borrow from libgcc.
 *
 * Overflow is reported, never wrapped. Divide by zero is reported, never
 * executed. Both come back as an error the window shows in words.
 *
 * ─── The state machine ───
 * Two levels, so * and / bind tighter than + and - and the expression on screen
 * means what it says: 2 + 3 * 4 is 14, not 20.
 *
 *      acc   addop   term   mulop   entry
 *      \_____ _____/  \______ _____/
 *            v               v
 *      the running sum   the running product
 *
 * A completed operand folds into `term` through `mulop`; a +/- press folds
 * `term` into `acc` through `addop`. `=` folds everything.
 */
#include <stdint.h>
#include "calc.h"

#define SCALE   1000000LL              /* six decimal places                */
#define DECS    6
#define LIMIT   1000000000000000LL     /* == 1e9 * SCALE — the value ceiling */

/* Error codes. 0 is "no error" so `if (err)` reads correctly. */
enum { E_OK = 0, E_DIV0, E_RANGE };

/* ─── Machine state ─── */
static int64_t acc, term, entry;
static int     have_acc, have_term, entering;
static char    addop, mulop;           /* 0 = none, else '+' '-' '*' '/' */
static int     entry_neg;              /* sign of the number being typed  */
static int     entry_point;            /* a '.' has been typed            */
static int     entry_decs;             /* digits accepted after the '.'   */
static int     err;

/* The completed expression, captured at '=' so the line above the result reads
 * back what was evaluated instead of just repeating the answer. */
static char shown[96];
static int  show_done;

/* ─── Operator swap ───
 * Pressing a second operator with no operand between them should CHANGE the
 * operator, not apply it: "5 + *" is 5 *, exactly as it reads. The first press
 * has already folded, so the only honest way to change it is to put the machine
 * back the way it was and apply the new one. This is that rollback point.
 *
 * `entry` is deliberately NOT part of it: an operator press never touches the
 * typed number (only the next digit clears it), so it is already correct after
 * a restore. */
static int64_t s_acc, s_term;
static int     s_have_acc, s_have_term, s_entering;
static char    s_addop, s_mulop;
static int     have_snap;

static void snap_save(void) {
    s_acc = acc; s_term = term;
    s_have_acc = have_acc; s_have_term = have_term; s_entering = entering;
    s_addop = addop; s_mulop = mulop;
    have_snap = 1;
}
static void snap_load(void) {
    acc = s_acc; term = s_term;
    have_acc = s_have_acc; have_term = s_have_term; entering = s_entering;
    addop = s_addop; mulop = s_mulop;
}

void calc_reset(void) {
    acc = 0; term = 0; entry = 0;
    have_acc = 0; have_term = 0; entering = 0;
    addop = 0; mulop = 0;
    entry_neg = 0; entry_point = 0; entry_decs = 0;
    err = E_OK;
    shown[0] = 0; show_done = 0;
    have_snap = 0;
}

/* ─── Checked arithmetic ───
 * Each returns E_OK and writes *out, or an error and leaves *out alone. Inputs
 * are gated on the invariant first, so |a| and |b| are known <= LIMIT inside —
 * which is what makes -a safe (LIMIT is nowhere near INT64_MIN) and what every
 * bound below is stated against. */
static int in_range(int64_t v) { return v >= -LIMIT && v <= LIMIT; }
static int64_t mag(int64_t v)  { return v < 0 ? -v : v; }

static int c_add(int64_t a, int64_t b, int64_t *out) {
    if (!in_range(a) || !in_range(b)) return E_RANGE;
    int64_t r = a + b;                      /* |r| <= 2e15: cannot wrap */
    if (!in_range(r)) return E_RANGE;
    *out = r; return E_OK;
}

static int c_sub(int64_t a, int64_t b, int64_t *out) {
    if (!in_range(a) || !in_range(b)) return E_RANGE;
    int64_t r = a - b;                      /* |r| <= 2e15: cannot wrap */
    if (!in_range(r)) return E_RANGE;
    *out = r; return E_OK;
}

/* a * b / SCALE, without ever forming a*b (which would be up to 1e30).
 * Split b into its whole and fractional halves and add three bounded terms:
 *
 *   t1 = A * Bi                     Bi <= 1e9 ; guarded to <= LIMIT
 *   t2 = (A / SCALE) * Bf           <= 1e9 * 1e6      = 1e15
 *   t3 = ((A % SCALE) * Bf) / SCALE < (1e6 * 1e6)/1e6 = 1e6
 *
 * so the sum is under 3e15 and cannot wrap; the range check then decides
 * whether the ANSWER is representable. t3 is where the one rounding lives:
 * the product is truncated toward zero, as a fixed-point multiply is. */
static int c_mul(int64_t a, int64_t b, int64_t *out) {
    if (!in_range(a) || !in_range(b)) return E_RANGE;
    int neg = (a < 0) != (b < 0);
    int64_t A = mag(a), B = mag(b);
    int64_t Bi = B / SCALE, Bf = B % SCALE;

    int64_t t1 = 0;
    if (Bi) {
        if (A > LIMIT / Bi) return E_RANGE;   /* checked BEFORE multiplying */
        t1 = A * Bi;
    }
    int64_t t2 = (A / SCALE) * Bf;
    int64_t t3 = ((A % SCALE) * Bf) / SCALE;
    int64_t r  = t1 + t2 + t3;
    if (r > LIMIT) return E_RANGE;
    *out = neg ? -r : r; return E_OK;
}

/* a * SCALE / b, again without forming a*SCALE. Take the whole quotient first,
 * then walk the remainder out one decimal digit at a time:
 *
 *   q  = A / B      guarded so q * SCALE <= LIMIT
 *   r0 = A % B      < B <= 1e15, so r0 * 10 < 1e16 — never near the ceiling,
 *                   and r0 is reduced back below B on every pass
 *
 * Six passes give exactly DECS digits. Exact, in int64, with no 128-bit type
 * and no libgcc helper. Truncates toward zero, matching c_mul. */
static int c_div(int64_t a, int64_t b, int64_t *out) {
    if (!in_range(a) || !in_range(b)) return E_RANGE;
    if (b == 0) return E_DIV0;
    int neg = (a < 0) != (b < 0);
    int64_t A = mag(a), B = mag(b);

    int64_t q = A / B, r0 = A % B;
    if (q > LIMIT / SCALE) return E_RANGE;
    int64_t whole = q * SCALE;

    int64_t frac = 0;
    for (int i = 0; i < DECS; i++) {
        r0 *= 10;
        frac = frac * 10 + (r0 / B);
        r0 %= B;
    }
    int64_t r = whole + frac;               /* <= 1e15 + 999999: cannot wrap */
    if (r > LIMIT) return E_RANGE;
    *out = neg ? -r : r; return E_OK;
}

static int apply_op(int64_t a, char op, int64_t b, int64_t *out) {
    switch (op) {
        case '+': return c_add(a, b, out);
        case '-': return c_sub(a, b, out);
        case '*': return c_mul(a, b, out);
        case '/': return c_div(a, b, out);
        default:  *out = b; return E_OK;
    }
}

/* ─── Formatting ─── */

/* Fixed-point -> text. Trailing zeros are trimmed, so 2.5 reads "2.5" and not
 * "2.500000"; a whole number carries no point at all. Needs 24 bytes: sign +
 * 10 whole digits + '.' + 6 decimals. */
static void fmt(int64_t v, char *b, int cap) {
    if (cap < 2) { if (cap > 0) b[0] = 0; return; }
    int k = 0, neg = v < 0;
    /* Negate through unsigned so INT64_MIN could not bite even if the range
     * invariant were ever broken above us. */
    uint64_t m = neg ? (uint64_t)(-(v + 1)) + 1u : (uint64_t)v;
    uint64_t whole = m / (uint64_t)SCALE;
    uint64_t frac  = m % (uint64_t)SCALE;

    char t[24]; int n = 0;
    if (!whole) t[n++] = '0';
    else while (whole && n < (int)sizeof(t)) { t[n++] = (char)('0' + (int)(whole % 10)); whole /= 10; }

    if (neg && k < cap - 1) b[k++] = '-';
    while (n > 0 && k < cap - 1) b[k++] = t[--n];

    if (frac) {
        char f[DECS];
        for (int i = DECS - 1; i >= 0; i--) { f[i] = (char)('0' + (int)(frac % 10)); frac /= 10; }
        int last = DECS - 1;
        while (last >= 0 && f[last] == '0') last--;
        if (last >= 0 && k < cap - 1) b[k++] = '.';
        for (int i = 0; i <= last && k < cap - 1; i++) b[k++] = f[i];
    }
    b[k] = 0;
}

static int app_str(char *d, int at, int cap, const char *s) {
    if (cap <= 0) return 0;
    if (at < 0) at = 0;
    while (*s && at < cap - 1) d[at++] = *s++;
    d[at] = 0;
    return at;
}
static int app_num(char *d, int at, int cap, int64_t v) {
    char b[24]; fmt(v, b, (int)sizeof(b));
    return app_str(d, at, cap, b);
}
static int app_op(char *d, int at, int cap, char op) {
    char s[4] = { ' ', op, ' ', 0 };
    return app_str(d, at, cap, s);
}

/* ─── Operands ─── */

static int64_t entry_value(void) { return entry_neg ? -entry : entry; }

/* The number the next operator will act on: what you are typing, or failing
 * that whatever the display is currently showing. */
static int64_t operand(void) {
    if (entering)  return entry_value();
    if (have_term) return term;
    if (have_acc)  return acc;
    return 0;
}

/* The number on the big line. Same rule as operand() — they are the same thing
 * by construction, which is why what you see is what gets used. */
static int64_t display_value(void) { return operand(); }

static void fail(int e) {
    calc_reset();
    err = e;
}

/* Fold one finished operand into the term through any pending * or /. */
static int push_operand(int64_t v) {
    if (mulop) {
        int64_t r;
        int e = apply_op(term, mulop, v, &r);
        if (e) return e;
        term = r; mulop = 0;
    } else {
        term = v;
    }
    have_term = 1;
    return E_OK;
}

/* Fold the term into the accumulator through any pending + or -. */
static int push_term(void) {
    if (have_acc && addop) {
        int64_t r;
        int e = apply_op(acc, addop, term, &r);
        if (e) return e;
        acc = r;
    } else {
        acc = term;
    }
    have_acc = 1; have_term = 0; term = 0; addop = 0;
    return E_OK;
}

/* ─── Presses ─── */

static void press_digit(int d) {
    if (!entering) {
        entry = 0; entry_neg = 0; entry_point = 0; entry_decs = 0;
        entering = 1;
    }
    if (!entry_point) {
        /* entry = entry*10 + d*SCALE, refused if it would break the ceiling.
         * Written as a subtraction so nothing is ever added past the cap first —
         * d*SCALE is at most 9e6, so the right-hand side stays positive. */
        int64_t add = (int64_t)d * SCALE;
        if (entry > (LIMIT - add) / 10) return;      /* full: ignore the key */
        entry = entry * 10 + add;
    } else {
        if (entry_decs >= DECS) return;              /* out of decimals      */
        int64_t place = SCALE;
        for (int i = 0; i <= entry_decs; i++) place /= 10;   /* 1e5, 1e4, ... */
        int64_t add = (int64_t)d * place;
        if (add > LIMIT - entry) return;
        entry += add;
        entry_decs++;
    }
}

static void press_dot(void) {
    if (!entering) {
        entry = 0; entry_neg = 0; entry_decs = 0;
        entering = 1;
    }
    entry_point = 1;
}

static void press_sign(void) {
    if (entering) { entry_neg = !entry_neg; return; }
    /* Not typing: take what's on the display and start typing its negation, so
     * +/- is useful straight after a result as well as mid-entry. */
    int64_t v = display_value();
    entry = mag(v);
    entry_neg = v >= 0;                  /* flip whatever it was */
    entering = 1;
    have_snap = 0;

    /* Adopting a value mid-stream means adopting its decimals too. Without
     * this, +/- on 2.5 would leave the machine believing it was typing a whole
     * number, and the next digit would land in the integer column. */
    entry_point = 0; entry_decs = 0;
    int64_t f = entry % SCALE;
    if (f) {
        entry_point = 1;
        entry_decs = DECS;
        while (entry_decs > 0 && (f % 10) == 0) { f /= 10; entry_decs--; }
    }
}

static void press_back(void) {
    if (!entering) return;               /* nothing being typed: nothing to rub out */
    if (entry_decs > 0) {
        int64_t place = SCALE;
        for (int i = 0; i < entry_decs; i++) place /= 10;
        entry -= ((entry / place) % 10) * place;
        entry_decs--;
        return;
    }
    if (entry_point) { entry_point = 0; return; }
    entry = (entry / SCALE / 10) * SCALE;
}

static void press_op(char op) {
    int is_mul = (op == '*' || op == '/');

    /* Second operator in a row: roll back and apply this one instead. */
    if (!entering && have_snap) snap_load();

    snap_save();

    int e = push_operand(operand());
    if (e) { fail(e); return; }

    if (is_mul) {
        mulop = op;
    } else {
        e = push_term();
        if (e) { fail(e); return; }
        addop = op;
    }
    entering = 0;
}

static void press_eq(void) {
    /* Capture the expression as text BEFORE folding — afterwards the operands
     * are gone. */
    int k = 0;
    shown[0] = 0;
    if (have_acc && addop) { k = app_num(shown, k, (int)sizeof(shown), acc); k = app_op(shown, k, (int)sizeof(shown), addop); }
    if (have_term && mulop) { k = app_num(shown, k, (int)sizeof(shown), term); k = app_op(shown, k, (int)sizeof(shown), mulop); }
    k = app_num(shown, k, (int)sizeof(shown), operand());
    k = app_str(shown, k, (int)sizeof(shown), " =");

    int e = push_operand(operand());
    if (e) { fail(e); return; }
    e = push_term();
    if (e) { fail(e); return; }

    /* Land on the result: acc holds it, nothing is pending, and the next digit
     * starts a fresh number while the next operator chains off the answer. */
    mulop = 0; addop = 0; entering = 0; have_snap = 0;
    show_done = 1;
}

void calc_press(int btn) {
    if (btn < 0 || btn >= CB_COUNT) return;

    /* An error owns the display until you press something. That press then
     * lands on a clean machine rather than on wreckage. */
    if (err) { calc_reset(); }

    if (btn != CB_EQ) show_done = 0;
    if (btn >= CB_0 && btn <= CB_9) { press_digit(btn - CB_0); have_snap = 0; return; }

    switch (btn) {
        case CB_DOT:   press_dot();  have_snap = 0; break;
        case CB_ADD:   press_op('+'); break;
        case CB_SUB:   press_op('-'); break;
        case CB_MUL:   press_op('*'); break;
        case CB_DIV:   press_op('/'); break;
        case CB_EQ:    press_eq();   break;
        case CB_CLEAR: calc_reset(); break;
        case CB_BACK:  press_back(); have_snap = 0; break;
        case CB_SIGN:  press_sign(); break;
        default: break;
    }
}

int calc_key_to_btn(char c) {
    if (c >= '0' && c <= '9') return CB_0 + (c - '0');
    switch (c) {
        case '.': return CB_DOT;
        case '+': return CB_ADD;
        case '-': return CB_SUB;
        case '*': case 'x': case 'X': return CB_MUL;
        case '/': return CB_DIV;
        case '=': case '\n': return CB_EQ;
        case 'c': case 'C': return CB_CLEAR;
        case '\b': return CB_BACK;
        case 'n': case 'N': return CB_SIGN;
        default: return CB_NONE;
    }
}

/* ─── Read-out ─── */

void calc_expr(char *buf, int cap) {
    if (cap <= 0) return;
    buf[0] = 0;
    if (show_done) { app_str(buf, 0, cap, shown); return; }
    int k = 0;
    if (have_acc && addop)  { k = app_num(buf, k, cap, acc);  k = app_op(buf, k, cap, addop); }
    if (have_term && mulop) { k = app_num(buf, k, cap, term); k = app_op(buf, k, cap, mulop); }
    (void)k;
}

void calc_value(char *buf, int cap) {
    if (cap <= 0) return;
    buf[0] = 0;
    if (err == E_DIV0)  { app_str(buf, 0, cap, "Cannot divide by zero"); return; }
    if (err == E_RANGE) { app_str(buf, 0, cap, "Number out of range");   return; }
    fmt(display_value(), buf, cap);
}

int calc_is_error(void) { return err != E_OK; }
