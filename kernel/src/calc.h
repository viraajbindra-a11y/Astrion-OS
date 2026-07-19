/*
 * Astrion v2.0 — calculator engine
 *
 * The arithmetic and the state machine only; wm.c owns the window and the
 * pixels. Every press — typed on the keyboard or clicked on a button — arrives
 * through calc_press(), so the two input paths cannot drift apart: a click on
 * "7" and the 7 key run the identical line of code.
 *
 * NO FLOATING POINT. The kernel is built -mno-sse -mgeneral-regs-only
 * everywhere except gpt.c, so one float here would emit an SSE instruction and
 * triple-fault the machine. Values are int64 fixed-point scaled by 1,000,000
 * (six decimal places) and every operation is range-checked before it runs —
 * see the bound proofs in calc.c.
 */
#ifndef ASTRION_CALC_H
#define ASTRION_CALC_H

/* Buttons. CB_0..CB_9 are contiguous and in value order, so a digit press is
 * just (CB_0 + d) and the engine reads the digit straight back off the id. */
enum {
    CB_NONE = -1,
    CB_0 = 0, CB_1, CB_2, CB_3, CB_4, CB_5, CB_6, CB_7, CB_8, CB_9,
    CB_DOT, CB_ADD, CB_SUB, CB_MUL, CB_DIV, CB_EQ,
    CB_CLEAR,     /* AC — wipe everything back to zero  */
    CB_BACK,      /* DEL — rub out the last digit typed */
    CB_SIGN,      /* +/- — flip the sign of the entry   */
    CB_COUNT
};

void calc_reset(void);

/* Apply one button. Out-of-range ids are ignored. */
void calc_press(int btn);

/* Map a keystroke to a button, or CB_NONE if the key means nothing here.
 * Kept in the engine so the key table and the button table stay one thing. */
int  calc_key_to_btn(char c);

/* The line above the result: the expression as it stands ("2 + 3 * "), or the
 * whole completed expression once = has been pressed ("2 + 3 * 4 ="). Derived
 * from the machine's state rather than accumulated as you type, so it can never
 * disagree with the arithmetic it is describing. */
void calc_expr(char *buf, int cap);

/* The big number — or the error message, when calc_is_error(). buf needs 32. */
void calc_value(char *buf, int cap);

int  calc_is_error(void);

#endif
