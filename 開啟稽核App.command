#!/bin/bash
# 雙擊這個檔案 → 起本機伺服器並用瀏覽器打開稽核系統（本機測試版，MODE=local）
# 資料存在瀏覽器裡（mock），怎麼玩都不會動到真的 Google 試算表。
# 關掉這個終端機視窗就會停止伺服器。
cd "$(dirname "$0")" || exit 1

PORT=8899
while lsof -ti:$PORT >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "麻的小辛辣／鼎兆元 稽核系統（本機測試版）"
echo "網址：http://127.0.0.1:$PORT/index.html"
echo "會計通行碼 1234　主管通行碼 5678"
echo "（關閉此視窗即停止；資料只存在瀏覽器，不會寫到雲端）"
echo

sleep 1 && open "http://127.0.0.1:$PORT/index.html" &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
