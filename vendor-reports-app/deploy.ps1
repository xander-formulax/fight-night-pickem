# One-command deploy for the Vendor Reports app.
#
#   .\deploy.ps1              finds the current draft version and pushes to it
#   .\deploy.ps1 19565315     pushes to a specific app version id
#
# Promoting a draft to live is deliberately NOT done here — that stays a
# human decision in the Developer Center.

param([string]$VersionId = '')

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot        # run from the app folder, wherever invoked

$AppId = '11946690'               # Vendor Reports

function Pause-IfClicked {
  if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' }
}

Write-Host ''
Write-Host '== 1/4  Pulling latest code =='
git pull

if (-not $VersionId) {
  Write-Host ''
  Write-Host '== 2/4  Looking for the draft version =='
  # The CLI prints a table; the draft row carries the version id as its first
  # long number. Beats hardcoding an id that goes stale on every promote.
  $rows = mapps app-version:list -i $AppId 2>&1
  foreach ($line in $rows) {
    $text = "$line"
    if ($text -match "'draft'" -and $text -match '(\d{7,})') {
      $VersionId = $matches[1]
      break
    }
  }
  if (-not $VersionId) {
    Write-Host ''
    Write-Host 'No draft version found — every version is live or deprecated.' -ForegroundColor Yellow
    Write-Host 'In the Developer Center: Vendor Reports -> Manage -> App Versions -> + New version,'
    Write-Host 'then run this again.'
    Pause-IfClicked
    exit 1
  }
  Write-Host "Draft version is $VersionId"
} else {
  Write-Host ''
  Write-Host "== 2/4  Using version $VersionId =="
}

Write-Host ''
Write-Host '== 3/4  Pushing to monday =='
mapps code:push -i $VersionId

Write-Host ''
Write-Host '== 4/4  Deployment status =='
mapps code:status -v $VersionId

Write-Host ''
Write-Host 'Done. Reload the app preview (or the workspace page) to see it.'
Write-Host 'Happy with it? Promote to live in the Developer Center.'
Pause-IfClicked
