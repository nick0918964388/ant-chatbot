#!/bin/bash
# auto-pull.sh — 自動偵測遠端變更並 git pull
# 搭配 npm run dev 使用，pull 後 Next.js HMR 會自動 hot reload
#
# 使用方式：在另一個終端執行
#   chmod +x auto-pull.sh
#   ./auto-pull.sh

BRANCH="${1:-claude/taiwan-futures-backtest-DUpIR}"
INTERVAL="${2:-5}"  # 預設每 5 秒檢查一次

echo "=== Auto-Pull Watcher ==="
echo "Branch: $BRANCH"
echo "Interval: ${INTERVAL}s"
echo "按 Ctrl+C 停止"
echo ""

while true; do
  # 取得遠端最新狀態
  git fetch origin "$BRANCH" 2>/dev/null

  LOCAL=$(git rev-parse HEAD 2>/dev/null)
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$(date '+%H:%M:%S')] 偵測到新 commit，正在 pull..."
    git pull origin "$BRANCH"
    echo "[$(date '+%H:%M:%S')] 更新完成！Next.js HMR 會自動重載"
    echo ""
  fi

  sleep "$INTERVAL"
done
