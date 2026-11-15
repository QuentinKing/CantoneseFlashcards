# Tiny static web server for testing the flashcards app on Windows.
# No installs needed - uses .NET's built-in HttpListener.
#   Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8000] [-NoBrowser]
param([int]$Port = 8000, [switch]$NoBrowser)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'; '.json' = 'application/json'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'; '.m4a' = 'audio/mp4'; '.ogg' = 'audio/ogg'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
$url = "http://localhost:$Port/"
Write-Host "Cantonese Flashcards running at $url  (Ctrl+C to stop)"
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($path -eq '') { $path = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
