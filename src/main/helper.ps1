# OpenBar helper: streams now-playing media (Windows SMTC) and network counters as JSON lines.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(3000)) { return $null }
  return $t.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$lastKey = ''
$lastArt = $null
while ($true) {
  $media = $null
  try {
    if ($mgr) {
      $s = $mgr.GetCurrentSession()
      if ($s) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $s.GetPlaybackInfo()
        $tl = $s.GetTimelineProperties()
        $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
        if ($key -ne $lastKey) {
          $lastKey = $key
          $lastArt = $null
          if ($p.Thumbnail) {
            $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            if ($stream) {
              $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
              $ms = New-Object System.IO.MemoryStream
              $net.CopyTo($ms)
              if ($ms.Length -gt 0 -and $ms.Length -lt 1500000) { $lastArt = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray()) }
              $net.Dispose(); $ms.Dispose()
            }
          }
        }
        $media = [ordered]@{
          app = $s.SourceAppUserModelId
          title = $p.Title
          artist = $p.Artist
          album = $p.AlbumTitle
          playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
          position = [math]::Round($tl.Position.TotalSeconds)
          duration = [math]::Round($tl.EndTime.TotalSeconds)
          art = $lastArt
        }
      }
    }
  } catch { $media = $null }

  $rx = 0; $tx = 0
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
    $st = $nic.GetIPStatistics()
    $rx += $st.BytesReceived; $tx += $st.BytesSent
  }
  $out = [ordered]@{ media = $media; net = @{ rx = $rx; tx = $tx; t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() } }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
