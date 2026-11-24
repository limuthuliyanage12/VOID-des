# Run once in an ADMINISTRATOR PowerShell. It:
#   1. turns the installed MongoDB service into a single-node replica set (rs0), which VOID's transactions need
#   2. installs Memurai Developer (Redis for Windows) for BullMQ
# Afterwards, in a normal shell: node scripts/init-replset.mjs
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with "Run as administrator" and run this script again.'
}

$cfg = Get-ChildItem 'C:\Program Files\MongoDB\Server\*\bin\mongod.cfg' | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $cfg) { throw 'MongoDB Server is not installed. Run: winget install MongoDB.Server' }
$text = Get-Content $cfg.FullName -Raw
if ($text -notmatch '(?m)^replication:') {
  Copy-Item $cfg.FullName "$($cfg.FullName).bak" -Force
  $text = $text -replace '(?m)^#replication:\s*$', "replication:`r`n  replSetName: rs0"
  Set-Content -Path $cfg.FullName -Value $text -Encoding UTF8
  Write-Host "Added replSetName rs0 to $($cfg.FullName) (backup saved as .bak)"
} else { Write-Host 'Replication is already configured.' }
Restart-Service MongoDB
Write-Host 'MongoDB restarted.'

if (-not (Get-Service Memurai -ErrorAction SilentlyContinue)) {
  winget install --id Memurai.MemuraiDeveloper -e --accept-package-agreements --accept-source-agreements
} else { Write-Host 'Memurai is already installed.' }
Write-Host "`nDone. Now run (not as admin):  node scripts/init-replset.mjs"
