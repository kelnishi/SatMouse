import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { nativeRequire } from "../native-require.js";
import type { Tray, TrayActions } from "./types.js";

// Win32 constants
const WM_DESTROY = 0x0002;
const WM_COMMAND = 0x0111;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONUP = 0x0205;
const WM_APP = 0x8000;
const PM_REMOVE = 0x0001;
const MF_STRING = 0x0000;
const MF_SEPARATOR = 0x0800;
const TPM_BOTTOMALIGN = 0x0020;
const TPM_LEFTALIGN = 0x0000;
const NIM_ADD = 0x00000000;
const NIM_DELETE = 0x00000002;
const NIF_MESSAGE = 0x00000001;
const NIF_ICON = 0x00000002;
const NIF_TIP = 0x00000004;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const IDI_APPLICATION = 32512;

const TRAY_MSG = WM_APP + 1;
const ID_ABOUT = 1001;
const ID_OPEN_CLIENT = 1002;
const ID_REFRESH = 1003;
const ID_QUIT = 1004;

// NOTIFYICONDATAW field offsets (x64 MSVC layout, 976 bytes total)
const NID_SIZE = 976;
const NID_cbSize = 0;           // uint32 (4)
// 4 bytes padding
const NID_hWnd = 8;             // pointer (8)
const NID_uID = 16;             // uint32 (4)
const NID_uFlags = 20;          // uint32 (4)
const NID_uCallbackMessage = 24;// uint32 (4)
// 4 bytes padding
const NID_hIcon = 32;           // pointer (8)
const NID_szTip = 40;           // wchar[128] (256 bytes)

/** Write a JS string into a Buffer as UTF-16LE at the given offset */
function writeTip(buf: Buffer, offset: number, text: string, maxChars: number): void {
  const encoded = Buffer.from(text.slice(0, maxChars - 1) + "\0", "utf16le");
  encoded.copy(buf, offset, 0, Math.min(encoded.length, maxChars * 2));
}

/** Encode a JS string to a null-terminated UTF-16LE buffer */
function wstr(s: string): Buffer {
  return Buffer.from(s + "\0", "utf16le");
}

function openBrowser(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  } catch { return; }
  execFile("cmd", ["/c", "start", "", url]);
}

/**
 * Windows notification area (system tray) icon via koffi + Win32 API.
 *
 * Shows a SatMouse icon in the system tray with a context menu:
 *   - About SatMouse (opens project page)
 *   - Open Web Client
 *   - Refresh Devices
 *   - Quit SatMouse
 *
 * Pumps Win32 messages on an interval so the tray icon responds to clicks.
 */
export class WindowsTray implements Tray {
  private callbackHandles: any[] = [];
  private eventPump: ReturnType<typeof setInterval> | null = null;

  start(actions: TrayActions): void {
    const koffi: any = nativeRequire("koffi");

    const user32 = koffi.load("user32.dll");
    const shell32 = koffi.load("shell32.dll");
    const kernel32 = koffi.load("kernel32.dll");

    // Callback prototype: LRESULT CALLBACK WndProc(HWND, UINT, WPARAM, LPARAM)
    const WndProcProto = koffi.proto("intptr __stdcall WndProc(void *hWnd, uint32 msg, uintptr wParam, intptr lParam)");

    // Win32 functions
    const GetModuleHandleW = kernel32.func("void *GetModuleHandleW(void *lpModuleName)");
    const RegisterClassExW = user32.func("uint16 RegisterClassExW(void *lpwcx)");
    const CreateWindowExW = user32.func(
      "void *CreateWindowExW(uint32 dwExStyle, void *lpClassName, void *lpWindowName, " +
      "uint32 dwStyle, int x, int y, int nWidth, int nHeight, " +
      "void *hWndParent, void *hMenu, void *hInstance, void *lpParam)"
    );
    const DefWindowProcW = user32.func("intptr DefWindowProcW(void *hWnd, uint32 Msg, uintptr wParam, intptr lParam)");
    const DestroyWindow = user32.func("bool DestroyWindow(void *hWnd)");
    const PeekMessageW = user32.func("bool PeekMessageW(void *lpMsg, void *hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax, uint32 wRemoveMsg)");
    const TranslateMessage = user32.func("bool TranslateMessage(void *lpMsg)");
    const DispatchMessageW = user32.func("intptr DispatchMessageW(void *lpMsg)");
    const CreatePopupMenu = user32.func("void *CreatePopupMenu()");
    const AppendMenuW = user32.func("bool AppendMenuW(void *hMenu, uint32 uFlags, uintptr uIDNewItem, void *lpNewItem)");
    const TrackPopupMenu = user32.func("bool TrackPopupMenu(void *hMenu, uint32 uFlags, int x, int y, int nReserved, void *hWnd, void *prcRect)");
    const DestroyMenu = user32.func("bool DestroyMenu(void *hMenu)");
    const SetForegroundWindow = user32.func("bool SetForegroundWindow(void *hWnd)");
    const GetCursorPos = user32.func("bool GetCursorPos(void *lpPoint)");
    const LoadImageW = user32.func("void *LoadImageW(void *hInst, void *name, uint32 type, int cx, int cy, uint32 fuLoad)");
    const LoadIconW = user32.func("void *LoadIconW(void *hInstance, uintptr lpIconName)");
    const DestroyIcon = user32.func("bool DestroyIcon(void *hIcon)");
    const Shell_NotifyIconW = shell32.func("bool Shell_NotifyIconW(uint32 dwMessage, void *lpData)");
    const PostMessageW = user32.func("bool PostMessageW(void *hWnd, uint32 Msg, uintptr wParam, intptr lParam)");

    const hInstance = GetModuleHandleW(null);
    const className = wstr("SatMouseTrayClass");

    // Track state for cleanup
    let hwnd: any = null;
    let hMenu: any = null;
    let hIcon: any = null;
    let customIcon = false;
    const nidBuf = Buffer.alloc(NID_SIZE);

    // WndProc callback
    const wndProcCb = koffi.register((hWnd: any, msg: number, wParam: any, lParam: any): any => {
      if (msg === TRAY_MSG) {
        const event = Number(lParam) & 0xFFFF;
        if (event === WM_RBUTTONUP || event === WM_LBUTTONUP) {
          // Show context menu at cursor
          SetForegroundWindow(hWnd);
          const pt = Buffer.alloc(8); // POINT: two int32s
          GetCursorPos(pt);
          const x = pt.readInt32LE(0);
          const y = pt.readInt32LE(4);
          TrackPopupMenu(hMenu, TPM_LEFTALIGN | TPM_BOTTOMALIGN, x, y, 0, hWnd, null);
          // Post a benign message to dismiss menu on click-away (Win32 quirk KB135788)
          PostMessageW(hWnd, 0, 0, 0);
        }
        return 0;
      }

      if (msg === WM_COMMAND) {
        const id = Number(wParam) & 0xFFFF;
        switch (id) {
          case ID_ABOUT:
            openBrowser("https://kelnishi.github.io/SatMouse");
            break;
          case ID_OPEN_CLIENT:
            actions.onOpenClient();
            break;
          case ID_REFRESH:
            actions.onRescanDevices();
            break;
          case ID_QUIT:
            Shell_NotifyIconW(NIM_DELETE, nidBuf);
            actions.onQuit();
            break;
        }
        return 0;
      }

      if (msg === WM_DESTROY) {
        Shell_NotifyIconW(NIM_DELETE, nidBuf);
        return 0;
      }

      return DefWindowProcW(hWnd, msg, wParam, lParam);
    }, koffi.pointer(WndProcProto));

    // Register window class (WNDCLASSEXW)
    // Layout: cbSize(4) + style(4) + lpfnWndProc(8) + cbClsExtra(4) + cbWndExtra(4) +
    //         hInstance(8) + hIcon(8) + hCursor(8) + hbrBackground(8) +
    //         lpszMenuName(8) + lpszClassName(8) + hIconSm(8) = 80 bytes
    const wcBuf = Buffer.alloc(80);
    wcBuf.writeUInt32LE(80, 0);    // cbSize
    wcBuf.writeUInt32LE(0, 4);     // style
    koffi.encode(wcBuf, 8, "void *", wndProcCb);   // lpfnWndProc
    wcBuf.writeInt32LE(0, 16);     // cbClsExtra
    wcBuf.writeInt32LE(0, 20);     // cbWndExtra
    koffi.encode(wcBuf, 24, "void *", hInstance);   // hInstance
    // hIcon (32), hCursor (40), hbrBackground (48), lpszMenuName (56) — all null/zero
    koffi.encode(wcBuf, 64, "void *", className);   // lpszClassName
    // hIconSm (72) — null

    const atom = RegisterClassExW(wcBuf);
    if (!atom) {
      console.warn("[Tray] RegisterClassExW failed");
      return;
    }

    // Create message-only window (HWND_MESSAGE = -3)
    const HWND_MESSAGE = koffi.as(-3, "void *");
    hwnd = CreateWindowExW(
      0, className, wstr("SatMouse"), 0,
      0, 0, 0, 0,
      HWND_MESSAGE, null, hInstance, null
    );
    if (!hwnd) {
      console.warn("[Tray] CreateWindowExW failed");
      return;
    }

    // Load icon — try SatMouse.ico first, fall back to system icon
    const icoPath = findIcoPath();
    if (icoPath) {
      hIcon = LoadImageW(null, wstr(icoPath), IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
      if (hIcon) customIcon = true;
    }
    if (!hIcon) {
      hIcon = LoadIconW(null, IDI_APPLICATION);
    }

    // Build NOTIFYICONDATAW buffer
    nidBuf.writeUInt32LE(NID_SIZE, NID_cbSize);
    koffi.encode(nidBuf, NID_hWnd, "void *", hwnd);
    nidBuf.writeUInt32LE(1, NID_uID);
    nidBuf.writeUInt32LE(NIF_MESSAGE | NIF_ICON | NIF_TIP, NID_uFlags);
    nidBuf.writeUInt32LE(TRAY_MSG, NID_uCallbackMessage);
    koffi.encode(nidBuf, NID_hIcon, "void *", hIcon);
    writeTip(nidBuf, NID_szTip, "SatMouse", 128);

    Shell_NotifyIconW(NIM_ADD, nidBuf);

    // Build context menu
    hMenu = CreatePopupMenu();
    AppendMenuW(hMenu, MF_STRING, ID_ABOUT, wstr("About SatMouse"));
    AppendMenuW(hMenu, MF_SEPARATOR, 0, null);
    AppendMenuW(hMenu, MF_STRING, ID_OPEN_CLIENT, wstr("Open Web Client"));
    AppendMenuW(hMenu, MF_STRING, ID_REFRESH, wstr("Refresh Devices"));
    AppendMenuW(hMenu, MF_SEPARATOR, 0, null);
    AppendMenuW(hMenu, MF_STRING, ID_QUIT, wstr("Quit SatMouse"));

    // Message pump — drain pending Win32 messages on an interval
    const msgBuf = Buffer.alloc(48); // MSG struct (48 bytes on x64)
    this.eventPump = setInterval(() => {
      for (let i = 0; i < 10; i++) {
        if (!PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE)) break;
        TranslateMessage(msgBuf);
        DispatchMessageW(msgBuf);
      }
    }, 16); // ~60 Hz

    // Prevent GC of koffi handles
    this.callbackHandles = [wndProcCb, hwnd, hMenu, hIcon, nidBuf, className, wcBuf];

    console.log("[Tray] System tray icon active");
  }

  stop(): void {
    if (this.eventPump) {
      clearInterval(this.eventPump);
      this.eventPump = null;
    }
    this.callbackHandles = [];
  }
}

/** Search for SatMouse.ico near the executable */
function findIcoPath(): string | null {
  const execDir = dirname(process.execPath);
  const candidates = [
    join(execDir, "SatMouse.ico"),                     // Windows package: alongside node.exe
    join(execDir, "..", "Resources", "SatMouse.ico"),   // macOS .app (shouldn't happen, but safe)
    join(process.cwd(), "assets", "icons", "SatMouse.ico"), // Dev mode
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
