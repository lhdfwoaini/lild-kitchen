param([ValidateSet('scan','sync','build','check','pack','backup')][string]$Command = 'scan')
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimePython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $runtimePython)) { $runtimePython = (Get-Command python -ErrorAction Stop).Source }
Push-Location -LiteralPath $projectDir
try {
  & $runtimePython -B (Join-Path $PSScriptRoot 'kitchen.py') $Command
  if ($LASTEXITCODE -ne 0) { throw "Kitchen $Command failed. See the message above." }
} finally { Pop-Location }
