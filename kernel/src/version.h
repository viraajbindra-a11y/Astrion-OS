#ifndef ASTRION_VERSION_H
#define ASTRION_VERSION_H

/* One version string, in one place, because there were two.
 *
 * wm.c and shell.c each carried their own copy and both still read
 * "v2.0-stub" long after the kernel stopped being one: it has paging, a
 * preemptive scheduler, ring 3 with per-process address spaces, an ELF loader
 * and a filesystem that survives a reboot. A placeholder is a claim about the
 * software, and shipping one that says "stub" makes a false claim to the only
 * people who ever read it.
 *
 * Two copies is also simply how strings drift. The same pair already disagree
 * about the build timestamp by a second, because __DATE__/__TIME__ are stamped
 * per translation unit and these are two. That one is cosmetic and is NOT
 * fixed here — it needs a single TU to own the stamp and hand it out, which is
 * more than a version string is worth today. Noted rather than hidden. */
#define ASTRION_VERSION "Astrion Kernel v2.0"

#endif /* ASTRION_VERSION_H */
