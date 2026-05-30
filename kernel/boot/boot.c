/**
 * NOVA OS — UEFI Bootloader
 *
 * This runs first when the computer powers on.
 * It uses UEFI firmware to:
 *   1. Set up a graphical framebuffer (pixels on screen)
 *   2. Get a memory map from the firmware
 *   3. Load and jump to the NOVA kernel
 *
 * Built with gnu-efi or as a standalone UEFI application.
 */

#include <efi.h>
#include <efilib.h>

// Framebuffer info passed to the kernel
typedef struct {
    UINT64 framebuffer_addr;
    UINT32 width;
    UINT32 height;
    UINT32 pitch;         // bytes per scanline
    UINT32 bpp;           // bits per pixel
    UINT64 memory_map_addr;
    UINT64 memory_map_size;
    UINT64 memory_map_desc_size;
} BootInfo;

// Kernel entry point signature
typedef void (*KernelEntry)(BootInfo *info);

// ─── Serial port helpers (UART 0x3F8) ──────────────────────────────
// UEFI's Print() goes to the screen console (ConOut). When booting in
// QEMU with -display none -serial stdio, that output is invisible.
// These helpers write directly to the legacy COM1 UART so each major
// boot step is visible on the serial line. Real hardware ignores it
// (no harm); QEMU + bare-metal serial dongles see it; debug-friendly.
// Added 2026-05-25 after QEMU showed a silent boot — no #UD crash but
// also no observable progress.

static inline void boot_outb(UINT16 port, UINT8 val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline UINT8 boot_inb(UINT16 port) {
    UINT8 val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

static void serial_init(void) {
    // Standard COM1 setup: 38400 baud, 8N1, FIFO enabled.
    boot_outb(0x3F8 + 1, 0x00);  // Disable interrupts
    boot_outb(0x3F8 + 3, 0x80);  // Enable DLAB (set baud rate divisor)
    boot_outb(0x3F8 + 0, 0x03);  // Divisor low byte (38400 baud)
    boot_outb(0x3F8 + 1, 0x00);  // Divisor high byte
    boot_outb(0x3F8 + 3, 0x03);  // 8 bits, no parity, 1 stop bit
    boot_outb(0x3F8 + 2, 0xC7);  // Enable FIFO, clear, 14-byte threshold
    boot_outb(0x3F8 + 4, 0x0B);  // IRQs enabled, RTS/DSR set
}

static void serial_write_char(char c) {
    // Wait until transmitter holding register is empty (bit 5 of status)
    while ((boot_inb(0x3F8 + 5) & 0x20) == 0) { }
    boot_outb(0x3F8, (UINT8)c);
}

static void serial_log(const char *s) {
    while (*s) {
        if (*s == '\n') serial_write_char('\r');
        serial_write_char(*s);
        s++;
    }
}

// Write a UINT64 as 0x<16 hex chars> to serial. Used for status codes
// + addresses when we need to see the exact value.
static void serial_log_hex(UINT64 v) {
    static const char hex[] = "0123456789abcdef";
    char buf[19];
    buf[0] = '0'; buf[1] = 'x';
    for (int i = 0; i < 16; i++) {
        buf[2 + i] = hex[(v >> ((15 - i) * 4)) & 0xF];
    }
    buf[18] = 0;
    serial_log(buf);
}

// Dump 16 bytes of a GUID to serial as `xxxx-xx-xx-xx-xxxxxxxx`. Used to
// verify a stack-local EFI_GUID actually contains the bytes we expect
// before we hand it to a firmware call. Useful diagnostic when
// LocateHandleBuffer returns EFI_INVALID_PARAMETER and we want to rule
// out a zeroed-out GUID.
static void serial_log_guid(EFI_GUID *g) {
    static const char hex[] = "0123456789abcdef";
    unsigned char *b = (unsigned char *)g;
    char buf[37];
    int p = 0;
    // 4-2-2-2-6 byte layout per RFC 4122 (Microsoft EFI uses little-endian
    // for the first three groups — fine, we just dump bytes-as-is here).
    for (int i = 0; i < 16; i++) {
        buf[p++] = hex[(b[i] >> 4) & 0xF];
        buf[p++] = hex[b[i] & 0xF];
        if (i == 3 || i == 5 || i == 7 || i == 9) buf[p++] = '-';
    }
    buf[p] = 0;
    serial_log(buf);
}

/**
 * Find and set the best available screen resolution
 */
EFI_STATUS SetGraphicsMode(EFI_GRAPHICS_OUTPUT_PROTOCOL *gop, BootInfo *info) {
    UINTN best_mode = 0;
    UINT32 best_width = 0;
    UINT32 best_height = 0;

    // Find the highest resolution mode (preferring 1920x1080 or similar)
    for (UINTN i = 0; i < gop->Mode->MaxMode; i++) {
        EFI_GRAPHICS_OUTPUT_MODE_INFORMATION *mode_info;
        UINTN size;
        gop->QueryMode(gop, i, &size, &mode_info);

        UINT32 w = mode_info->HorizontalResolution;
        UINT32 h = mode_info->VerticalResolution;

        // Prefer 1920x1080, or the largest available
        if (w == 1920 && h == 1080) {
            best_mode = i;
            best_width = w;
            best_height = h;
            break;
        }
        if (w * h > best_width * best_height) {
            best_mode = i;
            best_width = w;
            best_height = h;
        }
    }

    // Set the mode
    EFI_STATUS status = gop->SetMode(gop, best_mode);
    if (EFI_ERROR(status)) return status;

    // Fill in boot info
    info->framebuffer_addr = gop->Mode->FrameBufferBase;
    info->width = best_width;
    info->height = best_height;
    info->pitch = gop->Mode->Info->PixelsPerScanLine * 4; // 4 bytes per pixel (BGRA)
    info->bpp = 32;

    return EFI_SUCCESS;
}

/**
 * EFI Main — entry point from UEFI firmware
 *
 * 2026-05-25: NOTE the absence of EFIAPI here. gnu-efi's crt0-efi-x86_64.o
 * converts the firmware's MS-ABI call into a SysV-ABI call before invoking
 * efi_main. If we declare efi_main as EFIAPI (= __attribute__((ms_abi))),
 * the args land in RCX/RDX but crt0 has already moved them to RDI/RSI —
 * so we read garbage. ImageHandle showed up as 0x0 and every protocol
 * query returned EFI_INVALID_PARAMETER. gnu-efi's own examples don't put
 * EFIAPI on efi_main for exactly this reason. EFIAPI is for callbacks
 * we register with the firmware (e.g. protocol implementations), not for
 * the entry point.
 */
EFI_STATUS efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable) {
    EFI_STATUS status;
    BootInfo boot_info = {0};

    // Initialize UEFI library + serial debug output. Serial first so
    // we see early-boot output even if InitializeLib crashes.
    serial_init();
    serial_log("\n=== Astrion Kernel Bootloader v0.1 ===\n");
    serial_log("efi_main entered; serial init OK\n");
    serial_log("at-entry ImageHandle = ");
    serial_log_hex((UINT64)ImageHandle);
    serial_log("\n");
    serial_log("at-entry SystemTable = ");
    serial_log_hex((UINT64)SystemTable);
    serial_log("\n");
    serial_log("calling InitializeLib...\n");
    InitializeLib(ImageHandle, SystemTable);
    serial_log("InitializeLib returned\n");

    // 2026-05-25: ConOut->ClearScreen() hangs in QEMU+EDK2 builds where
    // ConOut is redirected to serial. The firmware writes ANSI escape
    // codes (visible earlier in the output as [2J[01;01H...) and
    // apparently blocks waiting on something we can't satisfy. Skip
    // ClearScreen entirely — it's cosmetic. Print() works fine and is
    // what we actually need for boot diagnostics.
    serial_log("about to Print(banner)\n");
    Print(L"Astrion Kernel Bootloader v0.1\n");
    serial_log("Print(banner) done; about to Print(Initializing)\n");
    Print(L"Initializing...\n\n");
    serial_log("Print(Initializing) done\n");

    // --- Step 1: Set up Graphics ---
    serial_log("[1/4] Setting up display\n");
    Print(L"[1/4] Setting up display...\n");
    EFI_GRAPHICS_OUTPUT_PROTOCOL *gop;
    EFI_GUID gop_guid = EFI_GRAPHICS_OUTPUT_PROTOCOL_GUID;
    // 2026-05-25: BS->LocateProtocol hangs in QEMU + edk2-x86_64-code.fd
    // for the GOP guid (no return; not even a status). Switching to the
    // more conservative LocateHandleBuffer + HandleProtocol pattern,
    // which is what gnu-efi's own examples use and seems to be more
    // robust across firmware versions.
    // 2026-05-25: GOP isn't always available — some QEMU+EDK2 builds
    // boot without exposing GOP at all (especially with -display none).
    // Real hardware always provides GOP. Make this graceful: if no GOP,
    // set framebuffer info to zero and let the kernel decide. The
    // kernel can either run headless (serial-only) or refuse to start.
    serial_log("  calling BS->LocateHandleBuffer for GOP\n");
    serial_log("  gop_guid bytes: ");
    serial_log_guid(&gop_guid);
    serial_log("\n");
    UINTN gop_handle_count = 0;
    EFI_HANDLE *gop_handles = NULL;
    status = BS->LocateHandleBuffer(ByProtocol, &gop_guid, NULL,
                                    &gop_handle_count, &gop_handles);
    serial_log("  LocateHandleBuffer(GOP) status = ");
    serial_log_hex((UINT64)status);
    serial_log(", count = ");
    serial_log_hex((UINT64)gop_handle_count);
    serial_log("\n");
    if (EFI_ERROR(status) || gop_handle_count == 0) {
        serial_log("  WARN: no GOP-providing handles; continuing headless\n");
        Print(L"WARN: no GOP found; booting headless\n");
        boot_info.framebuffer_addr = 0;
        boot_info.width = 0;
        boot_info.height = 0;
        boot_info.pitch = 0;
        boot_info.bpp = 0;
    } else {
        serial_log("  about to HandleProtocol on first GOP handle\n");
        status = BS->HandleProtocol(gop_handles[0], &gop_guid, (void **)&gop);
        serial_log("  HandleProtocol returned\n");
        if (gop_handles) BS->FreePool(gop_handles);
        if (EFI_ERROR(status)) {
            serial_log("  WARN: HandleProtocol failed; booting headless\n");
            boot_info.framebuffer_addr = 0;
        } else {
            serial_log("  calling SetGraphicsMode\n");
            status = SetGraphicsMode(gop, &boot_info);
            serial_log("  SetGraphicsMode returned\n");
            if (EFI_ERROR(status)) {
                serial_log("  WARN: SetGraphicsMode failed; booting headless\n");
                boot_info.framebuffer_addr = 0;
            } else {
                serial_log("  display mode set OK\n");
                Print(L"  Display: %dx%d @ %d bpp\n", boot_info.width, boot_info.height, boot_info.bpp);
                Print(L"  Framebuffer: 0x%lx\n", boot_info.framebuffer_addr);
            }
        }
    }

    serial_log("[1/4] display OK\n");

    // --- Step 2: Load kernel from disk ---
    serial_log("[2/4] Loading kernel from \\nova\\kernel.bin\n");
    Print(L"[2/4] Loading kernel...\n");

    // 2026-05-25: every HandleProtocol/OpenVolume/Open call now has
    // status checks. Previously the calls just trusted the output
    // pointers; if any returned an error, we'd dereference garbage
    // and #GP on a "function pointer" that's actually an EFI status
    // code (e.g. 0x8000000000000002 = EFI_INVALID_PARAMETER seen as RIP).

    // 2026-05-26: TWO-PATH approach to find the boot device's filesystem.
    //
    // Path A (canonical): HandleProtocol(ImageHandle, LoadedImageProtocol)
    //   → loaded_image->DeviceHandle
    //   → HandleProtocol(DeviceHandle, SimpleFileSystem)
    //
    // Path B (fallback): LocateHandleBuffer(ByProtocol, SimpleFileSystem)
    //   then iterate over each returned handle.
    //
    // Yesterday (homebrew OVMF, EDK2 firmware bug) Path B crashed in
    // BootScriptExecutorDxe. With retrage OVMF (today), Path B returns
    // EFI_INVALID_PARAMETER with count=0 — which is wrong (spec says
    // EFI_NOT_FOUND on no matches), but matches what some firmware does
    // when the protocol simply isn't registered on any handle. So we go
    // through Path A first; it's the canonical UEFI boot-device lookup
    // and tells the firmware exactly which device we want.

    EFI_SIMPLE_FILE_SYSTEM_PROTOCOL *fs = NULL;
    EFI_HANDLE boot_device_handle = NULL;

    EFI_GUID li_guid = LOADED_IMAGE_PROTOCOL;
    EFI_GUID fs_guid_local = EFI_SIMPLE_FILE_SYSTEM_PROTOCOL_GUID;

    serial_log("  li_guid bytes: ");
    serial_log_guid(&li_guid);
    serial_log("\n");
    serial_log("  fs_guid bytes: ");
    serial_log_guid(&fs_guid_local);
    serial_log("\n");

    // gnu-efi sets LibImageHandle from InitializeLib — use that since
    // the param ImageHandle sometimes gets compiler-elided in the
    // crt0 → efi_main handoff. The two should be identical when both
    // are non-NULL; we logged that match at boot.
    EFI_HANDLE effective_handle = ImageHandle ? ImageHandle : LibImageHandle;
    serial_log("  effective ImageHandle = ");
    serial_log_hex((UINT64)effective_handle);
    serial_log("\n");

    // PATH A: HandleProtocol(ImageHandle, LoadedImage)
    EFI_LOADED_IMAGE_PROTOCOL *loaded_image = NULL;
    serial_log("  PATH A: HandleProtocol(ImageHandle, LoadedImage)\n");
    status = BS->HandleProtocol(effective_handle, &li_guid, (void **)&loaded_image);
    serial_log("    status = ");
    serial_log_hex((UINT64)status);
    serial_log("\n");
    if (!EFI_ERROR(status) && loaded_image) {
        boot_device_handle = loaded_image->DeviceHandle;
        serial_log("    loaded_image->DeviceHandle = ");
        serial_log_hex((UINT64)boot_device_handle);
        serial_log("\n");
        if (boot_device_handle) {
            serial_log("  PATH A: HandleProtocol(DeviceHandle, SimpleFileSystem)\n");
            status = BS->HandleProtocol(boot_device_handle, &fs_guid_local, (void **)&fs);
            serial_log("    status = ");
            serial_log_hex((UINT64)status);
            serial_log("\n");
            if (EFI_ERROR(status)) fs = NULL;
        }
    }

    // PATH B: fall back to LocateHandleBuffer if Path A didn't bind fs.
    if (!fs) {
        serial_log("  PATH B: LocateHandleBuffer(SimpleFileSystem)\n");
        UINTN fs_handle_count = 0;
        EFI_HANDLE *fs_handles = NULL;
        status = BS->LocateHandleBuffer(ByProtocol, &fs_guid_local, NULL,
                                        &fs_handle_count, &fs_handles);
        serial_log("    status = ");
        serial_log_hex((UINT64)status);
        serial_log(", count = ");
        serial_log_hex((UINT64)fs_handle_count);
        serial_log("\n");
        if (!EFI_ERROR(status) && fs_handle_count > 0 && fs_handles) {
            for (UINTN i = 0; i < fs_handle_count && !fs; i++) {
                serial_log("    trying handle[");
                serial_log_hex((UINT64)i);
                serial_log("] = ");
                serial_log_hex((UINT64)fs_handles[i]);
                serial_log("\n");
                EFI_SIMPLE_FILE_SYSTEM_PROTOCOL *candidate = NULL;
                EFI_STATUS s = BS->HandleProtocol(fs_handles[i], &fs_guid_local,
                                                  (void **)&candidate);
                if (!EFI_ERROR(s) && candidate) {
                    fs = candidate;
                    boot_device_handle = fs_handles[i];
                    serial_log("    bound fs on handle[");
                    serial_log_hex((UINT64)i);
                    serial_log("]\n");
                }
            }
        }
        if (fs_handles) BS->FreePool(fs_handles);
    }

    if (!fs) {
        serial_log("  ERROR: no filesystem found via either path\n");
        Print(L"ERROR: No filesystem available\n");
        goto halt;
    }

    // Open the volume's root directory.
    EFI_FILE_PROTOCOL *root = NULL;
    serial_log("  calling fs->OpenVolume\n");
    status = fs->OpenVolume(fs, &root);
    serial_log("  OpenVolume returned\n");
    if (EFI_ERROR(status) || !root) {
        serial_log("  ERROR: OpenVolume failed\n");
        Print(L"ERROR: OpenVolume failed\n");
        goto halt;
    }

    EFI_FILE_PROTOCOL *kernel_file;
    status = root->Open(root, &kernel_file, L"\\nova\\kernel.bin", EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) {
        serial_log("ERROR: \\nova\\kernel.bin not found on boot drive\n");
        Print(L"ERROR: Could not find \\nova\\kernel.bin\n");
        Print(L"  Make sure the kernel binary is on the boot drive.\n");
        goto halt;
    }

    // Get file size
    EFI_FILE_INFO *file_info;
    UINTN info_size = sizeof(EFI_FILE_INFO) + 256;
    BS->AllocatePool(EfiLoaderData, info_size, (void **)&file_info);
    EFI_GUID fi_guid = EFI_FILE_INFO_ID;
    kernel_file->GetInfo(kernel_file, &fi_guid, &info_size, file_info);
    UINTN kernel_size = file_info->FileSize;
    Print(L"  Kernel size: %lu bytes\n", kernel_size);

    // Allocate memory for kernel and read it
    VOID *kernel_buffer;
    BS->AllocatePool(EfiLoaderData, kernel_size, &kernel_buffer);
    kernel_file->Read(kernel_file, &kernel_size, kernel_buffer);
    kernel_file->Close(kernel_file);
    Print(L"  Kernel loaded at: 0x%lx\n", (UINT64)kernel_buffer);

    serial_log("[2/4] kernel.bin loaded into memory\n");

    // --- Step 3: Get memory map ---
    serial_log("[3/4] Getting UEFI memory map\n");
    Print(L"[3/4] Getting memory map...\n");
    UINTN map_size = 0, map_key, desc_size;
    UINT32 desc_version;
    EFI_MEMORY_DESCRIPTOR *memory_map = NULL;

    // First call to get required size
    BS->GetMemoryMap(&map_size, memory_map, &map_key, &desc_size, &desc_version);
    map_size += 2 * desc_size; // Extra space for the allocation itself
    BS->AllocatePool(EfiLoaderData, map_size, (void **)&memory_map);
    status = BS->GetMemoryMap(&map_size, memory_map, &map_key, &desc_size, &desc_version);

    boot_info.memory_map_addr = (UINT64)memory_map;
    boot_info.memory_map_size = map_size;
    boot_info.memory_map_desc_size = desc_size;

    serial_log("[3/4] memory map captured\n");

    // --- Step 4: Exit boot services and jump to kernel ---
    serial_log("[4/4] ExitBootServices + jump to kernel.bin entry\n");
    Print(L"[4/4] Starting Astrion kernel...\n\n");

    // Exit UEFI boot services — after this, we own the hardware
    status = BS->ExitBootServices(ImageHandle, map_key);
    if (EFI_ERROR(status)) {
        // Memory map may have changed, try again
        BS->GetMemoryMap(&map_size, memory_map, &map_key, &desc_size, &desc_version);
        BS->ExitBootServices(ImageHandle, map_key);
    }

    // Jump to kernel
    KernelEntry kernel_entry = (KernelEntry)kernel_buffer;
    kernel_entry(&boot_info);

    // Should never reach here
halt:
    Print(L"\nSystem halted. Press any key to reboot.\n");
    ST->ConIn->Reset(ST->ConIn, FALSE);
    EFI_INPUT_KEY key;
    while (ST->ConIn->ReadKeyStroke(ST->ConIn, &key) == EFI_NOT_READY);
    ST->RuntimeServices->ResetSystem(EfiResetCold, EFI_SUCCESS, 0, NULL);

    return EFI_SUCCESS;
}
