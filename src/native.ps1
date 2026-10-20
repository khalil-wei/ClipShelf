$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class ClipNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from,uint to,bool attach);
  private static NativeWindow commandWindow;
  public static void PrepareInput(){commandWindow=new NativeWindow();commandWindow.CreateHandle(new CreateParams{Parent=new IntPtr(-3)});}
  public static void Restore(IntPtr target){
    uint pid;uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out pid),ownThread=GetCurrentThreadId();bool attached=false;
    try{if(GetForegroundWindow()!=target){attached=foregroundThread!=0&&foregroundThread!=ownThread&&AttachThreadInput(ownThread,foregroundThread,true);SetForegroundWindow(target);}}
    finally{if(attached)AttachThreadInput(ownThread,foregroundThread,false);}
    for(int i=0;i<60&&GetForegroundWindow()!=target;i++)Thread.Sleep(5);
  }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr h);
  [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  public static string Source() {
    try { uint pid; GetWindowThreadProcessId(GetClipboardOwner(), out pid); return Process.GetProcessById((int)pid).ProcessName.Replace("\n", "").Replace("\r", ""); }
    catch { return ""; }
  }
  public static string Bounds(IntPtr h) {
    RECT r; if (!GetWindowRect(h, out r)) return "0,0,0,0";
    return r.Left + "," + r.Top + "," + (r.Right-r.Left) + "," + (r.Bottom-r.Top);
  }
  private class Listener : NativeWindow {
    public Listener() { CreateHandle(new CreateParams { Parent = new IntPtr(-3) }); if (!AddClipboardFormatListener(Handle)) throw new Exception("Clipboard listener registration failed"); }
    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x031D) Console.Out.WriteLine("CLIPBOARD " + GetClipboardSequenceNumber() + " " + Source());
      base.WndProc(ref m);
    }
  }
  public static void Listen() {
    var ready = new ManualResetEvent(false); Exception failure = null;
    var thread = new Thread(() => { try { var listener = new Listener(); ready.Set(); Application.Run(); GC.KeepAlive(listener); } catch (Exception e) { failure=e; ready.Set(); } });
    thread.IsBackground = true; thread.SetApartmentState(ApartmentState.STA); thread.Start();
    if (!ready.WaitOne(5000)) throw new Exception("Clipboard listener timed out");
    if (failure != null) throw failure;
  }
}
'@
[ClipNative]::PrepareInput()
try { [ClipNative]::Listen(); [Console]::Out.WriteLine('READY') }
catch { [Console]::Out.WriteLine('READY_FALLBACK') }
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    if ($line -eq 'CAPTURE') { [Console]::Out.WriteLine([ClipNative]::GetForegroundWindow().ToInt64()); continue }
    if ($line -eq 'SOURCE') { [Console]::Out.WriteLine([ClipNative]::Source()); continue }
    if ($line -eq 'SEQUENCE') { [Console]::Out.WriteLine([ClipNative]::GetClipboardSequenceNumber()); continue }
    if ($line -eq 'FILES') { [Console]::Out.WriteLine((ConvertTo-Json -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList()) -Compress)); continue }
    if ($line -eq 'IMAGE_READY') {
      $clipboardImage = [System.Windows.Forms.Clipboard]::GetImage()
      if ($null -eq $clipboardImage) { [Console]::Out.WriteLine('NO') }
      else { $clipboardImage.Dispose(); [Console]::Out.WriteLine('YES') }
      continue
    }
    if ($line.StartsWith('BOUNDS ')) { [Console]::Out.WriteLine([ClipNative]::Bounds([IntPtr]([long]$line.Substring(7)))); continue }
    if ($line.StartsWith('PASTE ')) {
      $parts = $line.Substring(6).Split(' ')
      $target = [IntPtr]([long]$parts[0])
      if ($target -eq [IntPtr]::Zero -or -not [ClipNative]::IsWindow($target)) { throw 'Target window is no longer available' }
      $released = $false
      for ($i = 0; $i -lt 200; $i++) {
        $held = $false
        foreach ($key in @(0x01, 0x02, 0x11, 0x12, 0x10, 0x5B, 0x5C, 0x0D)) { if (([ClipNative]::GetAsyncKeyState($key) -band 0x8000) -ne 0) { $held = $true } }
        if (-not $held) { $released = $true; break }
        Start-Sleep -Milliseconds 10
      }
      if (-not $released) { throw 'Release modifier keys and try again' }
      $foreground = [ClipNative]::GetForegroundWindow()
      if ($parts.Length -gt 1 -and $foreground -ne $target -and $foreground -ne [IntPtr]([long]$parts[1])) { throw 'Focus changed; paste cancelled' }
      [ClipNative]::Restore($target)
      if ([ClipNative]::GetForegroundWindow() -ne $target) { throw 'Focus changed; paste cancelled' }
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      [Console]::Out.WriteLine('OK')
    }
  } catch { [Console]::Out.WriteLine('ERROR ' + $_.Exception.Message) }
}
