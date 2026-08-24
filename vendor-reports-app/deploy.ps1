# One-command deploy for the Vendor Reports app.
#
#   .\deploy.ps1              pulls the latest code and pushes it to monday
#   .\deploy.ps1 12345678     same, but to a specific app version id
#
# Update the default below whenever you create a new version in the
# Developer Center (find ids with: mapps app-version:list).
param([string]$VersionId = '17108106')

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot   # always run from the app folder, wherever invoked

Write-Host ''
Write-Host '== 1/3  Pulling latest code =='
git pull

Write-Host ''
Write-Host "== 2/3  Pushing to monday (version $VersionId) =="
mapps code:push -i $VersionId

Write-Host ''
Write-Host '== 3/3  Deployment status =='
mapps code:status -v $VersionId

Write-Host ''
Write-Host 'Done. Reload the app preview (or the workspace page) to see it.'

# Keep the window open when launched by double-click / right-click,
# so the result is readable before it disappears.
if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' }
