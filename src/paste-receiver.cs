using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Separate Windows process with synthetic controls; never reads the clipboard.
internal static class PasteReceiver {
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint processId);
  [STAThread] static void Main() {
    Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
    Console.SetIn(new StreamReader(Console.OpenStandardInput(),Encoding.UTF8));
    Form window=null;TextBox first=null,second=null;
    var ready=new ManualResetEvent(false);
    var ui=new Thread(()=>{
      window=new Form{Text="ClipShelf controlled receiver",Width=540,Height=230,Left=60,Top=60,StartPosition=FormStartPosition.Manual};
      window.Controls.Add(new Label{Left=20,Top=10,Width=490,Height=35,Text="粘贴验收：请点第二行文本框，然后保持前台约 3 秒，不操作键鼠。"});
      first=new TextBox{Left=20,Top=55,Width=480,Text="unchanged"};
      second=new TextBox{Left=20,Top=105,Width=480,Text="before-after"};
      window.Controls.Add(first);window.Controls.Add(second);
      window.Shown+=(sender,args)=>{ShowWindow(window.Handle,5);second.Focus();second.SelectionStart=7;ready.Set();};
      window.FormClosed+=(sender,args)=>Environment.Exit(0);
      Application.Run(window);
    });
    ui.IsBackground=true;ui.SetApartmentState(ApartmentState.STA);ui.Start();
    if(!ready.WaitOne(10000))throw new Exception("Receiver did not open");
    Console.WriteLine("READY");var json=new JavaScriptSerializer();string line;
    while((line=Console.ReadLine())!=null){
      try {
        string result=null;
        window.Invoke((Action)(()=>{
          if(line=="HANDLE")result=window.Handle.ToInt64().ToString();
          else if(line=="RESET"){first.Text="unchanged";second.Text="before-after";second.Focus();second.SelectionStart=7;second.SelectionLength=0;result="OK";}
          else if(line=="VALUES")result=json.Serialize(new[]{first.Text,second.Text});
          else if(line.StartsWith("AUTHORIZE ")){if(GetForegroundWindow()!=window.Handle||!AllowSetForegroundWindow(uint.Parse(line.Substring(10))))throw new Exception("Activate the controlled receiver first");result="OK";}
          else throw new Exception("Unknown receiver command");
        }));
        Console.WriteLine(result);
      }catch(Exception error){Console.WriteLine("ERROR "+error.Message);}
    }
    window.BeginInvoke((Action)(()=>window.Close()));
  }
}
