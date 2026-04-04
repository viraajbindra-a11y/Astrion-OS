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
 */
EFI_STATUS EFIAPI efi_main(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *SystemTable) {
    EFI_STATUS status;
    BootInfo boot_info = {0};

    // Initialize UEFI library
    InitializeLib(ImageHandle, SystemTable);

    // Clear screen and show boot message
    ST->ConOut->ClearScreen(ST->ConOut);
    Print(L"NOVA OS Bootloader v0.1\n");
    Print(L"Initializing...\n\n");

    // --- Step 1: Set up Graphics ---
    Print(L"[1/4] Setting up display...\n");
    EFI_GRAPHICS_OUTPUT_PROTOCOL *gop;
    EFI_GUID gop_guid = EFI_GRAPHICS_OUTPUT_PROTOCOL_GUID;
    status = BS->LocateProtocol(&gop_guid, NULL, (void **)&gop);
    if (EFI_ERROR(status)) {
        Print(L"ERROR: Could not find graphics output protocol\n");
        return status;
    }

    status = SetGraphicsMode(gop, &boot_info);
    if (EFI_ERROR(status)) {
        Print(L"ERROR: Could not set graphics mode\n");
        return status;
    }
    Print(L"  Display: %dx%d @ %d bpp\n", boot_info.width, boot_info.height, boot_info.bpp);
    Print(L"  Framebuffer: 0x%lx\n", boot_info.framebuffer_addr);

    // --- Step 2: Load kernel from disk ---
    Print(L"[2/4] Loading kernel...\n");

    // Load kernel file from the EFI system partition
    EFI_LOADED_IMAGE_PROTOCOL *loaded_image;
    EFI_GUID li_guid = EFI_LOADED_IMAGE_PROTOCOL_GUID;
    BS->HandleProtocol(ImageHandle, &li_guid, (void **)&loaded_image);

    EFI_SIMPLE_FILE_SYSTEM_PROTOCOL *fs;
    EFI_GUID fs_guid = EFI_SIMPLE_FILE_SYSTEM_PROTOCOL_GUID;
    BS->HandleProtocol(loaded_image->DeviceHandle, &fs_guid, (void **)&fs);

    EFI_FILE_PROTOCOL *root;
    fs->OpenVolume(fs, &root);

    EFI_FILE_PROTOCOL *kernel_file;
    status = root->Open(root, &kernel_file, L"\\nova\\kernel.bin", EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) {
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

    // --- Step 3: Get memory map ---
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

    // --- Step 4: Exit boot services and jump to kernel ---
    Print(L"[4/4] Starting NOVA OS kernel...\n\n");

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
