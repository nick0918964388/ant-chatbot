# auto-pull.ps1 — 自動偵測遠端變更並 git pull (Windows PowerShell)
# 搭配 npm run dev 使用，pull 後 Next.js HMR 會自動 hot reload
#
# 使用方式：在另一個終端執行
#   .\auto-pull.ps1
#   .\auto-pull.ps1 -Branch "claude/taiwan-futures-backtest-DUpIR" -Interval 3

param(
    [string]$Branch = "claude/taiwan-futures-backtest-DUpIR",
    [int]$Interval = 5
)

Write-Host "=== Auto-Pull Watcher ===" -ForegroundColor Cyan
Write-Host "Branch: $Branch"
Write-Host "Interval: ${Interval}s"
Write-Host "按 Ctrl+C 停止"
Write-Host ""

while ($true) {
    git fetch origin $Branch 2>$null

    $local = git rev-parse HEAD 2>$null
    $remote = git rev-parse "origin/$Branch" 2>$null

    if ($local -ne $remote) {
        $time = Get-Date -Format "HH:mm:ss"
        Write-Host "[$time] 偵測到新 commit，正在 pull..." -ForegroundColor Yellow
        git pull origin $Branch
        Write-Host "[$time] 更新完成！Next.js HMR 會自動重載" -ForegroundColor Green
        Write-Host ""
    }

    Start-Sleep -Seconds $Interval
}
