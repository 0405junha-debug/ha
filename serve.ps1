param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (-not $root.EndsWith("\")) { $root = $root + "\" }

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".png"  = "image/png"
  ".gif"  = "image/gif"
  ".wasm" = "application/wasm"
  ".svg"  = "image/svg+xml"
  ".json" = "application/json; charset=utf-8"
}

function Get-QueryMap([string]$query) {
  $map = @{}
  if (-not $query) { return $map }
  $text = $query.TrimStart("?")
  foreach ($pair in $text.Split("&")) {
    if (-not $pair) { continue }
    $kv = $pair.Split("=", 2)
    $name = [System.Uri]::UnescapeDataString($kv[0])
    $value = ""
    if ($kv.Length -gt 1) { $value = [System.Uri]::UnescapeDataString(($kv[1] -replace "\+", " ")) }
    $map[$name] = $value
  }
  return $map
}

function Write-Response($response, $status, $contentType, [byte[]]$bytes) {
  if (-not $bytes) { $bytes = New-Object byte[] 0 }
  $response.StatusCode = $status
  $response.ContentType = $contentType
  $response.Headers.Add("Access-Control-Allow-Origin", "*")
  $response.Headers.Add("Cache-Control", "no-cache")
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

function Search-Giphy([string]$q) {
  $q = ($q.Trim() -replace "[\\/]", " ")
  if (-not $q) { return '{"data":[]}' }
  $searchUrl = "https://giphy.com/search/" + [System.Uri]::EscapeDataString($q)
  $page = Invoke-WebRequest -Uri $searchUrl -UseBasicParsing -Headers @{ "User-Agent" = "Mozilla/5.0" }
  $ids = New-Object System.Collections.Generic.List[string]
  foreach ($match in [regex]::Matches($page.Content, '/gifs/[^"\\]+-([A-Za-z0-9]{4,})')) {
    $id = $match.Groups[1].Value
    if (-not $ids.Contains($id)) { $ids.Add($id) }
    if ($ids.Count -ge 24) { break }
  }
  $items = @()
  foreach ($id in $ids) {
    $items += @{
      id = $id
      title = $q
      preview = "https://media.giphy.com/media/$id/200.gif"
      url = "https://media.giphy.com/media/$id/giphy.gif"
      page = "https://giphy.com/gifs/$id"
    }
  }
  return (@{ data = $items } | ConvertTo-Json -Compress -Depth 4)
}

$listener = $null
$port = 0
foreach ($candidate in 8765..8775) {
  $trial = New-Object System.Net.HttpListener
  $trial.Prefixes.Add("http://127.0.0.1:$candidate/")
  try {
    $trial.Start()
    $listener = $trial
    $port = $candidate
    break
  } catch {
    try { $trial.Close() } catch {}
  }
}

if (-not $listener) {
  Write-Host "Could not open a local port."
  exit 1
}

$site = "http://127.0.0.1:$port/"
Write-Host "GIF converter: $site"
Write-Host "Keep this window open."
if (-not $NoBrowser) { Start-Process $site }

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  try {
    $path = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    $query = Get-QueryMap $request.Url.Query

    if ($path -eq "/health") {
      Write-Response $response 200 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("ok"))
      continue
    }

    if ($path -eq "/api/giphy") {
      try {
        $json = Search-Giphy ([string]$query["q"])
        Write-Response $response 200 "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($json))
      } catch {
        Write-Response $response 502 "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes('{"data":[]}'))
      }
      continue
    }

    if ($path -eq "/api/giphy-file") {
      $gifUrl = [string]$query["url"]
      $okHost = $false
      try {
        $uri = [System.Uri]$gifUrl
        $okHost = $uri.Scheme -eq "https" -and $uri.Host -match '(^|\.)giphy\.com$'
      } catch { $okHost = $false }
      if (-not $okHost) {
        Write-Response $response 400 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("bad url"))
        continue
      }
      try {
        $gif = Invoke-WebRequest -Uri $gifUrl -UseBasicParsing -Headers @{ "User-Agent" = "Mozilla/5.0" }
        Write-Response $response 200 "image/gif" $gif.Content
      } catch {
        Write-Response $response 502 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("fetch failed"))
      }
      continue
    }

    if ($path -eq "/") { $path = "/index.html" }
    $relative = $path.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    $allowed = $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
    if ($request.HttpMethod -eq "GET" -and $allowed -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = "application/octet-stream" }
      Write-Response $response 200 $type ([System.IO.File]::ReadAllBytes($full))
    } else {
      Write-Response $response 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not found"))
    }
  } catch {
    Write-Host $_
    try { $context.Response.Abort() } catch {}
  }
}
