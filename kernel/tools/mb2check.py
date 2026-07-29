#!/usr/bin/env python3
"""
mb2check.py — validate a kernel's multiboot2 header without needing GRUB.

If this header is wrong, GRUB refuses the kernel and a real machine shows you a
blank screen and nothing else. That makes it one of the highest-stakes 16 bytes
in the project — and on a macOS dev box it was UNCHECKED, because the check was
`grub-file --is-x86-multiboot2` and grub-file ships with GRUB. The build said so
honestly ("multiboot2 header NOT verified here") and then carried on, which
means the gate ran nowhere a developer could see it fail.

The header is a documented byte layout, so checking it needs no GRUB at all —
just the spec. Multiboot2 1.6, section 3.1.1:

    offset  size  field
    0       u32   magic = 0xE85250D6
    4       u32   architecture (0 = i386 protected mode)
    8       u32   header_length (whole header, including tags)
    12      u32   checksum, such that the four u32s sum to 0 mod 2^32

and the constraints GRUB actually enforces when it searches for it:

  * it must appear within the first 32768 bytes of the file,
  * it must be 8-byte aligned,
  * it must be followed by tags, terminated by an end tag (type 0, size 8).

    python3 mb2check.py <kernel.elf> [--verbose]
    python3 mb2check.py --selftest        # corrupt each field; each must FAIL

Exit 0 if valid. The self-test is the part that matters: a validator nobody has
watched reject a bad header is just an expensive way to print PASS.
"""
import struct
import sys

MAGIC = 0xE85250D6
SEARCH_LIMIT = 32768        # multiboot2 spec: header must be in the first 32 KiB
ALIGN = 8

TAG_NAMES = {
    0: "end", 1: "information request", 2: "address", 3: "entry address",
    4: "console flags", 5: "framebuffer", 6: "module align",
    7: "EFI boot services", 8: "EFI i386 entry", 9: "EFI amd64 entry",
    10: "relocatable",
}


def check(blob, verbose=False):
    """Return (ok, [messages]). Never raises on malformed input — a truncated or
    nonsense file is a FAILURE to report, not a traceback to decode."""
    msg = []
    where = blob.find(struct.pack("<I", MAGIC), 0, SEARCH_LIMIT + 4)
    if where < 0:
        return False, [f"no multiboot2 magic (0x{MAGIC:08X}) in the first "
                       f"{SEARCH_LIMIT} bytes — GRUB will not recognise this file"]
    msg.append(f"magic at file offset {where} (0x{where:X})")

    if where % ALIGN:
        return False, msg + [f"header is at offset {where}, not {ALIGN}-byte "
                             f"aligned — GRUB only searches aligned offsets"]

    if where + 16 > len(blob):
        return False, msg + ["file ends inside the header"]
    magic, arch, hlen, csum = struct.unpack_from("<IIII", blob, where)

    if arch != 0:
        return False, msg + [f"architecture is {arch}, expected 0 (i386 protected "
                             f"mode). A 64-bit kernel still declares 0 here — GRUB "
                             f"enters in 32-bit mode and the kernel long-jumps."]
    msg.append("architecture 0 (i386 protected mode)")

    total = (magic + arch + hlen + csum) & 0xFFFFFFFF
    if total != 0:
        want = (-(magic + arch + hlen)) & 0xFFFFFFFF
        return False, msg + [f"checksum 0x{csum:08X} is wrong: the four header "
                             f"u32s sum to 0x{total:08X}, must be 0. Correct value "
                             f"is 0x{want:08X}."]
    msg.append(f"checksum 0x{csum:08X} valid (fields sum to 0)")

    if hlen < 16 or where + hlen > len(blob):
        return False, msg + [f"header_length {hlen} runs past the end of the file"]
    msg.append(f"header_length {hlen}")

    # Walk the tags. Each is (u16 type, u16 flags, u32 size), padded to 8.
    off = where + 16
    end = where + hlen
    seen, saw_end = [], False
    while off + 8 <= end:
        ttype, tflags, tsize = struct.unpack_from("<HHI", blob, off)
        name = TAG_NAMES.get(ttype, f"unknown({ttype})")
        if tsize < 8:
            return False, msg + [f"tag at +{off - where} has size {tsize}, "
                                 f"minimum is 8 — the walk cannot advance"]
        seen.append(name)
        if verbose:
            msg.append(f"  tag {ttype:>2} {name:<22} size {tsize}"
                       + (" (optional)" if tflags & 1 else ""))
        if ttype == 0:
            if tsize != 8:
                return False, msg + [f"end tag size is {tsize}, must be 8"]
            saw_end = True
            off += 8
            break
        off += (tsize + 7) & ~7          # tags are 8-byte aligned
    if not saw_end:
        return False, msg + ["no end tag (type 0, size 8) — GRUB reads past the "
                             "header looking for one"]
    msg.append(f"tags: {', '.join(seen)}")

    if off != end:
        # Not fatal for GRUB, but it means header_length disagrees with the tags,
        # which is always a sign the header was hand-edited and half-updated.
        msg.append(f"WARNING: tags end at +{off - where} but header_length says "
                   f"{hlen} — {end - off} stray bytes")
    return True, msg


def selftest():
    """Build a valid header, then break it one way at a time. Every mutation
    must be REJECTED. This is what makes a PASS on the real kernel mean
    something: a checker that cannot say no is not a checker."""
    def build(magic=MAGIC, arch=0, pad=0, tags=b"\x00\x00\x00\x00\x08\x00\x00\x00"):
        hlen = 16 + len(tags)
        csum = (-(magic + arch + hlen)) & 0xFFFFFFFF
        return b"\x00" * pad + struct.pack("<IIII", magic, arch, hlen, csum) + tags

    cases = [
        ("valid header",                 build(),                              True),
        ("valid, offset 4096",           build(pad=4096),                      True),
        ("wrong magic",                  build(magic=0xDEADBEEF),              False),
        ("wrong architecture",           build(arch=4),                        False),
        ("misaligned (offset 4)",        build(pad=4),                         False),
        ("no end tag",                   build(tags=b""),                      False),
        ("end tag with size 16",
         build(tags=b"\x00\x00\x00\x00\x10\x00\x00\x00"),                      False),
        ("zero-size tag (infinite walk)",
         build(tags=b"\x05\x00\x00\x00\x00\x00\x00\x00"),                      False),
        ("truncated after magic",        struct.pack("<I", MAGIC) + b"\x00",   False),
        ("magic past the 32 KiB limit",  build(pad=SEARCH_LIMIT + 8),          False),
        ("empty file",                   b"",                                  False),
    ]
    bad = 0
    for name, blob, want in cases:
        # Corrupt the checksum case separately: it needs a valid build first.
        ok, _ = check(blob)
        mark = "ok " if ok == want else "BAD"
        if ok != want:
            bad += 1
        print(f"  [{mark}] {name:<32} -> {'accept' if ok else 'reject'} "
              f"(wanted {'accept' if want else 'reject'})")

    # Checksum: take a valid header and flip one byte of the checksum field.
    good = bytearray(build())
    good[12] ^= 0xFF
    ok, _ = check(bytes(good))
    if ok:
        bad += 1
    print(f"  [{'ok ' if not ok else 'BAD'}] {'corrupted checksum':<32} -> "
          f"{'accept' if ok else 'reject'} (wanted reject)")

    print(f"\nself-test: {'all mutations handled correctly' if not bad else f'{bad} WRONG'}")
    return 0 if not bad else 1


def main():
    args = [a for a in sys.argv[1:]]
    if "--selftest" in args:
        print("mb2check self-test — every corruption below must be REJECTED:")
        return selftest()
    verbose = "--verbose" in args
    paths = [a for a in args if not a.startswith("--")]
    if len(paths) != 1:
        raise SystemExit(__doc__.strip())
    with open(paths[0], "rb") as fh:
        blob = fh.read()
    ok, msg = check(blob, verbose)
    for m in msg:
        print(f"  {m}")
    print(f"mb2check: {'VALID multiboot2 kernel' if ok else 'INVALID — GRUB will refuse this'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
