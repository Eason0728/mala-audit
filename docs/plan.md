# 稽核系統 — plan.md（技術方案：開發階段切分）
版本：v1 / 2026-08-01（spec.md v1 已確認；task.md 是本檔的任務展開）

**目標**：會計現場手機 key 稽核、送出即入 sheet、主管網頁即時看，含 PDF 報告與異常原因分析。
**架構**：靜態前端（vanilla JS 單頁）＋ Apps Script Web App（madesiaosinla@gmail.com）＋既有 sheet
（新增四個資料分頁為正本、五張分表為顯示層回寫）。
**技術**：無框架、無 build step；POST text/plain JSON；MODE local/cloud 雙模。

## 全域約束（每個任務都隱含這些，違反＝該任務不過）

- 枚舉與格式**逐字元**照 spec.md §5 共用契約（店代碼、record_key、正確/異常/相符/輪休、異常說明組字）。
- UI 全繁體中文；設計走「一個乾淨大方向」，不灑小裝飾。
- 通行碼只存 sheet 設定分頁、由後端驗證；**任何密碼不進 repo**（調撥系統鐵則）。
- git：T1 就 `git init`，每個任務完成即本地 commit；**push／部署／寫真 sheet 一律先問 Eason**（鐵律 1）。
- 每任務 100–200 行內；node 可測的邏輯（format/sampling/Code.gs 純函式）都附 `test/` 下的測試。
- UI 驗證用 webapp-testing（Playwright headless），不用 Browser pane 截圖（凍結陷阱）。

## 檔案地圖

```
~/mala-audit/
  index.html                 單頁殼（五分頁）
  css/base.css  css/print.css
  js/config.js               MODE + GAS_URL
  js/format.js               組字/月份/正確率/record_key（純函式）
  js/sampling.js             抽樣＋歷史標記（純函式）
  js/mock-data.js            種子資料（品項庫＋1–7月歷史樣本）
  js/api.js                  Api 介面（mock 與 cloud 同介面）
  js/app.js                  session/分頁切換
  js/views/{login,overview,audit,report,analysis}.js
  apps-script/Code.gs        doPost 分流＋setup＋importHistory
  test/*.test.js             node 直跑
  docs/                      四份文件＋sheet-map.md＋部署步驟.md
  開啟稽核App.command         雙擊本機開啟（同巡檢）
```

## 階段切分（里程碑優先）

| Phase | 內容 | 里程碑（驗收） | 任務 |
|---|---|---|---|
| 1 | 前端全流程＋mock 後端 | **Eason 本機可玩完整流程**（登入→抽樣→填寫→送出→總覽/報告/分析/列印） | T1–T7 |
| 2 | Apps Script 後端＋本機整測 | 假伺服器全 action 跑通；歷史異常字串解析測資全過 | T8–T11 |
| 3 | 部署與真資料 | 真 sheet 實測一筆成功；1–7 月匯入與備份逐月對帳一致 | T12–T14 |
| 4 | 正式上線收尾 | GitHub Pages 上線＋圖示＋skill/路由表/記憶補登 | T15–T16 |

## 停點（要 Eason 點頭才過）

- **停點 A**（Phase 1 末）：mock 版交 Eason 玩，確認 UI/流程。Phase 2 純寫 code 可並行先做，不卡這裡。
- **停點 B**（T12→T13）：部署 GAS、跑 setup/importHistory 動真 sheet 之前——先做整表備份＋問過才執行；
  clasp 需要 madesiaosinla@gmail.com 授權一次（Eason 操作，步驟文件會先備好）。
- **停點 C**（T15）：前端 push GitHub Pages 之前問過。

## 執行方式

照 institution/model-dispatch 派工：實作任務派 sonnet subagent（交辦 prompt 抄 delegation-templates，
附 spec §5 契約全文），主對話只做驗收把關與跨任務一致性檢查；收尾用 fresh-context 複驗。

## 風險與停損

- 五張分表實際列欄與假設不符 → T8 先盤結構產 sheet-map.md，回寫座標只寫在 Code.gs 常數表一處。
- 歷史異常字串格式不齊（已看到「蟹黃醬:19.4包」缺「盤點」二字的變體）→ regex 解析失敗的整段進備註欄，
  不硬塞；對帳表列出 fallback 筆數給 Eason 裁決。
- 正確率欄若是既有公式 → 回寫改成只寫來源數字，公式自算（T8 確認後定案）。
- clasp／帳號授權卡住超過一次來回 → 改用部署指南讓 Eason 網頁編輯器貼一次（最後手段，Apps Script 工作流原則仍以 clasp 優先）。
