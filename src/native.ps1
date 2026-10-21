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
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint Type; public INPUTUNION Data; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT Keyboard; [FieldOffset(0)] public MOUSEINPUT Mouse; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort Key,Scan; public uint Flags,Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
  static INPUT Key(ushort key,bool up){return new INPUT{Type=1,Data=new INPUTUNION{Keyboard=new KEYBDINPUT{Key=key,Flags=up?2u:0u}}};}
  public static void SendPaste(IntPtr target){
    IntPtr result;
    if(SendMessageTimeout(target,0,IntPtr.Zero,IntPtr.Zero,3,300,out result)==IntPtr.Zero)throw new Exception("目标窗口暂未响应，已取消粘贴");
    if(GetForegroundWindow()!=target)throw new Exception("焦点已切换到其他应用，已取消粘贴");
    var keys=new[]{Key(0x11,false),Key(0x56,false),Key(0x56,true),Key(0x11,true)};
    var sent=SendInput(4,keys,Marshal.SizeOf(typeof(INPUT)));
    if(sent!=4){if(sent>0)SendInput(2,new[]{Key(0x56,true),Key(0x11,true)},Marshal.SizeOf(typeof(INPUT)));throw new Exception("系统未接受粘贴按键，请确认目标应用的权限");}
  }
  public static void WaitForRelease(){
    for(int attempt=0;attempt<200;attempt++){
      bool held=false;foreach(int key in new[]{0x01,0x02,0x11,0x12,0x10,0x5B,0x5C,0x0D,0x56,0x50})if((GetAsyncKeyState(key)&0x8000)!=0)held=true;
      if(!held)return;Thread.Sleep(10);
    }
    throw new Exception("请松开鼠标和修饰键后重试");
  }
  public static void Restore(IntPtr target){
    if(GetForegroundWindow()!=target)SetForegroundWindow(target);
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
try { [ClipNative]::Listen(); [Console]::Out.WriteLine('READY') }
catch { [Console]::Out.WriteLine('READY_FALLBACK') }
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    if ($line -eq 'CAPTURE') { [Console]::Out.WriteLine([ClipNative]::GetForegroundWindow().ToInt64()); continue }
    if ($line -eq 'WAIT_KEYS') { [ClipNative]::WaitForRelease(); [Console]::Out.WriteLine('OK'); continue }
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
      [ClipNative]::WaitForRelease()
      $foreground = [ClipNative]::GetForegroundWindow()
      if ($parts.Length -gt 1 -and $foreground -ne $target -and $foreground -ne [IntPtr]([long]$parts[1])) { throw 'Focus changed; paste cancelled' }
      [ClipNative]::Restore($target)
      if ([ClipNative]::GetForegroundWindow() -ne $target) { throw 'Focus changed; paste cancelled' }
      [ClipNative]::SendPaste($target)
      [Console]::Out.WriteLine('OK')
    }
  } catch { [Console]::Out.WriteLine('ERROR ' + $_.Exception.Message) }
}
