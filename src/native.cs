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
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll",SetLastError=true)] static extern bool AttachThreadInput(uint from,uint to,bool attach);
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
  static void Paste(IntPtr target,IntPtr shelf){
    if(target==IntPtr.Zero||!IsWindow(target))throw new Exception("Target window is no longer available");
    bool released=false;var keys=new[]{0x01,0x02,0x11,0x12,0x10,0x5B,0x5C,0x0D};
    for(int attempt=0;attempt<200;attempt++){
      bool held=false;foreach(int key in keys)if((GetAsyncKeyState(key)&0x8000)!=0)held=true;
      if(!held){released=true;break;}Thread.Sleep(10);
    }
    if(!released)throw new Exception("请松开鼠标和修饰键后重试");
    var foreground=GetForegroundWindow();
    if(shelf!=IntPtr.Zero&&foreground!=shelf&&foreground!=target)throw new Exception("焦点已切换到其他应用，已取消粘贴");
    // The shelf receives the user's double click, but this helper is a separate
    // process. Share the current foreground input queue only for the handoff.
    // Never attach to the destination application (it may be unresponsive).
    uint pid;uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    uint ownThread=GetCurrentThreadId();bool attached=false;
    try {
      if(GetForegroundWindow()!=target){
        attached=foregroundThread!=0&&foregroundThread!=ownThread&&AttachThreadInput(ownThread,foregroundThread,true);
        SetForegroundWindow(target);
      }
    } finally { if(attached)AttachThreadInput(ownThread,foregroundThread,false); }
    // Activation between UI threads can complete after SetForegroundWindow returns.
    // Request it once, then wait for acknowledgement; never paste to another window.
    for(int attempt=0;attempt<60&&GetForegroundWindow()!=target;attempt++)Thread.Sleep(5);
    if(GetForegroundWindow()!=target)throw new Exception("无法恢复目标窗口焦点；未向其他窗口发送粘贴");SendKeys.SendWait("^v");
  }
  [STAThread] static void Main(){
    Console.OutputEncoding=new UTF8Encoding(false);
    // AttachThreadInput requires both threads to own a message queue. The
    // clipboard listener runs on another STA, so give this command thread one.
    var commandWindow=new NativeWindow();
    commandWindow.CreateHandle(new CreateParams{Parent=new IntPtr(-3)});
    try{Listen();Console.WriteLine("READY");}catch{Console.WriteLine("READY_FALLBACK");}
    string line;var json=new JavaScriptSerializer();
    while((line=Console.ReadLine())!=null){
      try{
        if(line=="CAPTURE")Console.WriteLine(GetForegroundWindow().ToInt64());
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
