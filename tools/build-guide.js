#!/usr/bin/env node
/**
 * 產生「操作說明書」——會計版與主管版各一個**單一 HTML 檔**。
 *
 *   node tools/build-guide.js        產到 guides/
 *
 * 圖片全部內嵌成 base64：手冊要用 LINE 傳、要能離線開、也可能被人另存到桌面，
 * 外部圖片路徑一定會斷。截圖來源 docs/guide-shots/（`?mode=local` 假資料模式拍的）。
 *
 * ⚠️ 手冊**不寫通行碼**：文案一律「請洽 Eason」。build 時逐字檢查，含正式密碼就中止。
 * ⚠️ guides/ 與 docs/guide-shots/ 都在 .gitignore：repo 是公開的，手冊含營運數字，
 *    要不要對外是另一個決定，不要順手推上去。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'guide-shots');
const OUT = path.join(ROOT, 'guides');
const REAL_PIN = '83575678';   // 正式通行碼：手冊裡絕對不可出現
const SITE = 'https://eason0728.github.io/mala-audit/';

const img = (name) => {
  const p = path.join(SHOTS, name + '.png');
  if (!fs.existsSync(p)) { console.error('缺少截圖：' + name); process.exit(1); }
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
};

const ICON = fs.readFileSync(path.join(ROOT, 'assets', 'icon-180.png')).toString('base64');
const FAVICON = fs.readFileSync(path.join(ROOT, 'assets', 'favicon-32.png')).toString('base64');

let stepNum = 0;
const resetStepNum = () => { stepNum = 0; };
const step = (title, body, shot, opts = {}) => {
  stepNum += 1;
  return `
  <section class="step">
    <div class="num">${stepNum}</div>
    <div class="body">
      <h3>${title}</h3>
      ${body}
      ${shot ? `<figure class="${opts.wide ? 'wide' : ''}"><img src="${img(shot)}" alt="${title}"></figure>` : ''}
    </div>
  </section>`;
};

const note = (t, body) => `<div class="callout"><b>${t}</b>${body}</div>`;
const warn = (t, body) => `<div class="callout warn"><b>${t}</b>${body}</div>`;

const CSS = `
:root{
  --ink:#1e2a3a; --dim:#6b7887; --line:#dfe4ea; --bg:#f5f7f9; --panel:#fff;
  --accent:#1F3A5F; --accent-soft:rgba(31,58,95,.09); --warn:#b5541f; --warn-soft:rgba(181,84,31,.08);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC","Segoe UI",sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:0 18px 80px}
header{background:var(--accent);color:#fff;padding:26px 0 22px;margin-bottom:26px}
header .in{max-width:820px;margin:0 auto;padding:0 18px;display:flex;align-items:center;gap:14px}
header img{width:52px;height:52px;border-radius:11px;display:block}
header h1{margin:0;font-size:22px;letter-spacing:.02em}
header p{margin:3px 0 0;font-size:13px;opacity:.85}
.lead{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:26px}
.lead p{margin:0 0 8px}
.lead p:last-child{margin:0}
.lead a{color:var(--accent);font-weight:700;word-break:break-all}
h2{font-size:15px;letter-spacing:.1em;color:var(--accent);margin:34px 0 14px;
   padding-bottom:8px;border-bottom:2px solid var(--accent-soft)}
.step{display:flex;gap:14px;margin-bottom:26px}
.num{flex:0 0 34px;height:34px;border-radius:50%;background:var(--accent);color:#fff;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}
.body{flex:1;min-width:0}
.body h3{margin:4px 0 8px;font-size:17px}
.body p{margin:0 0 10px}
figure{margin:12px 0 0;background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:10px;box-shadow:0 1px 2px rgba(30,45,60,.04),0 6px 18px rgba(30,45,60,.05)}
figure img{display:block;width:100%;max-width:330px;margin:0 auto;border-radius:7px}
figure.wide img{max-width:100%}
.callout{background:var(--accent-soft);border-left:4px solid var(--accent);border-radius:0 10px 10px 0;
  padding:12px 14px;margin:12px 0;font-size:15px}
.callout b{display:block;margin-bottom:3px}
.callout.warn{background:var(--warn-soft);border-left-color:var(--warn)}
.callout.warn b{color:var(--warn)}
ul{margin:0 0 10px;padding-left:22px}
li{margin-bottom:5px}
.qa{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 18px;margin-top:8px}
.qa dt{font-weight:700;margin-top:14px}
.qa dd{margin:4px 0 14px;color:var(--dim)}
footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--dim);font-size:13px}
b.k{background:var(--accent-soft);color:var(--accent);padding:1px 6px;border-radius:5px;font-size:14px}
@media print{
  body{background:#fff}
  header{background:var(--accent)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .step{page-break-inside:avoid}
  figure{box-shadow:none}
}`;

function page(title, subtitle, bodyHtml) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${FAVICON}">
<style>${CSS}</style>
</head>
<body>
<header><div class="in">
  <img src="data:image/png;base64,${ICON}" alt="稽核系統">
  <div><h1>${title}</h1><p>${subtitle}</p></div>
</div></header>
<div class="wrap">
${bodyHtml}
<footer>稽核系統｜鼎兆元　操作說明書　2026-08-01 版<br>
內容有疑問，或說明跟畫面不一樣，請告知 Eason。</footer>
</div>
</body>
</html>`;
}

// ══════════ 會計版 ══════════
resetStepNum();
const ACCT = page('稽核系統　會計操作說明', '到店現場用手機填，送出就完成，不用回辦公室重打', `
<div class="lead">
  <p><b>網址</b>　<a href="${SITE}">eason0728.github.io/mala-audit</a></p>
  <p>用手機瀏覽器開，<b>建議加到主畫面</b>（像 App 一樣點就開）。</p>
  <p style="color:var(--dim);font-size:14px">一次稽核就三件事：<b>抽 20 項複盤</b> → <b>查金庫</b> → <b>送出</b>。
  送出後數字自動寫回試算表，主管當下就看得到。</p>
</div>

<h2>開始之前</h2>
${step('輸入通行碼登入',
  `<p>開網址後會先問通行碼，輸入後按「登入」。</p>
   ${note('通行碼請洽 Eason', '每次重新開網址都要輸入一次（刻意不記住，手機借人也不會被看到資料）。')}`,
  '01-login')}
${step('總覽：看哪幾家還沒查',
  `<p>登入後看到的是 <b>5 家店 × 12 個月</b> 的格子，一眼看出進度：</p>
   <ul>
     <li>顯示<b>百分比</b>＝那個月已經查過，數字是複盤正確率</li>
     <li>顯示<b>輪休</b>＝那個月不查</li>
     <li>顯示 <b>—</b>＝還沒記錄</li>
   </ul>
   <p>點任何一個有百分比的格子，可以直接看那次的報告。</p>`,
  '02-overview')}

<h2>現場稽核：七步</h2>
${step('按「開始稽核」，選店與月份',
  `<p>選你現在人在的那一家店，月份預設是當月。</p>
   ${note('填到一半跑掉了？東西不會不見', '你打的每一個字都會即時存在手機裡。就算關掉網頁、手機沒電，回來都還在。<br>重新進來時系統會<b>直接回到你上次填的那一家店</b>；如果你當時填的是別家，畫面上方會出現「<b>未送出的草稿</b>」清單（哪家店、哪個月、填了幾項），點一下就接著填。確定不要了才按「丟棄」。')}`,
  '03-pick-store')}
${step('選填寫方式：完整 20 項，還是只填異常項',
  `<p>選完店和月份，下面有一排「填寫方式」，兩種擇一，選過會記住，下次開就是同一種。</p>
   <ul>
     <li><b>完整 20 項</b>：抽 20 項出來逐項填、逐項判定正確或異常。正確率＝清單裡判正確的項數 ÷ 清單項數。</li>
     <li><b>只填異常項</b>：<b>只打有問題的品項</b>，其他的一律視同正確。
       正確率<b>固定用 20 項當分母</b>——只填 1 項異常就是 19÷20＝<b>95%</b>，一項都沒填就是 100%。</li>
   </ul>
   ${note('要填的欄位一樣', '只填異常項模式下每一項還是要填門市盤點數、會計複盤數、異常原因——因為異常說明要靠這幾個數字組字。差別只在你不用把另外 19 項也敲一遍。')}
   ${note('品項不限品項庫，想打什麼都可以', '名稱框直接打就好。<b>品項庫裡有的</b>會自動帶單位；<b>庫裡沒有的</b>（臨時進的貨、新品）也照樣加得進來，只要在旁邊的小框填單位（包、盒、公斤…）。單位不能空——異常說明要印成「盤點27<b>盒</b>」，沒單位會缺一塊。<br>自己打的品項<b>只用在這一筆</b>，不會自動存進品項庫；要讓它每次都出現，再跟 Eason 說補進品項庫。')}
   ${warn('只填異常項時，明細不會留下「這 20 項是哪 20 項」', '試算表的「抽查明細」只會寫你輸入的那幾項異常。要逐項留痕就用完整 20 項模式。')}
   <p>異常填超過 20 項會擋下送出（分母只有 20，再多就算不出來了）。</p>`,
  '03b-anomaly-mode')}
${step('（完整模式）按「隨機抽 20 項」',
  `<p>系統會從那家店的品項庫隨機抽 20 項給你。只填異常項模式沒有這顆按鈕，直接打品項名稱加入就好。</p>
   ${note('抽過的品項會標「⚠ 2026-05 抽過」', '這只是<b>提醒你參考</b>，系統不會擋。想換就按「換一項」，覺得沒關係就照抽——抽哪 20 項由你決定。')}
   <p>不滿意可以：<b>換一項</b>、<b>刪除</b>、或用下方「加入品項」自己指定要查的東西
   （<b>不限品項庫</b>，庫裡沒有的自己打名稱＋單位一樣加得進來）。
   數量不是 20 項時會有黃字提醒，但不擋你送出。</p>`,
  '04-drawn')}
${step('每一項填兩個數字，然後判定',
  `<p><b>門市盤點數</b>＝門市月底自己盤的數字；<b>會計複盤數</b>＝你現場重盤的數字。</p>
   <p>填完按 <b>正確</b> 或 <b>異常</b>。</p>
   ${note('判定由你決定', '系統<b>不會自動比對</b>——差多少算可接受，是你的專業判斷，不是程式說了算。')}
   ${note('看到品項旁邊紅字「(缺單位)」', '那是品項庫當初沒登記單位的品項。該列會多一個<b>單位</b>小框，填一下（包、盒、公斤…）再送出。不填會擋著送不出去——因為異常說明要印成「盤點2.8<b>包</b>」，少了單位主管看不懂是多少。')}`,
  '05-row-correct')}
${step('判「異常」的要選原因',
  `<p>按下異常後會展開原因選單，選一個最接近的。選「其他」的話備註必填。</p>
   <p>原因分類目前有：盤點錯誤（門市盤錯）、損耗未記、單位混淆、進出貨未入帳、其他。</p>
   ${note('這些原因會累積成分析', '之後「異常分析」頁就是靠這個看出哪一類問題最常發生。要增減分類跟 Eason 說。')}`,
  '06-row-anomaly')}
${step('填金庫抽查',
  `<p>清單下面是金庫三項：</p>
   <ul>
     <li><b>零找金</b>／<b>零用金</b>：標準都是 1 萬，點「正確」或「不正確」</li>
     <li><b>小費金額</b>：填當下實際金額，再點與明細紀錄「相符」或「不相符」</li>
   </ul>
   ${note('小費不是累計', '每次填當下的金額就好，增加或減少都要跟明細紀錄比對。不用拍照。')}`,
  '07-vault')}
${step('按「送出稽核」',
  `<p>有沒填完的地方會擋下來並列出缺哪些，補完再送。</p>`,
  '08-validation')}
${step('送出成功會自動跳到報告',
  `<p>看到報告就代表<b>已經寫進試算表了</b>，主管當下就看得到，你不用再做任何事。</p>`,
  '09-report-month')}

<h2>會遇到的狀況</h2>
${step('那個月不查 → 標記輪休',
  `<p>總覽頁按「標記輪休」，選店和月份即可。試算表那一格會寫上「輪休」。</p>`,
  '12-mark-rest')}
${step('同一個月要重填 → 會先確認',
  `<p>如果那個月已經有紀錄，送出前會跳出提醒，告訴你將覆蓋哪一天的紀錄。</p>
   ${warn('確認後舊紀錄會被換掉', '不是新增一筆。確定要改才按「確認覆蓋送出」。')}`,
  '10-overwrite')}
${step('店裡收訊不好 → 填的東西不會不見',
  `<p>送出失敗時會出現「重試送出」。你填的內容都<b>存在手機裡</b>，走到有訊號的地方再按一次就好。</p>
   ${note('關掉網頁也還在', '同一支手機、同一家店同一個月再打開，會自動把填到一半的內容帶回來。')}`,
  '11-retry')}

<h2>常見問題</h2>
<dl class="qa">
  <dt>按了「隨機抽 20 項」只抽出幾項？</dt>
  <dd>那家店的品項庫還沒建齊。目前只有<b>小辛辣光復</b>是完整的（142 項）。
      其他店要把該店的庫存管理 PDF 給 Eason 補進去。</dd>

  <dt>抽到的品項店裡沒有／已經不賣了？</dt>
  <dd>按「刪除」拿掉，再用「加入品項」補一項進來。也可以跟 Eason 說把它從品項庫停用。</dd>

  <dt>品項後面沒有單位？</dt>
  <dd>有些品項在庫存表上本來就沒標單位，系統不會自己亂猜。不影響填寫與送出。</dd>

  <dt>送出之後發現填錯？</dt>
  <dd>重新選同一家店、同一個月再填一次送出，會出現覆蓋確認，確認後就是以新的為準。</dd>

  <dt>忘記通行碼？</dt>
  <dd>找 Eason。密碼不寫在系統裡也不寫在這份說明書。</dd>
</dl>
`);

// ══════════ 主管版 ══════════
resetStepNum();
const MGR = page('稽核系統　主管檢視說明', '看進度、看報告、印 PDF、看哪些品項一直出問題', `
<div class="lead">
  <p><b>網址</b>　<a href="${SITE}">eason0728.github.io/mala-audit</a></p>
  <p>手機或電腦都可以開。會計現場送出後，<b>你這邊立刻就看得到</b>，不用等她回辦公室。</p>
</div>

<h2>看進度</h2>
${step('登入後就是總覽',
  `<p>通行碼請洽 Eason。登入後看到 5 家店 × 12 個月的格子。</p>
   <ul>
     <li><b>百分比</b>＝已稽核，數字是複盤正確率（20 項裡對幾項）</li>
     <li><b>輪休</b>＝那個月不查</li>
     <li><b>—</b>＝還沒記錄</li>
   </ul>
   <p>點任何一個百分比的格子，直接看那次的報告。</p>`,
  '02-overview')}

<h2>看報告、印 PDF</h2>
${step('單月報告：一次稽核的完整內容',
  `<p>包含抽查明細（每項的盤點數、複盤數、判定、異常原因）、金庫結果、異常說明整段。</p>`,
  '13-report-wide', { wide: true })}
${step('年度總表：一家店的整年',
  `<p>切到「年度總表」，就是你原本在試算表上看的那個版面，12 個月一次看完。</p>`,
  '14-annual', { wide: true })}
${step('印出來或存成 PDF',
  `<p>按頁面下方的「列印／存 PDF」，在列印視窗選「儲存為 PDF」即可。</p>
   ${note('單月報告排成 A4 直式、年度總表橫式', '列印時導覽列與按鈕都會自動隱藏，只印報告內容。')}`,
  null)}

<h2>異常分析：哪些問題一直重複</h2>
${step('三張表看一次',
  `<ul>
     <li><b>累犯品項排行</b>：同一個品項被查出異常幾次、在哪幾家店、哪幾個月</li>
     <li><b>異常原因分類</b>：哪一類原因最多</li>
     <li><b>各店異常數</b>：含稽核次數與異常率，看得出比例而不只是絕對數</li>
   </ul>
   <p>上方可以選期間，只看某幾個月。</p>`,
  '15-analysis')}
${step('累犯排行怎麼看',
  `<p>次數越多代表這個品項反覆出狀況——通常不是偶發，而是<b>某個流程有問題</b>
   （盤點方式、單位換算、進出貨沒登記）。</p>
   ${note('目前資料的例子', '鴨血、米血、打拋醬各出現 2 次，其中鴨血是小辛辣光復和六張犁<b>兩家都中</b>——兩家都有，代表比較可能是共同流程的問題，不是單店個案。')}`,
  '16-analysis-repeat')}

<h2>常見問題</h2>
<dl class="qa">
  <dt>1–7 月的舊資料還在嗎？</dt>
  <dd>都在。原本試算表上的紀錄已經全部匯入，異常說明也自動拆成逐項明細了。
      舊資料當時沒有「異常原因」這個欄位，所以一律顯示「未分類」。</dd>

  <dt>試算表還能照舊打開來看嗎？</dt>
  <dd>可以。原本那五個分頁保留著，會計送出後系統會自動回寫，版面跟以前一樣。
      另外多了幾個分頁是系統存資料用的，不用去動它。</dd>

  <dt>要改異常原因的分類、或金庫的標準金額？</dt>
  <dd>在試算表的「設定」分頁改，改完系統立刻跟著變，不用改程式。</dd>

  <dt>可以讓某些人只能看不能改嗎？</dt>
  <dd>可以，系統有唯讀角色，目前沒啟用。要用的話跟 Eason 說。</dd>
</dl>
`);

// ── 產出 ─────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const files = [['guide-accountant.html', ACCT, '會計版'], ['guide-manager.html', MGR, '主管版']];
for (const [name, html, label] of files) {
  if (html.includes(REAL_PIN)) {
    console.error(name + ' 竟然含有正式通行碼，停止');
    process.exit(1);
  }
  const p = path.join(OUT, name);
  fs.writeFileSync(p, html);
  console.log(`${label}  ${path.relative(ROOT, p)}  ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
}
console.log('\n（guides/ 已在 .gitignore：repo 是公開的，手冊含營運數字，要不要對外另外決定）');
