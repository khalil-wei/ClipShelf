using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Same line protocol as native.ps1, without retaining a PowerShell runtime.
internal static class ClipNative {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out IntPtr result);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint Type; public INPUTUNION Data; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT Keyboard; [FieldOffset(0)] public MOUSEINPUT Mouse; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort Key,Scan; public uint Flags,Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
  static INPUT Key(ushort key,bool up){return new INPUT{Type=1,Data=new INPUTUNION{Keyboard=new KEYBDINPUT{Key=key,Flags=up?2u:0u}}};}
  static void SendPaste(){
    var keys=new[]{Key(0x11,false),Key(0x56,false),Key(0x56,true),Key(0x11,true)};
    var sent=SendInput(4,keys,Marshal.SizeOf(typeof(INPUT)));
    if(sent!=4){if(sent>0)SendInput(2,new[]{Key(0x56,true),Key(0x11,true)},Marshal.SizeOf(typeof(INPUT)));throw new Exception("系统未接受粘贴按键，请确认目标应用的权限");}
  }
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] static extern bool AddClipboardFormatListener(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle,out RECT rect);
  static string Source(){try{uint pid;GetWindowThreadProcessId(GetClipboardOwner(),out pid);using(var process=Process.GetProcessById((int)pid))return process.ProcessName.Replace("\r","").Replace("\n","");}catch{return "";}}
  sealed class Listener : NativeWindow {
    internal Listener(){CreateHandle(new CreateParams{Parent=new IntPtr(-3)});if(!AddClipboardFormatListener(Handle))throw new Exception("Clipboard listener registration failed");}
    protected override void WndProc(ref Message message){if(message.Msg==0x031D)Console.WriteLine("CLIPBOARD "+GetClipboardSequenceNumber()+" "+Source());base.WndProc(ref message);}
  }
  static void Listen(){
    using(var ready=new ManualResetEvent(false)){
      Exception failure=null;
      var thread=new Thread(()=>{try{var listener=new Listener();ready.Set();Application.Run();GC.KeepAlive(listener);}catch(Exception error){failure=error;ready.Set();}});
      thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
      if(!ready.WaitOne(5000))throw new Exception("Clipboard listener timed out");if(failure!=null)throw failure;
    }
  }
  static void WaitForRelease(){
    bool released=false;var keys=new[]{0x01,0x02,0x11,0x12,0x10,0x5B,0x5C,0x0D,0x56,0x50};
    for(int attempt=0;attempt<200;attempt++){
      bool held=false;foreach(int key in keys)if((GetAsyncKeyState(key)&0x8000)!=0)held=true;
      if(!held){released=true;break;}Thread.Sleep(10);
    }
    if(!released)throw new Exception("请松开鼠标和修饰键后重试");
  }
  static void Paste(IntPtr target,IntPtr shelf){
    if(target==IntPtr.Zero||!IsWindow(target))throw new Exception("Target window is no longer available");
    WaitForRelease();
    var foreground=GetForegroundWindow();
    if(shelf!=IntPtr.Zero&&foreground!=shelf&&foreground!=target)throw new Exception("焦点已切换到其他应用，已取消粘贴");
    // The foreground Electron process grants this helper activation rights
    // after the initiating mouse/key release. No input queues are attached.
    if(GetForegroundWindow()!=target)SetForegroundWindow(target);
    // Activation between UI threads can complete after SetForegroundWindow returns.
    // Request it once, then wait for acknowledgement; never paste to another window.
    for(int attempt=0;attempt<60&&GetForegroundWindow()!=target;attempt++)Thread.Sleep(5);
    if(GetForegroundWindow()!=target)throw new Exception("无法恢复目标窗口焦点；未向其他窗口发送粘贴");
    IntPtr result;
    if(SendMessageTimeout(target,0,IntPtr.Zero,IntPtr.Zero,3,300,out result)==IntPtr.Zero)throw new Exception("目标窗口暂未响应，已取消粘贴");
    if(GetForegroundWindow()!=target)throw new Exception("焦点已切换到其他应用，已取消粘贴");
    SendPaste();
  }
  [STAThread] static void Main(){
    Console.OutputEncoding=new UTF8Encoding(false);
    try{Listen();Console.WriteLine("READY");}catch{Console.WriteLine("READY_FALLBACK");}
    string line;var json=new JavaScriptSerializer();
    while((line=Console.ReadLine())!=null){
      try{
        if(line=="CAPTURE")Console.WriteLine(GetForegroundWindow().ToInt64());
        else if(line=="WAIT_KEYS"){WaitForRelease();Console.WriteLine("OK");}
        else if(line=="SOURCE")Console.WriteLine(Source());
        else if(line=="SEQUENCE")Console.WriteLine(GetClipboardSequenceNumber());
        else if(line=="FILES"){var files=Clipboard.GetFileDropList();var values=new string[files.Count];files.CopyTo(values,0);Console.WriteLine(json.Serialize(values));}
        else if(line=="IMAGE_READY"){using(var image=Clipboard.GetImage())Console.WriteLine(image==null?"NO":"YES");}
        else if(line.StartsWith("BOUNDS ",StringComparison.Ordinal)){RECT rect;Console.WriteLine(GetWindowRect(new IntPtr(long.Parse(line.Substring(7),CultureInfo.InvariantCulture)),out rect)?rect.Left+","+rect.Top+","+(rect.Right-rect.Left)+","+(rect.Bottom-rect.Top):"0,0,0,0");}
        else if(line.StartsWith("PASTE ",StringComparison.Ordinal)){var parts=line.Substring(6).Split(' ');Paste(new IntPtr(long.Parse(parts[0],CultureInfo.InvariantCulture)),parts.Length>1?new IntPtr(long.Parse(parts[1],CultureInfo.InvariantCulture)):IntPtr.Zero);Console.WriteLine("OK");}
        else throw new Exception("Unknown native command");
      }catch(Exception error){Console.WriteLine("ERROR "+error.Message.Replace("\r"," ").Replace("\n"," "));}
    }
  }
}
