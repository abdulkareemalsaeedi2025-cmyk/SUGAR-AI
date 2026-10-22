# Smart Sugar AI — autostart (Task Scheduler → AtLogOn).
# Starts the Next.js production server on :3003 and re-asserts the Tailscale funnel.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1) app server
$node = 'C:\Program Files\nodejs\node.exe'
Start-Process -FilePath $node -ArgumentList 'node_modules\next\dist\bin\next','start','-p','3003' -WorkingDirectory $root -WindowStyle Hidden

# 2) funnel (idempotent; tailscaled service is already up at boot)
Start-Sleep -Seconds 20
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg localhost:3003 | Out-Null
