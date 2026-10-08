# NovelAI Agent launcher — isolated from any other DeepSeek Harness install.
# Sets a private DSH_HOME (sessions, credentials, settings, skills all live in
# .novelai-home/ inside this repo) and routes NovelAI API traffic through the
# local proxy, then boots the web GUI on port 3081.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Private home: nothing is shared with ~/.dsh.
$env:DSH_HOME = Join-Path $root '.novelai-home'

# NovelAI API needs the local proxy to be reachable.
$env:NOVELAI_PROXY = 'http://127.0.0.1:7890'

# Load NOVELAI_TOKEN from .env if present (the harness also reads root .env).
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^(NOVELAI_TOKEN)=(.+)$' -and -not $env:NOVELAI_TOKEN) {
      Set-Item "env:$($Matches[1])" $Matches[2].Trim()
    }
  }
}

Write-Host "novelai-agent home: $env:DSH_HOME"
Write-Host "web GUI:            http://127.0.0.1:3082"
pnpm dsh web --port 3082
