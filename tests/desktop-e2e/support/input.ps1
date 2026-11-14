# Real (OS-level) keyboard / mouse input for the Windows E2E run, like xdotool on Linux.
#   input.ps1 keydown ctrl | keyup ctrl | move X Y | down | up | focus "Window title"
param([string]$Op, [string]$A, [string]$B)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FloInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
[void][FloInput]::SetProcessDPIAware()
$vk = @{ ctrl = 0xA2; lwin = 0x5B; shift = 0xA0; alt = 0xA4 }
# tagged so an e2e build of Flo accepts these as the Flo key (src-tauri/src/e2e.rs E2E_KEY_TAG)
$tag = [UIntPtr][uint64]0x0F10E2E0
switch ($Op) {
  "keydown" { [FloInput]::keybd_event($vk[$A], 0, 0, $tag) }
  "keyup"   { [FloInput]::keybd_event($vk[$A], 0, 2, $tag) }
  "move"    { [void][FloInput]::SetCursorPos([int]$A, [int]$B) }
  "down"    { [FloInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) }
  "up"      { [FloInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
  "focus"   { $h = [FloInput]::FindWindow($null, $A); if ($h -ne [IntPtr]::Zero) { [void][FloInput]::SetForegroundWindow($h) } }
  "close"   { $h = [FloInput]::FindWindow($null, $A); if ($h -ne [IntPtr]::Zero) { [void][FloInput]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } }
}
