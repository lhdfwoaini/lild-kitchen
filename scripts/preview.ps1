$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'kitchen.ps1') build
& (Join-Path $PSScriptRoot 'kitchen.ps1') pack
$projectDir = Split-Path -Parent $PSScriptRoot
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectDir 'kitchen.config.json') | ConvertFrom-Json
$url = 'http://127.0.0.1:' + $config.previewPort + $config.previewBase
function Get-LocalRelease {
  $request = [Net.HttpWebRequest]::Create($url + 'release.json')
  $request.Proxy = $null
  $request.Timeout = 2500
  $response = $request.GetResponse()
  try {
    $reader = [IO.StreamReader]::new($response.GetResponseStream(), [Text.Encoding]::UTF8)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
  } finally { $response.Dispose() }
}
$ready = $false
try {
  $release = Get-LocalRelease
  if ($release.schema -ne 'lild-kitchen-release-v1') { throw 'Unexpected service on preview port.' }
  $ready = $true
} catch { }
if (-not $ready) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $logDir = Join-Path $projectDir '.local'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $server = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $PSScriptRoot 'preview.cjs') + '"') -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'preview.log') -RedirectStandardError (Join-Path $logDir 'preview-error.log')
  for ($i=0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 200
    if ($server.HasExited) { throw 'Preview service failed. See .local/preview-error.log.' }
    try { $release = Get-LocalRelease; if ($release.schema -eq 'lild-kitchen-release-v1') { $ready=$true; break } } catch { }
  }
}
if (-not $ready) { throw 'Preview did not become ready.' }
Start-Process $url
