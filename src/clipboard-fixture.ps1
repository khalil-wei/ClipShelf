$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type 'using System.Runtime.InteropServices; public static class FixtureSequence { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }'
$saved = New-Object System.Windows.Forms.DataObject
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$wasEmpty = $null -eq $original
if (-not $wasEmpty) {
  foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format, $false)
    if ($null -eq $value) { throw 'Cannot preserve a clipboard format; cancelled before writing' }
    if ($value -is [System.Drawing.Image]) { $value = $value.Clone() }
    elseif ($value -is [System.IO.MemoryStream]) { $value = New-Object System.IO.MemoryStream(,$value.ToArray()) }
    $saved.SetData($format, $false, $value)
  }
}
$ownedSequence = [uint32]0
$restored = $false
$fixtureFile = Join-Path ([System.IO.Path]::GetTempPath()) ('clipshelf-fixture-' + $PID + '.png')
$expectedWidth = 96; $expectedHeight = 64; $expectedR = 40; $expectedG = 120; $expectedB = 210
function Restore-FixtureClipboard {
  if ($restored -or $ownedSequence -eq 0) { return 'UNCHANGED' }
  if ([FixtureSequence]::GetClipboardSequenceNumber() -ne $ownedSequence) { return 'SKIPPED_NEW_CLIPBOARD' }
  if ($wasEmpty) { [System.Windows.Forms.Clipboard]::Clear() }
  else { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true, 5, 80) }
  return 'RESTORED'
}
[Console]::Out.WriteLine('READY')
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    try {
      if ($line -eq 'TEXT') {
        [System.Windows.Forms.Clipboard]::SetText('ClipShelf paste check')
        $ownedSequence = [FixtureSequence]::GetClipboardSequenceNumber()
        [Console]::Out.WriteLine('TEXT_READY')
      } elseif ($line -eq 'CHECK_TEXT') {
        if ([System.Windows.Forms.Clipboard]::GetText() -ne 'ClipShelf paste check') { throw 'Synthetic paste text no longer owns the clipboard' }
        $ownedSequence = [FixtureSequence]::GetClipboardSequenceNumber()
        [Console]::Out.WriteLine('TEXT_MATCH')
      } elseif ($line -eq 'IMAGE') {
        $bitmap = New-Object System.Drawing.Bitmap(96,64)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::FromArgb(255,40,120,210))
        $graphics.Dispose()
        [System.Windows.Forms.Clipboard]::SetImage($bitmap)
        $bitmap.Dispose()
        $ownedSequence = [FixtureSequence]::GetClipboardSequenceNumber()
        [Console]::Out.WriteLine('IMAGE_READY')
      } elseif ($line -eq 'FILE') {
        $bitmap = New-Object System.Drawing.Bitmap(80,48)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::FromArgb(255,220,90,40)); $graphics.Dispose()
        $bitmap.Save($fixtureFile, [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()
        $files = New-Object System.Collections.Specialized.StringCollection
        $null = $files.Add($fixtureFile)
        [System.Windows.Forms.Clipboard]::SetFileDropList($files)
        $expectedWidth = 80; $expectedHeight = 48; $expectedR = 220; $expectedG = 90; $expectedB = 40
        $ownedSequence = [FixtureSequence]::GetClipboardSequenceNumber()
        [Console]::Out.WriteLine('FILE_READY')
      } elseif ($line -eq 'CHECK') {
        $image = [System.Windows.Forms.Clipboard]::GetImage()
        if ($null -eq $image) { throw ('Native clipboard has no image; formats=' + ([System.Windows.Forms.Clipboard]::GetDataObject().GetFormats($false) -join ',')) }
        try {
          $pixel = $image.GetPixel(12,12)
          if ($image.Width -ne $expectedWidth -or $image.Height -ne $expectedHeight -or $pixel.R -ne $expectedR -or $pixel.G -ne $expectedG -or $pixel.B -ne $expectedB) { throw 'Unexpected image; clipboard may have changed' }
        } finally { $image.Dispose() }
        $ownedSequence = [FixtureSequence]::GetClipboardSequenceNumber()
        [Console]::Out.WriteLine('IMAGE_MATCH')
      } elseif ($line -eq 'RESTORE') {
        $result = Restore-FixtureClipboard
        $restored = $true
        [Console]::Out.WriteLine($result)
      }
    } catch { [Console]::Out.WriteLine('ERROR ' + $_.Exception.Message) }
  }
} finally {
  if (-not $restored) { $null = Restore-FixtureClipboard }
  if (Test-Path -LiteralPath $fixtureFile) { Remove-Item -LiteralPath $fixtureFile }
}
