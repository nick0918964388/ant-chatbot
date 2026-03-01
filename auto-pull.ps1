# auto-pull.ps1 - Auto-detect remote changes and git pull (Windows PowerShell)
# Works with "npm run dev" - Next.js HMR will hot reload after pull
#
# Usage:
#   .\auto-pull.ps1
#   .\auto-pull.ps1 -Branch "claude/taiwan-futures-backtest-DUpIR" -Interval 3

param(
    [string]$Branch = "claude/taiwan-futures-backtest-DUpIR",
    [int]$Interval = 5
)

Write-Host "=== Auto-Pull Watcher ===" -ForegroundColor Cyan
Write-Host "Branch: $Branch"
Write-Host "Interval: ${Interval}s"
Write-Host "Press Ctrl+C to stop"
Write-Host ""

while ($true) {
    git fetch origin $Branch 2>$null

    $local = git rev-parse HEAD 2>$null
    $remote = git rev-parse "origin/$Branch" 2>$null

    if ($local -ne $remote) {
        $time = Get-Date -Format "HH:mm:ss"
        Write-Host "[$time] New commit detected, pulling..." -ForegroundColor Yellow
        git pull origin $Branch
        Write-Host "[$time] Done! Next.js HMR will auto reload" -ForegroundColor Green
        Write-Host ""
    }

    Start-Sleep -Seconds $Interval
}
