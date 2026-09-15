/* ══════════════════════════════════════════════════════════════
   site.js — 全站共用的畫面層程式
   ──────────────────────────────────────────────────────────────
   改版前這些函式在 12 個頁面裡各複製一份，而且寫法還不統一
   （有的有 .catch，多數沒有），修一個 bug 要改 12 個檔案。

   內容：
     ① 資料時間戳章 renderTimestamps()
     ② 導覽列狀態點 setNavStatus()
     ③ nav / footer 片段載入 loadNav() / loadFooter()
     ④ 交易連結 csfloatBuyUrl() / steamMarketUrl() / tradeLinksHtml(…, sides)
     ⑤ 流動性分級 liquidityTier() / liquidityChipHtml()
     ⑥ 冷卻期 COOLDOWN_DAYS / unlockAt() / cooldownText()
     ⑦ 特賣時程 STEAM_SALES / nextSale()
     ⑧ 行事曆 icsCalendar() / downloadIcs()
     ⑨ 單與持有清單 readOrders() / readHoldings() / holdingsToParamV4() / 匯出匯入
        含買到數量與實付金額（lots），見該節開頭的格式說明
        追蹤網址 holdingsTrackUrl() / copyText() / saveHoldingsToDevice()
     ⑩ 初始設定與時間成本 isSetupDone() / opMinutes() / worthVerdict()
     ⑪ Steam 手續費換算 steamNetUsd()（毛額 → 淨額，與後端同一套算法）
     ⑫ 資格快檢狀態 readEligibility() / eligibilityState()
     ⑬ 台幣顯示格式 fmtTwd()（兩位小數）／ roundTwd()（寫入前收斂）
     ⑭ 匯率 FX_CARD_FEE_RATE / buyRate()（買進側要多 1.5% 國外交易費）
     ⑮ Steam 台幣手續費 steamNetTwd()（下限 NT$1／分量，四捨五入不是捨去）
        ⑮-c 保本掛價 breakEvenAskTwd()（掛多少以上這一批不會是負收益）
        以及 twdView()：一列 cases_data → 該顯示的台幣數字（四頁共用）
     ⑯ 單品歷史 historySeries() / coolingStats() / historyChartSvg()（case.html 的兩張卡，只用每日中位數）
     ⑰ 品項圖片 CASE_ICONS / caseIconUrl() / caseIconHtml()（熱連 Steam CDN，圖不進 repo）

   引用方式（放在 </body> 前，或用 defer）：
     <script defer src="assets/site.js?v=…"></script>
   各頁自己的 <script> 要在 site.js 之後執行才拿得到這些函式。

   ⚠️⚠️ 那個 ?v= 不是裝飾，改 site.js 就要跟著改，見下面 SITE_JS_VERSION。
   ══════════════════════════════════════════════════════════════ */

/* ── ⓪ 快取破壞版本號 ───────────────────────────────────────
   ⚠️⚠️ **改了 site.js 的行為，就把這個字串跟每個 HTML 的 `?v=` 一起改掉。**

   為什麼要有它（2026-09-04 真的發生過）：
     GitHub Pages 對靜態檔發 `max-age=600`，而 HTML 與 site.js 是兩個獨立的
     快取項目，**不保證同時過期**。那天新的 calculator.html 先到、site.js 還是
     快取裡的舊版，新頁面呼叫一個舊版沒有的函式 → 整頁報成「資料讀取失敗」，
     十分鐘後自己好。錯誤訊息後來改成會叫人強制重新整理，但那是處理症狀：
     只要哪次改動讓某個 HTML 依賴 site.js 的新函式，那十分鐘的窗口就會再來一次。
     `?v=` 換掉的是 **URL**，新 HTML 一定配到新 site.js，窗口直接消失。

   規矩：
     - 值用日期。同一天改第二次就加字母：`2026-09-05b`。
     - 只有「site.js 的內容變了」才要動。改 HTML 不用動。

   ➡️ **不用手動改 17 個檔**：`node tools/bump-site-version.js`（先 `--dry` 看一遍）。

   ⚠️ **2026-09-06 想過要不要加「純註解不用動」的例外，決定不加。** 成本不對稱：
        該 bump 沒 bump   → 整頁報「資料讀取失敗」十分鐘（2026-09-04 真的發生過，難重現難診斷）
        不用 bump 卻 bump → 訪客多下載一次 site.js（完全無感）
      而例外需要**每次判斷**，判斷錯的代價就是上面那一格。**簡單規矩活得久，聰明的例外活不久。**
      要解的是那 17 個檔的摩擦，不是規矩——所以有了上面那支腳本。
     - 忘了改會被擋下來：test-holdings.js 最後那段靜態檢查會紅
       （對不上 SITE_JS_VERSION、或哪個 HTML 沒帶 `?v=`，兩種都會紅）。
   ⚠️ nav.html / footer.html 是 site.js 用 fetch() 拉的，不走這條，
      它們沒有「新頁面依賴新片段」的耦合，所以刻意不加。 */
var SITE_JS_VERSION = '2026-09-15';

/* ── ① 資料時間戳章 ─────────────────────────────────────────
   用法：<span class="ts-chip" data-source="steam" data-updated="ISO 字串"></span>
   三態門檻（分鐘）依資料來源的更新頻率設定。 */
/* ⚠️⚠️ 抓價頻率的**唯一來源**（2026-09-06 新增）。

   真值在 `code/db/scheduler_pg_cron.sql`：
     CSFloat  '43 1,4,7,10,13,16,19,22 * * *'  → 每 3 小時，8 次/天
     Steam    '17 1,9,17 * * *'                → 每 8 小時，3 次/天

   為什麼要有這個常數：2026-08-23 把 Steam 從 6 小時降成 8 小時，**只改了
   workflow**——faq / marketlist / transparency / design-system 四頁還寫著
   「Steam 每 6 小時」，對使用者說錯話說了 14 天，而 transparency 那頁的整個
   賣點就是「資料多久更新一次」。根因是同一個事實散在五個地方、沒有單一來源。
   ➡️ `test-holdings.js` 有一條靜態檢查，掃每個 HTML 講的頻率跟這裡比對。
   ⚠️ 改了排程就改這裡，然後跑那支測試找出所有要跟著改的頁面。 */
var FETCH_INTERVAL_HOURS = { csfloat: 3, steam: 8 };

/* 三態門檻（分鐘）。

   ⚠️⚠️ **`aging` 一定要大於抓價間隔**，否則系統正常運作時也會轉黃。
      2026-09-06 修正前就是這樣：Steam 間隔 8 小時、aging 卻是 6 小時，
      **每一輪保證有 2 小時多是黃的**；CSFloat 間隔 3 小時、aging 也是 3 小時，
      每輪結尾必然短暫轉黃（抓價本身要 4 分鐘，還有 Actions 啟動延遲）。
      一個在系統正常時就會亮的警示燈，資訊量是零——這跟 4.22「警語響了照樣
      推薦」是同一類問題的另一面：**警語響太多，於是沒人看**。

   規則：`aging = 抓價間隔 + 1 小時`（容忍一輪的合理延遲）。
   ⚠️ `stale` 沒有跟著動，也不要順手動——它的意思是「不要拿這個數字做決定」，
      往鬆的方向調需要獨立的理由。 */
var TS_RULES = {
  csfloat: { label: 'CSFloat', aging: (3 + 1) * 60, stale: 360 },   // 4h / 6h
  steam:   { label: 'Steam',   aging: (8 + 1) * 60, stale: 720 },   // 9h / 12h
  rate:    { label: '匯率',     aging: 720,          stale: 1440 }   // 12h / 24h（一天更新一次）
};
var TS_WARN_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 3l9 16H3l9-16z" stroke-linejoin="round"/><path d="M12 9v4M12 16v.01" stroke-linecap="round"/></svg>';

function tsAgo(min) {
  if (min < 1) return '剛剛更新';
  if (min < 60) return min + ' 分鐘前更新';
  var h = Math.floor(min / 60);
  if (h < 24) return h + ' 小時前更新';
  return Math.floor(h / 24) + ' 天前更新';
}

function renderTimestamps(root) {
  var scope = root || document;
  var chips = scope.querySelectorAll('.ts-chip[data-updated]');
  for (var i = 0; i < chips.length; i++) {
    var el = chips[i];
    var rule = TS_RULES[el.getAttribute('data-source')] || TS_RULES.csfloat;
    var t = Date.parse(el.getAttribute('data-updated'));
    if (isNaN(t)) {
      el.setAttribute('data-state', 'stale');
      el.innerHTML = TS_WARN_SVG + '<span class="ts-src">' + rule.label + '</span><span>沒有更新時間</span>';
      continue;
    }
    var min = Math.max(0, Math.round((Date.now() - t) / 60000));
    var state = min >= rule.stale ? 'stale' : (min >= rule.aging ? 'aging' : 'normal');
    el.setAttribute('data-state', state);
    el.setAttribute('title', rule.label + ' 資料抓取時間：' + new Date(t).toLocaleString('zh-TW', { hour12: false }));
    el.innerHTML =
      (state === 'stale' ? TS_WARN_SVG : '<span class="ts-dot"></span>') +
      '<span class="ts-src">' + rule.label + '</span>' +
      '<span>' + tsAgo(min) + (state === 'stale' ? '・資料過舊' : '') + '</span>';
  }
}

renderTimestamps();
setInterval(function () { renderTimestamps(); }, 60000);

/* ── ② 導覽列的資料狀態點 ────────────────────────────────────
   state：'fresh' | 'aging' | 'stale'
   nav.html 是非同步載入的，所以 setNavStatus() 可能比 nav 早執行。
   這裡把最後一次的狀態記下來，nav 載入完成後會自動補套用。 */
var _pendingNavStatus = null;

function setNavStatus(state, text) {
  _pendingNavStatus = { state: state, text: text };
  var s = document.getElementById('data-status');
  if (!s) return; // nav.html 還沒載入完，等 loadNav() 完成後會自動補上
  s.dataset.state = state;
  var label = s.querySelector('.ds-text');
  if (label) label.textContent = text;
}

/* 依資料的更新時間自動判斷三態，各頁抓完資料後呼叫這個就好。 */
function setNavStatusFromTime(isoString, source) {
  if (!isoString) return setNavStatus('stale', '沒有更新時間');
  var t = Date.parse(isoString);
  if (isNaN(t)) return setNavStatus('stale', '沒有更新時間');
  var rule = TS_RULES[source] || TS_RULES.csfloat;
  var min = Math.max(0, Math.round((Date.now() - t) / 60000));
  var state = min >= rule.stale ? 'stale' : (min >= rule.aging ? 'aging' : 'fresh');
  setNavStatus(state, '資料 ' + tsAgo(min));
}

/* ── ③ nav / footer 片段載入 ────────────────────────────────
   pageID 對應 nav.html 裡的 id="nav-xxx" 與 data-page="xxx"。 */
function loadNav(pageID) {
  return fetch('nav.html')
    .then(function (response) {
      if (!response.ok) throw new Error('nav.html 載入失敗（' + response.status + '）');
      return response.text();
    })
    .then(function (htmlText) {
      var doc = new DOMParser().parseFromString(htmlText, 'text/html');

      // 目前頁面的連結標記為 active（桌機與手機選單都要）
      var highlight = doc.getElementById('nav-' + pageID);
      if (highlight) {
        highlight.classList.remove('text-slate-300', 'hover:text-cyan-400');
        highlight.classList.add('text-cyan-400', 'bg-slate-900/50');
        highlight.setAttribute('aria-current', 'page');
      }
      var mobile = doc.querySelector('[data-page="' + pageID + '"]');
      if (mobile) {
        mobile.style.color = '#22d3ee';
        mobile.setAttribute('aria-current', 'page');
      }

      var mount = document.getElementById('nav');
      if (mount) mount.innerHTML = doc.body.innerHTML;

      // nav 進場後補套用先前設過的資料狀態
      if (_pendingNavStatus) setNavStatus(_pendingNavStatus.state, _pendingNavStatus.text);
    })
    .catch(function (err) {
      console.error('[site.js] loadNav:', err);
    });
}

function loadFooter() {
  return fetch('footer.html')
    .then(function (response) {
      if (!response.ok) throw new Error('footer.html 載入失敗（' + response.status + '）');
      return response.text();
    })
    .then(function (htmlText) {
      var doc = new DOMParser().parseFromString(htmlText, 'text/html');
      var mount = document.getElementById('footer');
      if (mount) mount.innerHTML = doc.body.innerHTML;
    })
    .catch(function (err) {
      console.error('[site.js] loadFooter:', err);
    });
}

/* ── ④ 交易連結 ─────────────────────────────────────────────
   對應 PROJECT_OVERVIEW.md 待辦 Tier1 #12「每個品項加上前往購買連結」，
   同時把 Tier0 #2 從首頁拿掉的「一鍵導向對應交易網址」承諾補回來。

   CSFloat：用資料庫的 CSFloat_ID（也就是 CSFloat API 的 def_index）定位，
     網址帶 sort_by=lowest_price & type=buy_now，和 upsert_CSfloat_cases.py
     抓價時用的參數一致——使用者點進去看到的第一筆，就是本站報價的那一筆。
     沒有 CSFloat_ID 的品項回傳 null（呼叫端要顯示停用狀態），
     不要亂猜一個會 404 或導到不相干商品的網址。

   Steam：市場頁網址就是 market_hash_name，而 cases_data.name 存的正是
     market_hash_name（兩支抓價腳本都以此欄位 upsert），可以直接組。
     730 是 CS2 的 appid。 */
function csfloatBuyUrl(defIndex) {
  if (defIndex === null || defIndex === undefined || String(defIndex).trim() === '') return null;
  return 'https://csfloat.com/search?def_index=' + encodeURIComponent(defIndex)
       + '&sort_by=lowest_price&type=buy_now';
}

function steamMarketUrl(marketHashName) {
  if (!marketHashName) return null;
  return 'https://steamcommunity.com/market/listings/730/' + encodeURIComponent(marketHashName);
}

function tradeEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 表格用的交易連結。外部連結一律 rel="noopener noreferrer"，
   避免新分頁透過 window.opener 反向操作本站頁面。

   第三個參數 `sides` 決定要出哪幾顆（2026-08-22 新增）：

     'both'（預設）  買 + 賣。**比較型頁面**用——marketlist 是 ROI 排行、
                     checklist 下單前要自己核對，這兩頁使用者是在「看兩邊」。
     'buy'           只出 CSFloat 買。試算頁用。
     'sell'          只出 Steam 賣。賣出頁用。

   ⚠️ **這不是版面精簡，是不要給錯的出口。** 試算頁上你還沒有東西可以賣，
      賣出頁上箱子已經在你的庫存裡、再去 CSFloat 買一次是完全不同的動作。
      在那兩頁擺另一邊的按鈕，等於在使用者正要動手的那一刻遞給他一個
      會做錯事的連結——尤其 Steam 那顆點過去是市集掛單頁，長得跟
      「可以在這裡賣」很像，但實際上要從庫存點「出售」才對。 */
function tradeLinksHtml(defIndex, name, sides) {
  var want = sides || 'both';
  var safeName = tradeEscape(name);
  var out = '<span class="trade-links">';
  if (want !== 'sell') {
    var buy = csfloatBuyUrl(defIndex);
    out += buy
      ? '<a class="trade-link trade-buy" href="' + tradeEscape(buy) + '" target="_blank" rel="noopener noreferrer"'
        + ' aria-label="到 CSFloat 買 ' + safeName + '（另開分頁）">CSFloat 買</a>'
      : '<span class="trade-link trade-off" title="資料庫還沒有這個品項的 CSFloat ID">CSFloat 買</span>';
  }
  if (want !== 'buy') {
    var sell = steamMarketUrl(name);
    out += sell
      ? '<a class="trade-link trade-sell" href="' + tradeEscape(sell) + '" target="_blank" rel="noopener noreferrer"'
        + ' aria-label="到 Steam 市場看 ' + safeName + '（另開分頁）">Steam 賣</a>'
      : '<span class="trade-link trade-off">Steam 賣</span>';
  }
  return out + '</span>';
}

/* ── ⑤ 流動性分級 ───────────────────────────────────────────
   資料來源是 cases_data.steam_volume，也就是 Steam priceoverview 回傳的
   「近 24 小時成交量」。這一段對應 DECISIONS.md 4.8。

   為什麼需要它：實測品項之間的流動性差 3,901 倍（最高 97,544、最低 25），
   而且**與單價反向**——低流動性那組的平均單價是 US$63.85，高流動性那組
   只有 US$0.50。使用者為了湊 NT$3,000–5,000 的客單會傾向選高單價品項，
   但那些一天只成交 25 個，掛上去可能好幾天賣不掉，資金被鎖的時間遠超
   7 天冷卻期。這正是 risks.html「成交不保證」那條的量化版本。

   ⚠️ 分級門檻是「量級」不是精算值，刻意取 10 的次方對齊人的直覺。
      門檻若要調整，理由請寫進 commit message——這是會影響使用者決策的
      數字，不該無聲改動。

   ⚠️ 這裡只呈現事實，不做預測。**不要**在這裡加「預估幾小時賣掉」——
      那需要假設「你的掛單佔成交量的多少比例」，是推測不是資料，與
      「資料庫存的是稅後實拿淨值」那個核心正確性標準不一致。 */
var LIQUIDITY_TIERS = [
  { min: 20000, key: 'high',     label: '高流動',  note: '一天成交上萬個，掛上去通常很快賣掉。' },
  { min: 1000,  key: 'mid',      label: '中流動',  note: '一天成交數千個，正常情況下不難賣。' },
  { min: 100,   key: 'low',      label: '低流動',  note: '一天只成交數百個，買多了可能要等幾天。' },
  { min: 0,     key: 'verylow',  label: '極低流動', note: '一天成交不到 100 個。掛上去可能好幾天沒人買，資金會被鎖更久。' }
];

/* 回傳 { key, label, note, volume } —— 沒有資料時 key 是 'unknown'。
   「沒有資料」與「成交量是 0」是兩件事，不要混在一起顯示。 */
function liquidityTier(volume) {
  if (volume === null || volume === undefined || volume === '' || isNaN(Number(volume))) {
    return { key: 'unknown', label: '無資料', note: '這個品項還沒有成交量資料。', volume: null };
  }
  var v = Number(volume);
  for (var i = 0; i < LIQUIDITY_TIERS.length; i++) {
    if (v >= LIQUIDITY_TIERS[i].min) {
      var t = LIQUIDITY_TIERS[i];
      return { key: t.key, label: t.label, note: t.note, volume: v };
    }
  }
  return { key: 'verylow', label: '極低流動', note: LIQUIDITY_TIERS[3].note, volume: v };
}

/* 極低流動性要不要另外警示。marketlist 用它決定要不要在該列加標記。 */
function isThinLiquidity(volume) {
  return liquidityTier(volume).key === 'verylow';
}

/* ── ⑤-b 買進側深度（2026-08-14）───────────────────────────────
   `csfloat_inventory` 是「與最低掛牌價完全相同」的掛售筆數，不是總庫存。
   那個價位可能只有 1 件——2026-08-14 抓到 Sealed Genesis Terminal
   US$0.05 × 1 件，倍率因此是 x2.00，於是：
     · marketlist 排到第 1 名（第 2 名只有 x1.53）
     · marketlist 的 KPI「目前最佳加成」顯示 100.00%
     · 首頁 hero 顯示「省 50%」、最佳倍率 2.00、收益滑桿整條用 2.00 校準
   而首頁自己的表格寫的是「13–30%（稅後）」——**網站在自打嘴巴**。
   見 DECISIONS.md 4.14。

   ⚠️ 門檻放在這裡是為了三頁一致。marketlist 標示、首頁挑代表值、
      以後其他頁要用，都讀同一個常數——一旦各頁各立一套，
      同一個品項在 A 頁被排除、在 B 頁被當成最佳，使用者會直接不信這個站。

   ⚠️ 取 2：實測 45 個品項有 15 個（33%）落在門檻內。比例不低，但那是市場的
      實際狀態。放寬到 3 會超過 40%，標示密到失去指示作用。

   ⚠️ 這條與流動性（`steam_volume`）是兩件事，不要混用：
      深度講的是「買得到幾件」，流動性講的是「賣不賣得掉」。 */
var DEPTH_WARN_MAX = 2;

/* 這個品項在最低價位的掛售筆數，少到不足以代表市場嗎？
   ⚠️ 沒有庫存資料時回傳 true（視為不足）——「沒資料」不等於「深度夠」，
      放行等於用未知冒充合格，與流動性篩選那邊同一個原則。 */
function isThinDepth(inventory) {
  if (inventory === null || inventory === undefined || inventory === '') return true;
  var n = Number(inventory);
  if (isNaN(n)) return true;
  return n <= DEPTH_WARN_MAX;
}

/* 深度過淺的警示標記。marketlist 用它在「CSFloat 成本」格加標。 */
function depthWarnHtml(inventory) {
  if (inventory === null || inventory === undefined) return '';
  var n = Number(inventory);
  if (!(n > 0) || n > DEPTH_WARN_MAX) return '';
  return '<span class="liq-warn">'
       + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">'
       + '<path d="M12 3l9 16H3l9-16z" stroke-linejoin="round"/><path d="M12 9v4M12 16v.01" stroke-linecap="round"/></svg>'
       + '<span>此價只有 ' + n + ' 件</span>'
       + '</span>';
}

function formatVolume(v) {
  if (v === null || v === undefined || isNaN(Number(v))) return '--';
  return Number(v).toLocaleString('en-US');
}

/* 分級標籤 + 原始數字。分級讓人看得懂，數字讓人可以自己驗證。

   外層包一個 .cell-stack：表格的 <td> 在手機卡片模式下是
   `display:flex; justify-content:space-between`，直接放兩個並列元素會被
   拉開到兩端（標籤在左、數字被推到最右）。包成單一元素就只佔一個
   flex item，桌機與手機的排版都跟同列其他欄位一致。 */
function liquidityChipHtml(volume) {
  var t = liquidityTier(volume);
  var count = t.volume === null ? '無資料' : formatVolume(t.volume) + ' / 日';
  return '<span class="cell-stack">'
       + '<span class="liq-chip" data-tier="' + t.key + '" title="' + tradeEscape(t.note) + '">'
       + '<span class="liq-dot" aria-hidden="true"></span>'
       + '<span class="liq-label">' + tradeEscape(t.label) + '</span>'
       + '</span>'
       + '<span class="liq-count t-note c-ink3">' + tradeEscape(count) + '</span>'
       + '</span>';
}

/* ── ⑥ 冷卻期 ───────────────────────────────────────────────
   從物品進到庫存那一刻起算 7 天，期間不能交易、不能上架 Steam 市場。

   ⚠️ 這 7 天其實同時受兩套機制限制，但**它們平行跑、不疊加**：
     ① 2018 年的交易冷卻期：收到後 7 天不能再交易或上架
     ② 2025-07 的 Trade Protection：同樣 7 天，期間寄送方可反轉交易
   兩者同時起算、同時結束，所以等待時間就是 7 天，不是 14 天。
   也因為兩者同時結束，「賣掉之後才被反轉」在機制上不會發生。
   見 DECISIONS.md 4.10。 */
var COOLDOWN_DAYS = 7;
var COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/* ⚠️⚠️ 起算點是「**收到物品**」，不是「下單」。上面那張表兩欄都寫
   「收到物品時」——但網站到 2026-08-29 為止拿的是購物清單頁的**勾選時間**，
   而勾選時間 ≈ 你在 CSFloat 按下購買那一刻。

   CSFloat 是掛單制：你付完錢之後，賣家才會去送交易報價，**不保證即時**。
   所以拿下單時間算出來的解鎖時刻是一個**下界**——實際只會更晚，不會更早。
   解法是讓使用者記錄真正的到貨時間（購物清單每一批的「物品到了」）；
   沒記錄時就照實用下單時間，並且**標成估計值、文案講「最快」**。

   ⚠️⚠️ **這裡曾經有一個 `TRANSFER_BUFFER_DAYS = 1`，2026-08-29 當天就拿掉了。
      不要再加回來。**

      當時使用者回報「時間追蹤要多加一天」，我據此加了一天緩衝。後來查明
      那個回報是**行事曆造成的誤會**：`.ics` 事件原本是**全天事件**，只有
      日期沒有時間——一批在當地時間 23:00 解鎖的箱子，行事曆整天都掛在
      那一天的頂端，早上看到就跑去賣，當然還鎖著。
      **7 天從來沒有不夠，是提醒沒有把時刻講出來。**
      真正的修法是把事件改成定時事件（sell.html 的 buildCooldownIcs）。

   ⚠️ 教訓：使用者回報的是**症狀**（「要多加一天」），不是**病因**。改動
      核心常數之前先問一句「有沒有一個純顯示的問題會產生一模一樣的症狀」——
      這次就有。而且加緩衝會讓真正的 bug 更難被發現：提醒晚一天響，看起來
      就對了，全天事件在說謊這件事永遠不會浮上來。
      同一類錯誤 4.7 犯過一次：拿毛額比淨額，憑空生出一個 −13% 的假缺口。

   ⚠️ **下界要誠實，不要偷偷加碼。** 加一個猜的數字讓它「看起來準一點」，
      結果是兩邊都不對——既不是下界也不是實際值，而且沒有人知道那個數字
      是哪來的。要精確就記錄到貨時間，那才是真的答案。 */

/* 這一批的冷卻期要從哪一刻起算。回傳 { at, isEstimate }。

     有到貨時間   → 就是那一刻，isEstimate = false
     只有下單時間 → 下單那一刻（下界），isEstimate = true
     兩個都沒有   → { at: null, isEstimate: true }

   ⚠️ **全站只有這一個地方決定起點。** 賣出頁、購物清單、行事曆各判一次
      就是 PROJECT_OVERVIEW〈三個會重複踩的坑〉第 1 條那種「各自重算、
      邏輯分歧」——而這裡分歧的後果是同一批箱子在兩個頁面上解鎖日不同。
   ⚠️ isEstimate 要一路帶到畫面上。使用者有權知道「這個日期是猜的」，
      不然他會把估計值當成 Steam 的保證。 */
function cooldownStart(boughtAt, arrivedAt) {
  if (arrivedAt) {
    var a = Date.parse(arrivedAt);
    if (!isNaN(a)) return { at: new Date(a).toISOString(), isEstimate: false };
  }
  var b = boughtAt ? Date.parse(boughtAt) : NaN;
  if (isNaN(b)) return { at: null, isEstimate: true };
  return { at: new Date(b).toISOString(), isEstimate: true };
}

/* ⚠️ 參數是**冷卻期起點**（cooldownStart().at），不是下單時間。
      直接餵下單時間進來會少算那一天的緩衝。 */
function unlockAt(startAt) {
  var t = startAt ? Date.parse(startAt) : NaN;
  return isNaN(t) ? null : new Date(t + COOLDOWN_MS);
}

/* 回傳 { state, days, text }。
   state：'locked'（還在冷卻）｜'ready'（可以賣了）｜'unknown'（沒有時間）
   isEstimate：起點是估計的（沒填到貨時間），文案要講「最快」。 */
function cooldownText(startAt, now, isEstimate) {
  var u = unlockAt(startAt);
  if (!u) return { state: 'unknown', days: null, text: '沒有記錄購買時間' };
  var ms = u.getTime() - (now || Date.now());
  /* ⚠️ 估計的起點就算算到 0 也只能說「應該可以賣了」。說死「可以賣了」
     而 Steam 那邊還鎖著，使用者會覺得是網站在騙他。 */
  if (ms <= 0) return { state: 'ready', days: 0, text: isEstimate ? '應該可以賣了' : '可以賣了' };
  var days = Math.ceil(ms / 86400000);
  var hours = Math.ceil(ms / 3600000);
  var lead = isEstimate ? '最快' : '';
  return {
    state: 'locked',
    days: days,
    text: hours <= 24 ? (lead + '約 ' + hours + ' 小時後解鎖') : (lead + '還有 ' + days + ' 天解鎖')
  };
}

/* ── ⑦ 特賣時程 ─────────────────────────────────────────────
   Valve 提前半年公布整年時程（Steamworks 每年兩份公告），所以這張表
   一年更新一次就夠，零維護。時間是 UTC。

   ⚠️ **只放已經由 Valve 正式公布的檔期，不要推測。** 2027 年的日期
      在對方公布之前保持空白——這一頁寧可說「還不知道」，也不要放一個
      看起來很確定但其實是猜的日期。使用者會拿它安排七天前的買進時機。

   ⚠️ 為什麼提醒要設在**特賣前 10 天**而不是特賣當天：
      冷卻期是 7 天，看到特賣才開始買就一定來不及。春秋兩檔各只有
      7–8 天，比冷卻期還短。見 DECISIONS.md 4.9。 */
var SALE_LEAD_DAYS = 10;
var STEAM_SALES = [
  { key: 'autumn2026', name: '秋季特賣', start: '2026-10-01T17:00:00Z', end: '2026-10-08T17:00:00Z' },
  { key: 'winter2026', name: '冬季特賣', start: '2026-12-17T18:00:00Z', end: '2027-01-04T18:00:00Z' }
];
/* 已經過去的 2026 檔期（保留備查，不進行事曆）：
   春季 3/19–3/26、夏季 6/25–7/9 */

function nextSale(now) {
  var t = now || Date.now();
  for (var i = 0; i < STEAM_SALES.length; i++) {
    if (Date.parse(STEAM_SALES[i].end) > t) return STEAM_SALES[i];
  }
  return null; // 表已過期，要更新 STEAM_SALES
}

/* 買進期限＝特賣開始前 7 天（冷卻期長度）。

   ⚠️ 2026-09-06 更正：原本這裡寫「這是精確的時間點」，那句站不住。
      完整鏈路是：
        買 → 到貨 → 冷卻 7 天 → 掛單 → 成交（不保證即時，4.8 量到流動性差 3,901 倍）
           → Steam 待處理餘額 ≤24h → 錢才真的能花
      「精確」的前提是成交與入帳都是瞬間的，兩個都不成立。

   ⚠️⚠️ 修法**不是**往 COOLDOWN_DAYS 加緩衝——4.18 明文禁止，那次加緩衝
      掩蓋了 .ics 全天事件的顯示 bug。冷卻期還是 7 天，沒變；**這個算式不動**。
      改的是那個「精確」的宣稱：呼叫端一律講「最晚／趕得上這一檔」，
      並把尾巴講出來。見 DECISIONS.md 4.27。 */
function buyByDate(sale) {
  var s = Date.parse(sale.start);
  return isNaN(s) ? null : new Date(s - COOLDOWN_MS);
}

/* 給畫面用的「最晚買進日」——回傳一個**整天**，那天之內任何時候買都來得及。

   ⚠️ 為什麼不能直接顯示 buyByDate 的日期：特賣是 17:00 UTC 開始，
      減 7 天之後是 UTC 17:00，換成台灣時間變成隔天凌晨 01:00。
      直接格式化會顯示成 9/25，但實際上 9/25 早上 2 點就已經遲了——
      使用者看到「最晚 9/25」而在 9/25 晚上買，會整批卡在冷卻期裡
      錯過整檔特賣。

   所以取「完全落在期限之前的最後一個整天」。這會比實際期限保守
   最多不到一天，而保守的方向是安全的——跟 CSFLOAT_BUYER_FEE_RATE
   刻意高估成本是同一個原則：寧可讓使用者早一點，不可讓他遲到。 */
function buyByDisplayDate(sale) {
  var d = buyByDate(sale);
  if (!d) return null;
  var local = new Date(d.getTime());
  // 期限當地時間若不是剛好午夜，那一整天就不算安全，退一天
  var isMidnight = local.getHours() === 0 && local.getMinutes() === 0 && local.getSeconds() === 0;
  if (!isMidnight) local = new Date(local.getTime() - 86400000);
  return new Date(local.getFullYear(), local.getMonth(), local.getDate());
}

/* ── ⑧ 行事曆（.ics） ───────────────────────────────────────
   為什麼用行事曆而不是 email：不需要帳號、不需要收 email（沒有個資法
   義務）、沒有 Gmail 每日 100 封的上限，而且離線也會提醒。見
   STRATEGY.md 第二節。

   ⚠️ 行事曆的目的不是取代造訪，是**造成造訪**——每個事件都要帶
      回到賣出頁的連結。 */

function icsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStampUTC(d) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
       + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}
/* 全天事件用 DATE 型別（沒有時間、沒有時區），提醒才不會因為時區
   而跑到前一天晚上。

   ⚠️⚠️ **冷卻期到期提醒已經不用全天事件了**（2026-08-29）。全天事件只有
      日期沒有時刻，而解鎖是一個精確的瞬間——一批當地時間 23:00 解鎖的
      箱子，全天事件整天掛在那一天的頂端，使用者早上看到就跑去 Steam，
      結果還鎖著。**使用者回報的「7 天好像不夠、要多加一天」就是這個**，
      冷卻期本身從來沒錯。見 sell.html 的 buildCooldownIcs。
   ⚠️ 這個函式留著給**真的是全天**的事件用（特賣檔期、最晚買進日）——
      那些本來就是「那一整天都算數」，沒有時刻可言。
      判準：這件事有沒有一個精確的發生時刻？有 → 定時事件。 */
function icsDate(d) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}
function icsDatePlusDays(d, n) {
  return icsDate(new Date(d.getTime() + n * 86400000));
}

/* RFC 5545 要求每行不超過 75 個八位元組，超過要折行（續行開頭放一個空白）。
   ⚠️ 中文是 UTF-8 三個位元組，所以必須依**位元組**數折，而且不能把一個
      字元從中間切開——切開的話 Google 行事曆會顯示成亂碼。 */
function icsFold(line) {
  var out = '', len = 0, limit = 74; // 留 1 給續行的空白
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    var code = ch.charCodeAt(0);
    var bytes = code < 0x80 ? 1 : (code < 0x800 ? 2 : 3);
    if (len + bytes > limit) { out += '\r\n '; len = 1; limit = 74; }
    out += ch; len += bytes;
  }
  return out;
}

/* events：[{ uid, start:Date, allDayDays:number|null, end:Date|null,
              summary, description, url, alarmDaysBefore:number|null }] */
function icsCalendar(events, calName) {
  var now = new Date();
  var lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Steam 加值幫手//TW//ZH',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(calName || 'Steam 加值幫手'),
    'X-WR-TIMEZONE:Asia/Taipei'
  ];
  events.forEach(function (e) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + e.uid);
    lines.push('DTSTAMP:' + icsStampUTC(now));
    if (e.allDayDays) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(e.start));
      lines.push('DTEND;VALUE=DATE:' + icsDatePlusDays(e.start, e.allDayDays));
    } else {
      lines.push('DTSTART:' + icsStampUTC(e.start));
      lines.push('DTEND:' + icsStampUTC(e.end || new Date(e.start.getTime() + 3600000)));
    }
    lines.push('SUMMARY:' + icsEscape(e.summary));
    if (e.description) lines.push('DESCRIPTION:' + icsEscape(e.description));
    if (e.url) lines.push('URL:' + icsEscape(e.url));
    lines.push('TRANSP:TRANSPARENT'); // 不要讓它把你的行事曆標成忙碌
    if (e.alarmDaysBefore != null) {
      /* ⚠️ 定時事件的「當下提醒」要寫 `-PT0M` 不是 `-P0D`。
         `-P0D` 在部分行事曆（iOS 曾實測過）會被當成「當天的預設時刻」
         而不是「事件開始的那一刻」，於是提醒又跑回早上——那正是
         2026-08-29 要修掉的那個症狀。天數 > 0 或全天事件才用 D。 */
      var trigger = (!e.allDayDays && e.alarmDaysBefore === 0)
        ? '-PT0M'
        : ('-P' + e.alarmDaysBefore + 'D');
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + icsEscape(e.summary),
        'TRIGGER:' + trigger, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function downloadIcs(text, filename) {
  downloadText(text, filename, 'text/calendar');
}

/* ── ⑨ 持有清單 ─────────────────────────────────────────────
   資料來源沿用購物清單那一套，不另起一份：
     sah-combo-v1                計畫買什麼（試算頁寫入）
     sah-checklist-checked-v1    實際買到什麼、幾個、多少錢、什麼時候

   ## 為什麼要記「實際買到幾個」（2026-08-22）

   舊版的勾選是布林值，數量直接沿用試算頁的**計畫值**。但 CSFloat 上
   一次買 20 個常常買不到 20 個——`csfloat_price_depth` 存在的理由就是
   「最低價買不到那麼多」，而 `csfloat_depth_count < 10` 直接代表湊不到
   10 件。**部分成交是常態，不是例外。**

   計畫 20 只買到 13，卻整條算下去當成 20，後果不只是總額錯：
   `DECISIONS.md` 4.7 要量的「預期 vs 實際」會把一個**數量錯誤**
   偽裝成**價格缺口**，而那正是 4.7 已經踩過一次的坑。

   ➡️ 這個欄位同時是產品資料：計畫 20 / 買到 13 = 可買到率 65%，
      是目前唯一能驗證 `csfloat_price_depth` 與 `csfloat_inventory`
      的東西（schema 註解說 inventory 有 250 截斷問題）。
      買入側沒有任何替代來源——賣出側至少還有 median 可以對照。

   ## 格式（v3）

     { "品項名": { lots: [ { at, qty, paidTwd } ], closed: bool } }

     at       ISO 字串。**這一批**的購買時間，也就是這一批冷卻期的起點
     qty      這一批實際買到幾個。null = 沒填，退回用計畫數量並標為估計
     paidTwd  這一批實付**總額**（NT$）。null = 沒填
     closed   true = 買不到了，剩下的放棄。與「還沒買完」是兩件事

   ⚠️ **paidTwd 記總額，不記單價。** 部分成交本來就是好幾筆不同價格的
      掛單湊起來的，「單價」這個東西在那種情況下不存在，只有總額是真的。

   ⚠️ **lots 是陣列，因為分批買一定會發生。** 今天買 13、明天補 7，
      兩批的解鎖日差一天，冷卻期必須各算各的。這也是為什麼一開始就用
      陣列而不是單一物件——這個 key 的格式已經改過一次了，不要再改第三次。

   ⚠️ **沒填的數量一律當「不知道」，不要當 0，也不要靜默當成計畫數量。**
      兩個方向都是替使用者宣稱一件他沒說過的事，跟指南頁「只做一次」那條
      「`unknown` / `no` 不自動帶入」是同一個原則。退回計畫數量可以，
      但一定要帶著 `qtyIsEstimate` 讓畫面標示出來。

   ## 向下相容

     v1  ["A","B"]            純名稱陣列，沒有時間也沒有數量
     v2  { "A": "ISO" }       有時間，沒有數量
     v3  { "A": { lots… } }   現行

   舊資料沒有時間就退回用 combo 的 savedAt 當近似值，並在畫面上標示。
   **不要靜默假裝知道時間**，冷卻期算錯會讓人白等或提早去掛單。 */
/* ## 單（order）：2026-08-31 加的一層

   ⚠️ **原本的模型假設「一次只有一個計畫」，而事實不是。**
      `lots` 已經支援分批，但兩份計畫同時在跑會壞在兩個地方：
        一、`sah-combo-v1` 只有一份 → 開第二單就把第一單的「計畫幾個／
            還差幾個」蓋掉；
        二、`isStaleEntry()` 把早於 savedAt 的批次標成舊紀錄 → 第一單還在
            冷卻期，就被標成「上一份計畫留下的」。
      那個標示本來就是「沒有單這一層」的補丁。加了單 ID 之後補丁整個消失，
      清除鍵變成「結束這一單」——**把猜測換成模型**，不是加功能。

   格式（v4，明碼帶版本，不用猜）：

     sah-orders-v1              { v:4, orders:{ "<oid>": { createdAt, plan[], closedAt } } }
     sah-checklist-checked-v1   { v:4, orders:{ "<oid>": { "<品項名>": { lots[], closed } } } }
     sah-sold-v1                { v:4, sold:{ "<holding key>": { twd, at } } }

   ⚠️ **版本用明碼欄位 `v`，不要靠形狀嗅探。** v3 的值是「品項 → entry」、
      v4 是「單 → 品項 → entry」，壞資料下兩者分不出來，而分錯的後果是
      整份買進紀錄消失。

   ## 遷移

   v1／v2／v3 的勾選紀錄整包當成**一張舊單**（oid = 'legacy'），計畫從
   `sah-combo-v1` 讀。⚠️ **只讀不寫**：沒動過的裝置退回舊版仍讀得回，
   真的有人動到資料時才落地成 v4。`sah-combo-v1` 自此只讀不寫，
   單的計畫改由 `sah-orders-v1` 保管——**不要兩邊都寫**，那是兩個真相。 */
var COMBO_STORAGE_KEY = 'sah-combo-v1';        /* 舊格式，只讀不寫（見上面〈遷移〉） */
var CHECK_STORAGE_KEY = 'sah-checklist-checked-v1';
var ORDERS_STORAGE_KEY = 'sah-orders-v1';
var SOLD_STORAGE_KEY = 'sah-sold-v1';
var LEGACY_ORDER_ID = 'legacy';

function normalizeLot(raw) {
  if (!raw || typeof raw !== 'object') raw = { at: (typeof raw === 'string' ? raw : null) };
  var q = Number(raw.qty);
  var p = Number(raw.paidTwd);
  return {
    at: (typeof raw.at === 'string' && raw.at) ? raw.at : null,
    /* got＝這一批真的進到庫存的時間（2026-08-29 新增）。冷卻期從這裡起算。
       ⚠️ null 是常態不是壞資料：多數人不會回來按「已到貨」，那時走
          cooldownStart() 的緩衝退路。**不要幫他填一個預設值**——
          填了就分不出「他確認過」跟「我們猜的」。 */
    got: (typeof raw.got === 'string' && raw.got) ? raw.got : null,
    qty: (raw.qty != null && raw.qty !== '' && isFinite(q) && q > 0) ? Math.round(q) : null,
    paidTwd: (raw.paidTwd != null && raw.paidTwd !== '' && isFinite(p) && p >= 0) ? p : null
  };
}

/* 把三種歷史格式都收斂成 v3 的 entry。壞掉的資料當成「勾了但什麼都沒填」，
   不要 throw——這是在頁面初始化階段跑的，掛掉整頁就白畫了。 */
function normalizeCheckedEntry(raw) {
  var lots;
  if (raw && typeof raw === 'object' && Array.isArray(raw.lots)) {
    lots = raw.lots.map(normalizeLot);
  } else if (Array.isArray(raw)) {
    lots = raw.map(normalizeLot);
  } else {
    lots = [normalizeLot(raw)];        // v2 的 ISO 字串，或 v1 升級後的 null
  }
  /* 多批時把沒填數量的那幾批丟掉：分批只會由「輸入了數量」這個動作產生，
     沒有數量的多批一定是手改過的壞資料，留著會讓總數算不出來。 */
  if (lots.length > 1) lots = lots.filter(function (l) { return l.qty != null; });
  if (!lots.length) lots = [normalizeLot(null)];
  return { lots: lots, closed: !!(raw && raw.closed) };
}

/* 全部的單的勾選紀錄：{ oid: { 品項名: entry } } */
function readCheckedAll() {
  var out = {};
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(CHECK_STORAGE_KEY) || 'null'); } catch (e) { return out; }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.v === 4
      && raw.orders && typeof raw.orders === 'object') {
    Object.keys(raw.orders).forEach(function (oid) {
      var m = raw.orders[oid];
      if (!m || typeof m !== 'object') return;
      var one = {};
      Object.keys(m).forEach(function (n) { one[n] = normalizeCheckedEntry(m[n]); });
      out[oid] = one;
    });
    return out;
  }
  /* v1 / v2 / v3：整包當成一張舊單 */
  var one = {};
  if (Array.isArray(raw)) {
    raw.forEach(function (n) { one[n] = normalizeCheckedEntry(null); });
  } else if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach(function (n) { one[n] = normalizeCheckedEntry(raw[n]); });
  }
  if (Object.keys(one).length) out[LEGACY_ORDER_ID] = one;
  return out;
}

/* ⚠️ 寫入會失敗（無痕模式、瀏覽器擋掉網站儲存、極少見的配額爆掉），
      而且是**靜默**的。回傳成功與否，呼叫端要把失敗講出來——使用者剛敲進去
      的實付金額默默消失，比一開始就說「這台裝置存不了」糟得多。 */
function writeCheckedAll(all) {
  try {
    localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify({ v: 4, orders: all }));
    return true;
  } catch (e) { return false; }
}

function readCheckedMap(oid) {
  var all = readCheckedAll();
  var id = oid || activeOrderId();
  return all[id] || {};
}
function writeCheckedMap(map, oid) {
  var all = readCheckedAll();
  var id = oid || activeOrderId();
  all[id] = map;
  return writeCheckedAll(all);
}

/* ── 單本身 ────────────────────────────────────────────── */

function normalizeOrder(raw) {
  var plan = [];
  if (raw && Array.isArray(raw.plan)) {
    raw.plan.forEach(function (i) {
      if (!i || !i.name) return;
      var q = Number(i.qty);
      plan.push({
        name: String(i.name),
        qty: (isFinite(q) && q > 0) ? Math.round(q) : 0,
        unitCostTwd: Number(i.unitCostTwd) || 0,
        /* ⚠️⚠️ listUsd 是 CSFloat 的**掛牌價**（美元、不含任何費用），
              **不是**「你要付多少」——那永遠是 unitCostTwd（PROJECT_OVERVIEW 坑 #1，
              前端已經寫錯過三頁裡的兩頁）。它存在的唯一理由是：CSFloat 求購訂單
              的價格欄要填的就是掛牌價，而入金費是入金時收一次、不是每件收。
           ⚠️ 舊的單沒有這個欄位，一律 null。呼叫端要能處理 null，
              不要用 unitCostTwd 去反推——那要同時除掉 7.5% 與 1.5%，
              等於把兩個常數複製到第三個地方。 */
        listUsd: (Number(i.listUsd) > 0) ? Number(i.listUsd) : null,
        /* CSFloat 標價的台幣版（掛牌價 × **中間價**，不含入金費也不含刷卡費）。
           ⚠️ 這是使用者拿去跟 CSFloat 畫面比對的數字，unitCostTwd 不是——
              兩者差 9%（1.075 × 1.015），對不上時他會以為本站算錯。 */
        listTwd: (Number(i.listTwd) > 0) ? Number(i.listTwd) : null,
        defIndex: (i.defIndex == null || i.defIndex === '') ? null : String(i.defIndex)
      });
    });
  }
  return {
    createdAt: (raw && typeof raw.createdAt === 'string' && raw.createdAt) ? raw.createdAt : null,
    plan: plan,
    closedAt: (raw && typeof raw.closedAt === 'string' && raw.closedAt) ? raw.closedAt : null
  };
}

function readOrders() {
  var out = {};
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) || 'null'); } catch (e) { raw = null; }
  if (raw && typeof raw === 'object' && raw.v === 4 && raw.orders && typeof raw.orders === 'object') {
    Object.keys(raw.orders).forEach(function (oid) { out[oid] = normalizeOrder(raw.orders[oid]); });
    /* ⚠️ **空的也要回空的。** 有 v4 這個容器就代表這台裝置已經遷移過，裡面沒東西
       是「使用者把單刪光了」——這時再掉進下面的遷移，被刪掉的單會從 sah-combo-v1
       復活，而使用者按刪除的理由常常是「不想留在這台電腦上」。 */
    return out;
  }
  /* 遷移：還沒有單這一層的裝置，把 sah-combo-v1 ＋ 勾選紀錄當成一張舊單。 */
  var combo = null;
  try { combo = JSON.parse(localStorage.getItem(COMBO_STORAGE_KEY) || 'null'); } catch (e) { combo = null; }
  var hasPlan = !!(combo && Array.isArray(combo.items) && combo.items.length);
  var hasChecked = !!readCheckedAll()[LEGACY_ORDER_ID];
  if (hasPlan || hasChecked) {
    out[LEGACY_ORDER_ID] = normalizeOrder({
      createdAt: (combo && combo.savedAt) || null,
      plan: hasPlan ? combo.items : [],
      closedAt: null
    });
  }
  return out;
}

function writeOrders(orders) {
  try {
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify({ v: 4, orders: orders }));
    return true;
  } catch (e) { return false; }
}

function orderIsOpen(o) { return !!o && !o.closedAt; }

function orderTime(o) {
  var t = (o && o.createdAt) ? Date.parse(o.createdAt) : NaN;
  return isFinite(t) ? t : 0;
}

/* 未結案的單，新到舊。 */
function openOrderIds(orders) {
  var o = orders || readOrders();
  return Object.keys(o).filter(function (id) { return orderIsOpen(o[id]); })
    .sort(function (a, b) { return orderTime(o[b]) - orderTime(o[a]); });
}

/* 「現在這一單」＝最新的未結案單。一張都沒有時回舊單的 ID 當落腳處，
   讓寫入不至於無處可去（正常流程一定先試算才有得勾，不會走到）。 */
function activeOrderId(orders) {
  var ids = openOrderIds(orders);
  return ids.length ? ids[0] : LEGACY_ORDER_ID;
}

/* 單 ID：epoch 分鐘的 base36 ＋ 兩碼亂數（同一分鐘建立兩單也不會撞）。
   ⚠️ **不要用「第幾單」或陣列索引當 ID**——刪掉中間一單，後面的 ID 就
      全部指到別人身上，而 ID 是實付金額與成交價的歸屬依據。 */
function newOrderId() {
  return Math.floor(Date.now() / 60000).toString(36) + Math.random().toString(36).slice(2, 4);
}

/* 試算頁要寫進哪一單。
   規則：**還沒買任何東西的那一單就是草稿**，重新試算是改寫草稿，不是開新單。
   ⚠️ 已經有批次的單一律不動：那裡面有實付金額與冷卻期起點，重算一次就蓋掉，
      等於把使用者買過的東西改寫成另一份計畫。這也正是拉一次滑桿就開一張新單
      （最後留下一堆空單）與蓋掉舊單（資料消失）兩種錯法之間唯一站得住的那條線。 */
function draftOrderId(orders, all) {
  var o = orders || readOrders();
  var c = all || readCheckedAll();
  var ids = openOrderIds(o);
  for (var i = 0; i < ids.length; i++) {
    var m = c[ids[i]];
    if (!m || !Object.keys(m).length) return ids[i];
  }
  return null;
}

/* 試算頁呼叫：把這次的組合存成「現在這一單」的計畫。回傳 oid，存不進去回 null。 */
function saveOrderPlan(planItems) {
  var orders = readOrders();
  var all = readCheckedAll();
  var id = draftOrderId(orders, all) || newOrderId();
  orders[id] = normalizeOrder({
    createdAt: new Date().toISOString(),
    plan: planItems || [],
    closedAt: (orders[id] && orders[id].closedAt) || null
  });
  return writeOrders(orders) ? id : null;
}

function setOrderClosed(oid, on) {
  var orders = readOrders();
  if (!orders[oid]) return false;
  orders[oid].closedAt = on ? new Date().toISOString() : null;
  return writeOrders(orders);
}

/* 全站對「這是哪一單」的統一說法。三個頁面各寫一份的話，同一單會有三個名字。 */
function orderLabel(order) {
  var t = (order && order.createdAt) ? new Date(order.createdAt) : null;
  if (!t || isNaN(t.getTime())) return '未標日期的單';
  return t.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' 這一單';
}

/* 剛勾起來、什麼都還沒填的一筆。試算頁與購物清單頁都用這個，
   不要各自手寫一份 —— 之前試算頁寫的是裸 ISO 字串（v2），
   雖然讀得回來，但會在同一份資料裡留下混格式的紀錄。 */
function newCheckedEntry() {
  return { lots: [{ at: new Date().toISOString(), got: null, qty: null, paidTwd: null }], closed: false };
}

/* 用一組「已勾選的品項名」去同步某一單的整張表：名單裡有的保留原樣、
   沒有的丟掉、新出現的建一筆空的。

   ⚠️ **保留原樣是重點。** 既有那筆可能帶著使用者在購物清單頁敲進去的
      買到數量與實付金額——**看不到不等於可以覆蓋掉**。 */
function syncCheckedNames(names, oid) {
  var id = oid || activeOrderId();
  var prev = readCheckedMap(id);
  var next = {};
  (names && names.forEach ? names : []).forEach(function (n) {
    next[n] = prev[n] || newCheckedEntry();
  });
  writeCheckedMap(next, id);
  return next;
}

/* 這個品項在這一單裡一共買到幾個 / 一共付了多少。
   ⚠️ 任何一批沒填就回 null（= 不知道），不要把沒填的當 0 加進去——
      少加一批的總額會讓「少了多少」憑空變好看。 */
function lotsTotalQty(entry) {
  if (!entry || !entry.lots || !entry.lots.length) return null;
  var sum = 0;
  for (var i = 0; i < entry.lots.length; i++) {
    if (entry.lots[i].qty == null) return null;
    sum += entry.lots[i].qty;
  }
  return sum;
}
function lotsTotalPaid(entry) {
  if (!entry || !entry.lots || !entry.lots.length) return null;
  var sum = 0;
  for (var i = 0; i < entry.lots.length; i++) {
    if (entry.lots[i].paidTwd == null) return null;
    sum += entry.lots[i].paidTwd;
  }
  return sum;
}

/* ── 持有清單 ──────────────────────────────────────────────
   回傳已買到的批次，**一批一列**（不是一個品項一列）。
   分批買的兩批解鎖日不同，合成一列就一定有一批的冷卻期是錯的。

   每一列：
     oid                 屬於哪一單
     key                 穩定識別字，回填成交價用（見 holdingKey）
     legacyKey           v4 之前的識別字，只用來讀舊的成交價（見 soldEntry）
     name / defIndex     品項。⚠️ name 可能是 null——新網址在 defIndex 查得到時
                         不帶名稱，要等頁面查資料庫還原（見 holdingsToParamV4）
     plannedQty          這一單的計畫數量（整個品項的）
     qty                 這一批實際買到幾個
     qtyIsEstimate       true = 沒填，qty 是退回用的計畫數量
     unitCostTwd         試算頁的**估計**單價，不是實付
     paidTwd             這一批實付總額，null = 沒填
     boughtAt / boughtAtIsEstimate
     arrivedAt / cooldownFrom / cooldownFromIsEstimate
     closed              這個品項在這一單裡是否已標記「買不到了」
     lotIndex / lotCount */

/* 成交價要掛在哪個識別字上。
   ⚠️ **一定要含 oid。** 同一顆箱子出現在兩單是常態（倍率最高的那幾顆本來
      就每輪都會被選中），不含 oid 的話第二單的成交價會蓋掉第一單的。
   ⚠️ 名稱還沒還原時用 '#defIndex' 頂替，**還原之後要重算 key**——
      頁面在拿到名稱後呼叫 assignHoldingKeys()。 */
function holdingKey(i) {
  var ident = i.name || ('#' + (i.defIndex == null ? '?' : i.defIndex));
  return (i.oid || '') + '::' + ident + (i.lotCount > 1 ? ('#' + i.lotIndex) : '');
}
function assignHoldingKeys(items) {
  (items || []).forEach(function (i) { i.key = holdingKey(i); });
  return items;
}

function holdingsFromPlan(planItems, checked, savedAt, oid) {
  var items = [];
  (planItems || []).forEach(function (i) {
    if (!Object.prototype.hasOwnProperty.call(checked, i.name)) return;
    var entry = checked[i.name];
    var lotCount = entry.lots.length;
    entry.lots.forEach(function (lot, idx) {
      var bought = lot.at || savedAt || null;
      var cs = cooldownStart(bought, lot.got);
      var row = {
        oid: oid || '',
        name: i.name,
        defIndex: i.defIndex == null ? null : i.defIndex,
        plannedQty: i.qty,
        qty: lot.qty != null ? lot.qty : i.qty,
        qtyIsEstimate: lot.qty == null,
        unitCostTwd: i.unitCostTwd,
        paidTwd: lot.paidTwd,
        boughtAt: bought,
        boughtAtIsEstimate: !lot.at,   // 舊資料沒有勾選時間，用試算時間近似
        /* ⚠️ boughtAt 與 cooldownFrom 是**兩件事**，不要拿其中一個代替另一個：
              boughtAt     你付錢那一刻，用來認「這是不是這次買的」
              cooldownFrom 物品進到庫存那一刻，冷卻期唯一的起算點
           賣出頁的倒數、排序、行事曆一律用 cooldownFrom。 */
        arrivedAt: lot.got || null,
        cooldownFrom: cs.at,
        cooldownFromIsEstimate: cs.isEstimate,
        closed: entry.closed,
        lotIndex: idx,
        lotCount: lotCount,
        /* v4 之前的成交價識別字。只讀不寫，見 soldEntry()。 */
        legacyKey: lotCount > 1 ? (i.name + '#' + (lot.at || ('lot' + idx))) : i.name
      };
      row.key = holdingKey(row);
      items.push(row);
    });
  });
  return items;
}

/* 某一單的持有清單。 */
function holdingsForOrder(oid, orders, all) {
  var o = (orders || readOrders())[oid];
  if (!o) return [];
  var c = (all || readCheckedAll())[oid] || {};
  return holdingsFromPlan(o.plan, c, o.createdAt, oid);
}

/* 所有**未結案**的單，舊單在前（讀起來像時間軸）。
   ⚠️ 已結案的單不進來：它們沒有冷卻期也沒有提醒價值，混進來只會讓賣出頁
      越用越長，也會讓追蹤網址跟著帳本一起變長。要看歷史請走 readLedger()。 */
function readHoldings() {
  var orders = readOrders();
  var all = readCheckedAll();
  var ids = openOrderIds(orders);
  var items = [];
  ids.slice().reverse().forEach(function (id) {
    items = items.concat(holdingsForOrder(id, orders, all));
  });
  return {
    items: items,
    savedAt: ids.length ? orders[ids[0]].createdAt : null,
    orderIds: ids
  };
}

/* 帳本：全部的單（含已結案），新到舊。純事實，不算績效。 */
function readLedger() {
  var orders = readOrders();
  var all = readCheckedAll();
  return Object.keys(orders).sort(function (a, b) {
    return orderTime(orders[b]) - orderTime(orders[a]);
  }).map(function (id) {
    return { oid: id, order: orders[id], items: holdingsForOrder(id, orders, all) };
  });
}

/* ── 成交價（只存本機）────────────────────────────────────
   ⚠️ 存的是**買家付的錢（毛額）、單位是新台幣**，也就是使用者在 Steam 畫面上
      看到的那個數字。要換成賣家實拿一定要先過 steamNetTwd()（第⑮節）。
   ⚠️ 2026-08-31 起連**成交時間**一起存：帳本要回答「資金鎖了幾天」，而
      那是這個工具最貴的成本（7 天冷卻期＋波動）。舊資料是裸數字，讀進來時
      補成 { twd, at:null }——**不要幫它填一個假的成交時間**。 */
function readSoldAll() {
  var out = {};
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(SOLD_STORAGE_KEY) || 'null'); } catch (e) { return out; }
  var src = (raw && typeof raw === 'object' && raw.v === 4 && raw.sold) ? raw.sold : raw;
  if (!src || typeof src !== 'object') return out;
  Object.keys(src).forEach(function (k) {
    var v = src[k];
    if (v == null) return;
    if (typeof v === 'object') {
      var n = Number(v.twd);
      if (isFinite(n)) out[k] = { twd: n, at: (typeof v.at === 'string' && v.at) ? v.at : null };
    } else {
      var m = Number(v);
      if (isFinite(m)) out[k] = { twd: m, at: null };
    }
  });
  return out;
}
function writeSoldAll(map) {
  try {
    localStorage.setItem(SOLD_STORAGE_KEY, JSON.stringify({ v: 4, sold: map }));
    return true;
  } catch (e) { return false; }
}
/* 讀某一批的成交價。找不到新 key 就退回 v4 之前的 key——那時候的 key
   是純品項名，沒有單這一層。⚠️ 只在讀的時候退回，寫一律寫新 key。 */
function soldEntry(map, item) {
  if (!map || !item) return null;
  if (map[item.key] != null) return map[item.key];
  if (item.legacyKey && map[item.legacyKey] != null) return map[item.legacyKey];
  return null;
}
function setSoldValue(map, item, rawValue) {
  var v = String(rawValue == null ? '' : rawValue).trim();
  if (item.legacyKey && item.legacyKey !== item.key) delete map[item.legacyKey];
  if (v === '') { delete map[item.key]; return map; }
  var prev = map[item.key];
  var twd = roundTwd(v);
  map[item.key] = {
    twd: twd,
    /* 金額沒變就不要動成交時間——重新渲染或改一個字又改回來，
       不該讓「賣掉那一天」跟著跳。 */
    at: (prev && prev.at && prev.twd === twd) ? prev.at : new Date().toISOString()
  };
  return map;
}

/* ── 跨裝置：把清單編進網址 ────────────────────────────────
   `.ics` 與追蹤網址都靠它。localStorage 不跨裝置（桌機買、手機收提醒是很
   常見的組合），而且 **Safari 會在連續 7 天沒有互動之後刪掉整個 origin 的
   script-writable storage**——那正好撞上 7 天冷卻期。所以網址不只是便利，
   在 WebKit 上它是唯一可靠的持久副本。

   ## v4（參數名 `it` ＋ `t0`）

     名稱:數量:計畫單價:defIndex:實付總額:旗標:計畫數量:買進:到貨:單ID

   | 段 | 內容 | 空的時候 |
   |---|---|---|
   | 1 | 名稱（百分號編碼）| **有 defIndex 就一定是空的**，載入時查資料庫還原 |
   | 2 | 這一批數量 | — |
   | 3 | 計畫單價 | 有實付總額時就不需要它 |
   | 4 | defIndex（base36）| 沒有，這時第 1 段一定有名稱 |
   | 5 | 實付總額 | 沒填 |
   | 6 | 旗標 `q`數量估計／`t`時間估計／`c`已收單 | 都不是 |
   | 7 | 計畫數量 | 與實際相同（**不是**「不知道」）|
   | 8 | 買進：距 `t0` 幾分鐘（base36）| 沒有 |
   | 9 | 到貨：距 `t0` 幾分鐘（base36）| 沒按過「物品到了」|
   | 10 | 單 ID | **沿用前一段**（同一單的批次連在一起，只有換單時才寫）|

   `t0` = 全部時刻裡最早的那一分鐘（base36）。以最早的為基準，位移永遠 ≥ 0，
   不用處理負數。

   ⚠️ **名稱是冗餘的，defIndex 才是識別字。** 名稱是網址裡最貴的東西
      （每個空白百分號編碼後三個字元），而載入時本來就要查資料庫才有賣價。
      代價：品項若已從 `cases_data` 下架，那一列會顯示成「箱子 #4001」——
      冷卻期與金額仍然正確，只是 Steam 市集連結給不出來（那顆需要名稱）。
   ⚠️ **不要改用「陣列索引 0–44」當代碼**，省更多但表一重排就整批對錯箱子，
      而且錯得無聲。defIndex 是外部穩定 ID。
   ⚠️ **不要再套一層 encodeURIComponent 到整串上。** `:` 與 `,` 在 query 裡
      是合法字元（RFC 3986 sub-delims），外層那次編碼會把每個 `%` 再變成
      `%25`，長度多兩成三。**但每個欄位自己那層不能省**——箱名裡有 `&`
      （Dreams & Nightmares Case），不編就在那裡斷成兩個參數。
   ⚠️ **不要上壓縮（LZ-string 之類）。** 30 批也才 949 字元，離任何限制都遠，
      換來的是多一個相依、完全不可讀、舊網址讀不回。

   ## 舊網址（參數名 `items`，四段／八段／九段）

   已經下載的 `.ics` 裡是舊網址，**永遠會回來**，所以 paramToHoldings()
   原封不動留著。⚠️ **用參數名區分版本，不要數幾段來猜。**

   ## 網址只帶「使用者自己的紀錄」

   買了什麼、付了多少——**不帶市場價格或計算結果**，賣價、實拿、倍率一律
   在載入時重查。界線畫在「這個數字會不會因時間經過而變錯」，不是「它是不是錢」。 */
var URL_ITEMS_PARAM = 'it';
var URL_T0_PARAM = 't0';

function toB36(n) { return Math.round(n).toString(36); }
function fromB36(s) {
  if (s === '' || s == null) return NaN;
  var n = parseInt(String(s), 36);
  return isFinite(n) ? n : NaN;
}

function holdingsToParamV4(items) {
  var list = items || [];
  var mins = [];
  list.forEach(function (i) {
    [i.boughtAt, i.arrivedAt].forEach(function (t) {
      var v = t ? Math.floor(Date.parse(t) / 60000) : NaN;
      if (isFinite(v)) mins.push(v);
    });
  });
  var t0 = mins.length ? Math.min.apply(null, mins) : Math.floor(Date.now() / 60000);
  var lastOid = null;
  var parts = list.map(function (i) {
    var at = i.boughtAt ? Math.floor(Date.parse(i.boughtAt) / 60000) : NaN;
    var got = i.arrivedAt ? Math.floor(Date.parse(i.arrivedAt) / 60000) : NaN;
    var di = (i.defIndex == null || i.defIndex === '') ? NaN : Number(i.defIndex);
    var hasDi = isFinite(di) && di >= 0;
    var oid = i.oid || '';
    var oidSeg = (oid && oid !== lastOid) ? oid : '';
    if (oid) lastOid = oid;
    return [
      /* defIndex 查得回名稱就不帶名稱；帶不出 defIndex 的品項一定要帶名稱，
         否則那一列在另一台裝置上就完全認不出來。 */
      hasDi ? '' : encodeURIComponent(i.name || ''),
      i.qty,
      i.paidTwd == null ? roundTwd(i.unitCostTwd || 0) : '',
      hasDi ? toB36(di) : '',
      i.paidTwd == null ? '' : roundTwd(i.paidTwd),
      (i.qtyIsEstimate ? 'q' : '') + (i.boughtAtIsEstimate ? 't' : '') + (i.closed ? 'c' : ''),
      (i.plannedQty != null && i.plannedQty !== i.qty) ? i.plannedQty : '',
      isFinite(at) ? toB36(at - t0) : '',
      isFinite(got) ? toB36(got - t0) : '',
      encodeURIComponent(oidSeg)
    ].join(':');
  });
  return { it: parts.join(','), t0: toB36(t0) };
}

function paramToHoldingsV4(raw, t0Raw) {
  if (!raw) return [];
  var t0 = fromB36(t0Raw);
  if (!isFinite(t0)) t0 = 0;
  var seen = {};
  var lastOid = '';
  var out = [];
  raw.split(',').forEach(function (part) {
    var seg = part.split(':');
    var qty = Number(seg[1]) || 0;
    if (qty <= 0) return;
    var di = fromB36(seg[3]);
    var defIndex = isFinite(di) ? String(di) : null;
    var name = seg[0] ? decodeURIComponent(seg[0]) : null;
    var paid = (seg[4] == null || seg[4] === '') ? null : (Number(seg[4]) || 0);
    var flags = seg[5] || '';
    var planned = seg[6];
    var atOff = fromB36(seg[7]);
    var gotOff = fromB36(seg[8]);
    var oid = seg[9] ? decodeURIComponent(seg[9]) : lastOid;
    lastOid = oid || lastOid;
    var at = isFinite(atOff) ? new Date((t0 + atOff) * 60000).toISOString() : null;
    var got = isFinite(gotOff) ? new Date((t0 + gotOff) * 60000).toISOString() : null;
    var cs = cooldownStart(at, got);
    /* 同一單裡同一個品項出現兩次＝兩批，識別字不能撞。 */
    var ident = (oid || '') + '|' + (name || ('#' + defIndex));
    var n = (seen[ident] = (seen[ident] || 0) + 1);
    var row = {
      oid: oid || '',
      name: name,
      defIndex: defIndex,
      qty: qty,
      /* 第 7 段空的時候代表「計畫數量＝實際數量」，不是「不知道」 */
      plannedQty: (planned !== undefined && planned !== '') ? (Number(planned) || qty) : qty,
      qtyIsEstimate: flags.indexOf('q') >= 0,
      unitCostTwd: (seg[2] == null || seg[2] === '') ? 0 : (Number(seg[2]) || 0),
      paidTwd: paid,
      boughtAt: at,
      boughtAtIsEstimate: flags.indexOf('t') >= 0,
      arrivedAt: got,
      cooldownFrom: cs.at,
      cooldownFromIsEstimate: cs.isEstimate,
      closed: flags.indexOf('c') >= 0,
      lotIndex: n - 1,
      lotCount: 1,
      /* 網址來的批次沒有 v4 之前的識別字可退——舊網址走 paramToHoldings()。 */
      legacyKey: null
    };
    row.key = holdingKey(row);
    out.push(row);
  });
  /* lotCount 要等整串讀完才知道，而 key 依賴它。 */
  var counts = {};
  out.forEach(function (i) { counts[i.oid + '|' + (i.name || i.defIndex)] = (counts[i.oid + '|' + (i.name || i.defIndex)] || 0) + 1; });
  out.forEach(function (i) {
    i.lotCount = counts[i.oid + '|' + (i.name || i.defIndex)];
    i.key = holdingKey(i);
  });
  return out;
}

/* 舊網址（`items=`）的解碼器。**只讀不寫**——新網址一律走 holdingsToParamV4()。
   留著的理由：已經下載到使用者行事曆裡的 `.ics` 帶的是這種網址，永遠會回來。

     名稱:數量:計畫單價:defIndex:實付總額:旗標:計畫數量:買進時間:到貨時間

   四段（最早）／八段（2026-08-22）／九段（2026-08-29）都讀得回來。 */
function paramToHoldings(raw, boughtAt) {
  if (!raw) return [];
  var seen = {};
  var rows = raw.split(',').map(function (part) {
    var seg = part.split(':').map(decodeURIComponent);
    var name = seg[0] || '未命名';
    var paid = seg[4];
    var flags = seg[5] || '';
    var planned = seg[6];
    var atSec = Number(seg[7]);
    var gotSec = Number(seg[8]);
    var qty = Number(seg[1]) || 0;
    /* 同一個網址裡同名品項出現兩次＝兩批，key 不能撞在一起 */
    var n = (seen[name] = (seen[name] || 0) + 1);
    var at = (seg[7] && isFinite(atSec) && atSec > 0)
      ? new Date(atSec * 1000).toISOString()
      : (boughtAt || null);
    var got = (seg[8] && isFinite(gotSec) && gotSec > 0)
      ? new Date(gotSec * 1000).toISOString()
      : null;
    var cs = cooldownStart(at, got);
    var row = {
      oid: '',
      name: name,
      qty: qty,
      /* 第 7 段空的時候代表「計畫數量＝實際數量」，不是「不知道」 */
      plannedQty: (planned !== undefined && planned !== '') ? (Number(planned) || qty) : qty,
      qtyIsEstimate: flags.indexOf('q') >= 0,
      unitCostTwd: Number(seg[2]) || 0,
      defIndex: (seg[3] !== undefined && seg[3] !== '') ? seg[3] : null,
      paidTwd: (paid !== undefined && paid !== '') ? (Number(paid) || 0) : null,
      boughtAt: at,
      /* 舊網址沒有旗標段。沒有旗標時不要假裝時間是確定的——
         bought 參數本身可能就是從估計值編出來的。 */
      boughtAtIsEstimate: seg.length < 6 ? !at : (flags.indexOf('t') >= 0),
      arrivedAt: got,
      cooldownFrom: cs.at,
      cooldownFromIsEstimate: cs.isEstimate,
      closed: flags.indexOf('c') >= 0,
      lotIndex: n - 1,
      lotCount: 1,
      /* v4 之前的成交價識別字，長這樣 */
      legacyKey: n > 1 ? (name + '#p' + n) : name
    };
    row.key = holdingKey(row);
    return row;
  }).filter(function (i) { return i.qty > 0; });
  /* lotCount 要整串讀完才知道，而 key 依賴它（同名兩批的 key 不能撞）。 */
  var counts = {};
  rows.forEach(function (i) { counts[i.name] = (counts[i.name] || 0) + 1; });
  rows.forEach(function (i) { i.lotCount = counts[i.name]; i.key = holdingKey(i); });
  return rows;
}

/* 網址進來的清單一律走這裡：新參數優先，沒有才退回舊參數。
   ⚠️ **用參數名決定版本，不要嗅探內容。** */
function holdingsFromLocation(search) {
  var params = new URLSearchParams(search || '');
  var it = params.get(URL_ITEMS_PARAM);
  if (it) return paramToHoldingsV4(it, params.get(URL_T0_PARAM));
  var old = params.get('items');
  if (old) return paramToHoldings(old, params.get('bought'));
  return [];
}

/* ── 追蹤網址：把整份清單變成一條可以貼的連結 ──────────────
   `.ics` 要下載、要匯入，在手機上是一道真實的摩擦。同一份資料本來就編得進
   網址，那就讓使用者直接複製一條連結，貼到自己的行事曆事件、記事本、傳給自己。

   ⚠️ **這是快照，不是連線。** 複製完之後在購物清單改的任何東西，那條已經
      貼出去的連結都不知道。所以網址帶 `at`（複製當下的時間），另一端要把它
      顯示出來，讓人看得到自己在看多舊的資料。

   ⚠️ **連結內容 = 你買了什麼、花了多少。** 貼進共用行事曆或群組聊天等於把
      消費紀錄給別人看。介面上要講這一句——v4 之後品項與時間變成代碼，
      使用者更沒辦法自己看出裡面有什麼，這句話因此更重要，不是更不重要。

   ⚠️ 第三個參數 `atSec` 是**轉手時要沿用的快照時間**（epoch 秒）。賣出頁也能
      複製追蹤網址，而它手上那份可能本來就是從別人的連結來的——那種情況下重新
      蓋一個「現在」，等於讓一份三天前的舊資料看起來像剛剛複製的。**只有資料
      真正的來源（購物清單頁）才有資格給新的時間**，轉手的一律沿用。 */
function holdingsTrackUrl(items, baseUrl, atSec) {
  var base = (baseUrl || '').split('?')[0];
  var at = (atSec != null && isFinite(atSec) && atSec > 0)
    ? Math.floor(atSec)
    : Math.floor(Date.now() / 1000);
  var p = holdingsToParamV4(items);
  return base + '?' + URL_ITEMS_PARAM + '=' + p.it
    + '&' + URL_T0_PARAM + '=' + p.t0
    + '&at=' + at;
}

/* 複製到剪貼簿。clipboard API 需要 HTTPS 與使用者手勢，兩個條件在
   GitHub Pages 上都成立，但使用者可能擋掉權限，所以一定要有退路。
   回傳 Promise<boolean>：false = 沒複製成功，呼叫端要自己把網址秀出來。 */
function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
        function () { return false; });
    }
  } catch (e) { /* 掉到下面的退路 */ }
  return Promise.resolve(false);
}

/* 這台裝置上「會被這份網址蓋掉」的批次有幾筆。
   ⚠️ 只數會被動到的那幾單。v4 之前這裡數的是整台裝置，那時只有一單所以剛好
      相等；現在整份取代改成**逐單取代**，把沒被碰到的單也數進去會嚇到人。 */
function countStoredHoldings(items) {
  var all = readCheckedAll();
  var ids;
  if (items && items.length) {
    var set = {};
    items.forEach(function (i) { if (i.oid) set[i.oid] = true; });
    ids = Object.keys(set);
    if (!ids.length) return 0;
  } else {
    ids = Object.keys(all);
  }
  var n = 0;
  ids.forEach(function (id) {
    var m = all[id] || {};
    Object.keys(m).forEach(function (name) { n += (m[name].lots || []).length; });
  });
  return n;
}

/* 把網址還原出來的清單存進**這台裝置**。
   給的是 holdingsFromLocation() 的輸出。

   ⚠️ **這是逐單取代，不是合併。** 同一單裡同名品項要合併就得處理「兩邊數量
      不一樣該聽誰的」，那個問題沒有正確答案，猜錯就是默默改掉使用者的紀錄。
      所以在**單**這一層取代（網址說了算），沒出現在網址裡的單原封不動。
      並且**由呼叫端在存之前先問過**——countStoredHoldings(items) 就是用來
      告訴使用者「會被蓋掉幾筆」。

   ⚠️ **名稱還沒還原就不能存。** 新網址在 defIndex 查得到時不帶名稱，要等
      頁面查完資料庫才知道那是哪顆箱子。名稱沒還原就存，等於在資料庫裡種下
      一個 `#4001` 這種永遠對不上 `cases_data` 的假品項名。

   回傳 { ok:true } 或 { ok:false, reason:'names'|'storage' }。 */
function saveHoldingsToDevice(items) {
  if (!items || !items.length) return { ok: false, reason: 'empty' };
  if (items.some(function (i) { return !i.name; })) return { ok: false, reason: 'names' };

  var orders = readOrders();
  var all = readCheckedAll();
  /* 網址沒帶單 ID（舊網址）就開一張新單，不要塞進現有的任何一單。 */
  var fallbackOid = newOrderId();
  var touched = {};

  items.forEach(function (i) {
    var oid = i.oid || fallbackOid;
    if (!touched[oid]) {
      touched[oid] = true;
      orders[oid] = {
        createdAt: (orders[oid] && orders[oid].createdAt) || i.boughtAt || new Date().toISOString(),
        plan: [],
        closedAt: null
      };
      all[oid] = {};
    }
    var plan = orders[oid].plan;
    var checked = all[oid];
    var name = i.name;
    if (!checked[name]) {
      checked[name] = { lots: [], closed: !!i.closed };
      plan.push({
        name: name,
        qty: i.plannedQty != null ? i.plannedQty : i.qty,
        unitCostTwd: i.unitCostTwd,
        defIndex: i.defIndex
      });
    } else {
      /* 同名的第二段＝同一個品項的第二批。
         ⚠️ 計畫數量是**品項層級**的，每一批都帶著同一個值，所以這裡要取最大值，
            **不能相加**——相加會讓計畫 20 的品項在新裝置上變成 40，
            「還差幾個」跟著全錯。（網址是平的，沒有品項這一層。） */
      for (var k = 0; k < plan.length; k++) {
        if (plan[k].name !== name) continue;
        var p = (i.plannedQty != null ? i.plannedQty : i.qty);
        if (p > plan[k].qty) plan[k].qty = p;
      }
      if (i.closed) checked[name].closed = true;
    }
    checked[name].lots.push({
      at: i.boughtAt,
      /* ⚠️ **到貨時間一定要跟著搬。** 網址第 9 段辛苦帶過來的東西在這裡掉了，
            重整之後冷卻期就退回估計值——而使用者按「物品到了」的唯一理由
            就是他不要估計值。2026-08-31 修正：v3 時這裡漏了 got。 */
      got: i.arrivedAt || null,
      /* 數量是估計的就存 null，讓它在新裝置上**繼續**是估計的。
         存成確定值等於在搬家過程中把「不知道」洗成「知道」。 */
      qty: i.qtyIsEstimate ? null : i.qty,
      paidTwd: i.paidTwd
    });
  });

  if (!writeOrders(orders)) return { ok: false, reason: 'storage' };
  if (!writeCheckedAll(all)) return { ok: false, reason: 'storage' };
  return { ok: true };
}

/* ── 匯出／匯入：帳本唯一可靠的持久副本 ─────────────────────
   ⚠️⚠️ **這不是加值功能，是多單模式的前提。** localStorage 在 WebKit 上會被
      「連續 7 天沒有互動就刪掉」清掉整包（Safari ITP 的 7-day cap，涵蓋
      localStorage / IndexedDB / SW cache），而本站的動線正好是「買完 → 關掉
      → 等 7 天 → 回來賣」。帳本累積得越多越值錢，被清掉的損失就越大——
      **累積十輪的紀錄一次消失，比沒有帳本更糟。**
   ⚠️ 匯出的是原始值（毛額／淨額分明），不是換算後的淨額——換算規則會改。 */
function exportLedgerData() {
  return {
    app: 'steam-casher',
    v: 4,
    exportedAt: new Date().toISOString(),
    orders: readOrders(),
    checked: readCheckedAll(),
    sold: readSoldAll()
  };
}

/* 匯入＝**整份取代**，理由同 saveHoldingsToDevice：合併沒有正確答案。
   呼叫端要先問過，並把「原本有幾單會被蓋掉」寫進問句。
   回傳 { ok, orders, lots } 或 { ok:false, reason }。 */
function importLedgerData(data) {
  if (!data || typeof data !== 'object' || data.app !== 'steam-casher') {
    return { ok: false, reason: 'format' };
  }
  var orders = {};
  var checked = {};
  var sold = {};
  if (data.orders && typeof data.orders === 'object') {
    Object.keys(data.orders).forEach(function (id) { orders[id] = normalizeOrder(data.orders[id]); });
  }
  if (data.checked && typeof data.checked === 'object') {
    Object.keys(data.checked).forEach(function (id) {
      var m = data.checked[id];
      if (!m || typeof m !== 'object') return;
      var one = {};
      Object.keys(m).forEach(function (n) { one[n] = normalizeCheckedEntry(m[n]); });
      checked[id] = one;
    });
  }
  if (data.sold && typeof data.sold === 'object') {
    Object.keys(data.sold).forEach(function (k) {
      var v = data.sold[k];
      if (v == null) return;
      var n = Number(typeof v === 'object' ? v.twd : v);
      if (!isFinite(n)) return;
      sold[k] = { twd: n, at: (v && typeof v.at === 'string' && v.at) ? v.at : null };
    });
  }
  if (!Object.keys(orders).length) return { ok: false, reason: 'empty' };
  if (!writeOrders(orders)) return { ok: false, reason: 'storage' };
  if (!writeCheckedAll(checked)) return { ok: false, reason: 'storage' };
  writeSoldAll(sold);
  var lots = 0;
  Object.keys(checked).forEach(function (id) {
    Object.keys(checked[id]).forEach(function (n) { lots += (checked[id][n].lots || []).length; });
  });
  return { ok: true, orders: Object.keys(orders).length, lots: lots };
}

/* CSV：給 Excel 帳本用的那一份。**一批一列**，跟賣出頁看到的東西一一對應。
   ⚠️ 開頭要有 BOM，否則 Excel 會把中文欄位讀成亂碼。
   ⚠️ 存原始值：實付總額、成交毛額分開兩欄，實拿由公式欄位再算——
      把換算後的結果當成唯一紀錄，換算規則一改就回不去了。 */
function ledgerCsv() {
  var sold = readSoldAll();
  var rows = [[
    '單ID', '單建立日', '單狀態', '品項', 'defIndex', '計畫數量', '買到數量', '數量是估計',
    '實付總額TWD', '買進時間', '到貨時間', '成交毛額每個TWD', '成交時間', '實拿合計TWD', '差額TWD'
  ]];
  readLedger().forEach(function (o) {
    o.items.forEach(function (i) {
      var s = soldEntry(sold, i);
      var net = s ? steamNetTwd(s.twd) * i.qty : null;
      rows.push([
        o.oid,
        o.order.createdAt || '',
        o.order.closedAt ? '已結案' : '進行中',
        i.name || ('#' + i.defIndex),
        i.defIndex == null ? '' : i.defIndex,
        i.plannedQty == null ? '' : i.plannedQty,
        i.qty,
        i.qtyIsEstimate ? 'Y' : 'N',
        i.paidTwd == null ? '' : i.paidTwd,
        i.boughtAt || '',
        i.arrivedAt || '',
        s ? s.twd : '',
        (s && s.at) ? s.at : '',
        net == null ? '' : roundTwd(net),
        (net == null || i.paidTwd == null) ? '' : roundTwd(net - i.paidTwd)
      ]);
    });
  });
  return '﻿' + rows.map(function (r) {
    return r.map(function (c) {
      var s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n') + '\r\n';
}

/* ── 刪除 ──────────────────────────────────────────────────
   ⚠️ **本站所有 localStorage key 的唯一清單。新增 key 一定要加進來。**
      漏掉一個，「清空全部」就是一句謊話——而使用者按那顆的理由常常是
      「這台不是我的電腦」。分三組是因為它們消失的代價完全不同：
        records   重建不回來（CSFloat 的結帳紀錄不會自己回來）
        settings  重做一次就有
        prefs     介面偏好，消失了也沒人會發現
   ⚠️ 寫成函式而不是常數物件：SETUP／ELIG 兩個 key 在檔案後面才宣告，
      用常數物件會在載入時就取到 undefined。 */
function siteStorageKeys() {
  return {
    records: [ORDERS_STORAGE_KEY, CHECK_STORAGE_KEY, SOLD_STORAGE_KEY, COMBO_STORAGE_KEY],
    settings: [SETUP_STORAGE_KEY, ELIG_STORAGE_KEY],
    prefs: ['sah-cap-pct-v1', 'sah-buffer-tier-v1', 'sah-liq-filter-v1', 'sah-qty-cap-v1', 'sah-marketlist-sort-v1']
  };
}

function removeStorageKeys(keys) {
  var ok = true;
  keys.forEach(function (k) {
    try { localStorage.removeItem(k); } catch (e) { ok = false; }
  });
  return ok;
}

/* 刪掉一整單：計畫、批次、成交價一起走。
   ⚠️ **成交價一定要一起刪。** 不刪的話會留下一批永遠對不上任何一單的孤兒 key，
      而它們帶著金額——使用者以為刪乾淨了，其實沒有。
   ⚠️ **只動這一單。** 其他單原封不動，這是刪除與「清空全部」的分界。
   ⚠️ 舊單（legacy）的計畫住在 sah-combo-v1，要一起清掉，否則按完刪除，
      資料還躺在磁碟上。 */
function deleteOrder(oid) {
  var orders = readOrders();
  if (!orders[oid]) return false;
  delete orders[oid];
  var all = readCheckedAll();
  delete all[oid];
  var sold = readSoldAll();
  Object.keys(sold).forEach(function (k) {
    if (k.indexOf(oid + '::') === 0) delete sold[k];
  });
  if (!writeOrders(orders)) return false;
  if (!writeCheckedAll(all)) return false;
  writeSoldAll(sold);
  if (oid === LEGACY_ORDER_ID) removeStorageKeys([COMBO_STORAGE_KEY]);
  return true;
}

/* 刪掉全部交易紀錄，留下設定與介面偏好。 */
function clearRecords() {
  return removeStorageKeys(siteStorageKeys().records);
}

/* 清空這台裝置上的所有本站資料（含設定與偏好）。 */
function clearAllLocalData() {
  var k = siteStorageKeys();
  return removeStorageKeys(k.records.concat(k.settings, k.prefs));
}

/* 兩段式確認：第一下改文案並武裝，第二下才真的做，4 秒沒動作自動解除。
   ⚠️ **用這個而不是 confirm()。** confirm 會擋住整個畫面，而使用者這一刻最需要
      看到的就是「我要刪的是什麼」——那些數字就在對話框背後那張卡上。
   onArm 是武裝當下的回呼：拿來把「會失去什麼」寫出來，並提醒先匯出。 */
function armTwoStep(btn, armedLabel, action, onArm) {
  if (!btn) return;
  var idle = btn.textContent;
  var armed = false;
  var timer = null;
  function disarm() {
    armed = false;
    btn.textContent = idle;
    btn.style.color = '';
  }
  btn.addEventListener('click', function () {
    if (!armed) {
      armed = true;
      btn.textContent = armedLabel;
      btn.style.color = 'var(--neg)';
      timer = setTimeout(disarm, 4000);
      if (onArm) onArm();
      return;
    }
    clearTimeout(timer);
    disarm();
    action();
  });
}

function downloadText(text, filename, mime) {
  var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  var a = document.createElement('a');
  var url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* ── ⑩ 初始設定狀態與操作時間模型 ─────────────────────────────
   對應 STRATEGY.md 第二節第 8 項「勸退門檻拆首次／回訪」。

   ⚠️ 這一段取代了原本寫死在兩個地方的門檻數字
      （calculator.html 的 VERDICT_WORTH_IT/CONSIDER 3000/1000、
       eligibility.html 的 ELIG_MIN_WORTH/CONSIDER）。
      同一個「值不值得」的結論全站只有這裡一個來源，不要再各頁另立一套。

   ## 為什麼改

   舊版把「第一次」的成本套用在**每一次**：不管你是第一次來還是第五次，
   門檻都是 NT$3,000／NT$1,000。但首次成本（啟用驗證器、註冊 CSFloat、
   綁交易連結、第一次入金）是**一次性投資**，第二次以後不用再付。
   把它攤在每一筆上，等於系統性地勸退了本來該做的人。

   ## 判定「已經是回訪者」用什麼

   指南頁「只做一次」的五個步驟全部勾完 → `doneAt` 有值 → 之後一律用回訪成本。

   ⚠️ 刻意**不用**到訪次數。來看五次但一次都沒買過的人，操作時間仍然是
      第一次的那個數字；到訪次數量的是「看過」不是「做過」。

   ⚠️ `localStorage` 不跨裝置：桌機設定完、手機打開會退回首訪。所以
      指南頁一定要保留一個「我在別的裝置設定過了」的手動開關，
      那不是便利功能，是這個判定方式的必要補丁。

   ## 時間怎麼算

   舊文件用兩個常數：首次 1.5 小時、回訪 0.3 小時。
   ⚠️ **0.3 小時這個估計 DECISIONS.md 五節自己標著「很可疑」**——
      NT$5,000 客單若用 US$0.5 的箱子湊，等於在 CSFloat 買 300 件、
      七天後在 Steam 掛 300 筆。買 20 件和買 300 件差 10 倍以上，
      用同一個常數蓋掉就是那個坑。

   所以改成：時間 = 每輪固定 + 每件變動 × 件數。件數試算器本來就知道。

   ⚠️⚠️ **下面三個分鐘數全部是「照操作步驟數推估」的，沒有任何實測。**
        它們是目前唯一有結構的估計，不是量出來的事實。
        驗證方式只有一個：**自己完整跑一輪並實際計時**（買進計一次、
        七天後掛單再計一次），然後回來改這三個數字。
        DECISIONS.md 五節已把它列為待驗證假設。 */
/* ⚠️ 2026-08-24 調整（護欄 3 要求理由寫進 commit message，這裡也留一份）：
   入金原本被當成一次性的事（「完成第一次入金」），算在 setupMinutes 裡。
   那是錯的——CSFloat 是**錢包制**，餘額每一輪都會花光，所以入金是每輪都要做的。
   時間跟著搬：

     setupMinutes      45 → 40   扣掉入金那一次的操作本身（約 5 分鐘）。
                                 ⚠️ 不是扣滿：第一次入金裡有一塊真的只做一次
                                    （綁付款方式、搞懂錢包制），那塊留在首次成本。
     roundFixedMinutes 10 → 15   每輪多一次入金（登入、輸金額、付款、等到帳）。

   方向檢查：每輪成本提高＝門檻變嚴＝更容易勸退，是保守的那一邊。
   首次成本略降只影響「加註」不影響判定（首訪者本來就不擋）。 */
var OP_TIME = {
  setupMinutes:      40,  // 一次性：驗證器設定、確認資格、註冊 CSFloat、綁交易連結、綁付款方式
  roundFixedMinutes: 15,  // 每輪固定：查價、決定組合、登入、**入金**、確認餘額
  perItemMinutes:    0.4  // 每件約 24 秒＝CSFloat 逐筆買 + 七天後 Steam 逐件上架
};

/* 2026 年基本工資時薪。門檻的分母只有這一個，不讓使用者自填。

   ⚠️ 護欄 3（DECISIONS.md）：門檻是從時間價值推出來的，不是從營收推出來的。
      要調這個數字，理由必須寫進 commit message。 */
var HOURLY_WAGE_TWD = 196;

/* 值得做的安全倍數：省下的錢要大於時間成本的幾倍才算值得做。

   ⚠️ 取 2 不是精算值，是風險補償。打平（1 倍）只是拿時間換等值的錢，
      但這件事還額外要求你把資金鎖 7 天，而 4.7 實測最差的一筆賣價
      落差是 −22.35%。1 倍沒有任何餘裕吸收那個風險。 */
var VERDICT_SAFE_MULTIPLE = 2;

var SETUP_STORAGE_KEY = 'sah-setup-v1';

/* 指南頁「只做一次」的四個步驟（2026-08-24 前是五個、且住在 setup.html）。
   id 同時是 localStorage 裡的 key，上線後不要改。
   fromElig：可以從資格快檢（sah-eligibility-v2）的哪一題自動帶入。

   ⚠️ 2026-08-24 拿掉 `funded`（「完成第一次入金」）。CSFloat 是錢包制，
      餘額每輪都會花光，入金根本不是一次性的事——它現在是指南頁下半段
      「每一輪都要做」的第 2 步。

   ⚠️ 舊的 `sah-setup-v1.steps` 裡可能還留著 `funded`，那沒關係：
      這份清單是唯一的判定依據，多出來的 key 不會被讀到，**不需要遷移**。
      但反過來會有一個過渡狀態：本來勾了四項、只差 `funded` 的人，
      現在四項就是全部了，卻還沒有 `doneAt`（那是在 setStep 裡蓋的）。
      指南頁的 reconcileDone() 負責補上，見該頁註解。 */
var SETUP_STEPS = [
  { id: 'authenticator', fromElig: { q: 'q2', pass: 'yes' } },
  { id: 'spend5',        fromElig: { q: 'q1', pass: 'yes' } },
  { id: 'notrestricted', fromElig: { q: 'q3', pass: 'no'  } },
  { id: 'csfloat',       fromElig: null }
];

function readSetupState() {
  var s = null;
  try { s = JSON.parse(localStorage.getItem(SETUP_STORAGE_KEY) || 'null'); } catch (e) { /* 無痕模式 */ }
  if (!s || typeof s !== 'object') s = {};
  if (!s.steps || typeof s.steps !== 'object') s.steps = {};
  if (!s.doneAt) s.doneAt = null;
  if (!s.source) s.source = null;   // 'checklist'（逐項勾完）｜'manual'（別的裝置設定過）
  return s;
}
function writeSetupState(state) {
  try { localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 無痕模式 */ }
}

/* 這個瀏覽器已經走完初始設定了嗎。
   ⚠️ 回傳 false 只代表「這台裝置上沒有紀錄」，不代表這個人沒做過。
      所以首訪的處理方式是**照樣給結論、另外標示首次成本**，
      不是把人擋在設定頁前面。 */
function isSetupDone() {
  return !!readSetupState().doneAt;
}

/* 這一輪要花多少分鐘。qty 是購買組合的總件數。
   回傳 { round, setup, total }，單位都是分鐘。 */
function opMinutes(qty) {
  var n = Number(qty);
  if (!(n > 0)) n = 0;
  var round = OP_TIME.roundFixedMinutes + OP_TIME.perItemMinutes * n;
  return { round: round, setup: OP_TIME.setupMinutes, total: round + OP_TIME.setupMinutes };
}

function minutesToTwd(min) {
  return (Number(min) || 0) / 60 * HOURLY_WAGE_TWD;
}

/* 給畫面用的分鐘數說法。刻意取整到 5 分鐘——這是估計值，
   顯示成「87 分鐘」會讓人以為它量過。 */
function minutesText(min) {
  var m = Math.round((Number(min) || 0) / 5) * 5;
  if (m < 60) return '約 ' + Math.max(5, m) + ' 分鐘';
  var h = Math.floor(m / 60), r = m % 60;
  return '約 ' + h + (r ? ' 小時 ' + r + ' 分鐘' : ' 小時');
}

/* 值不值得。savingsTwd 是這一筆省下的錢，qty 是組合總件數。
   回傳 { tier:'go'|'maybe'|'no', label, roundMin, roundCost, setupCost, setupDone } */
function worthVerdict(savingsTwd, qty) {
  var m = opMinutes(qty);
  var roundCost = minutesToTwd(m.round);
  var s = Number(savingsTwd) || 0;
  var tier = s < roundCost ? 'no'
           : (s < roundCost * VERDICT_SAFE_MULTIPLE ? 'maybe' : 'go');
  return {
    tier: tier,
    label: tier === 'go' ? '值得做' : (tier === 'maybe' ? '可考慮' : '不建議'),
    roundMin: m.round,
    roundCost: roundCost,
    setupCost: minutesToTwd(m.setup),
    setupDone: isSetupDone()
  };
}

/* ── ⑪ Steam 手續費換算 ─────────────────────────────────────
   使用者回填「實際成交價」時填的是 **Steam 頁面上的標價**，也就是
   **買家付的錢（毛額）**。要跟本站的 `steam_income`（賣家實拿，淨額）
   相比，必須先扣掉手續費。

   ⚠️⚠️ 這是 `DECISIONS.md` 4.7 已經踩過一次的坑，而且踩的方式是
      「用毛額去比淨額，憑空生出一個 −13% 的假缺口」，然後差點據此
      推翻一個本來就正確的結論。**不要讓使用者自己換算，也不要在
      任何地方把兩者直接相減。**

   ⚠️ 不是 `× 0.85`。5% + 10% 是對**賣家淨額**收的，不是對賣價：
        買家付的錢 = 賣家淨額 × 1.15
      寫成乘法會低估約 2.3%。

   ⚠️ 兩個分量**各自**有 US$0.01 最低收費，所以低價品項的實際費率
      高於 15%。這裡的算法刻意與後端 `update_derived_fields.py` 的
      `calc_steam_income()` 逐步對齊（含 floor 與下限），**改一邊就要
      改另一邊**，否則前端算出來的實拿會跟資料庫的 `steam_income` 對不上。

   單位是 USD，因為那兩個下限是美分。台幣要先換成美元再進來。 */
var STEAM_FEE_RATE = 0.05;
var STEAM_PUBLISHER_FEE_RATE = 0.10;
var STEAM_MIN_FEE_COMPONENT_USD = 0.01;

function steamNetUsd(grossUsd) {
  var g = Number(grossUsd);
  if (!isFinite(g) || g <= 0) return 0;
  var grossCents = Math.round(g * 100);
  var estNetCents = grossCents / (1 + STEAM_FEE_RATE + STEAM_PUBLISHER_FEE_RATE);
  var minCents = STEAM_MIN_FEE_COMPONENT_USD * 100;
  var feeCents = Math.max(Math.floor(estNetCents * STEAM_FEE_RATE), minCents);
  var pubCents = Math.max(Math.floor(estNetCents * STEAM_PUBLISHER_FEE_RATE), minCents);
  return Math.max(grossCents - feeCents - pubCents, 0) / 100;
}

/* ── ⑮ Steam 台幣市場的手續費（2026-08-24 實測解出）──────────
   ⚠️ 台灣帳號是在 **TWD 市場**掛單，而台幣的手續費規則跟美元**不一樣**。
      這一段取代低價品項上的 `steamNetUsd()`，不是補充。

   作者在 Steam 賣出畫面實填四個價位，抄回「您將收到」（DECISIONS 4.17）：

     NT$3 → 1     NT$12 → 10     NT$20 → 17     NT$30 → 26

   四個點只有一個模型全中：

     手續費 = max(round(實收 × 5%), 1) + max(round(實收 × 10%), 1)
     賣價   = 實收 + 手續費                    （單位：**整數新台幣**）

   ⚠️ 跟美元版的兩個差別，都會咬人：

     ① **最低收費 NT$1／分量（合計 NT$2）**，不是 US$0.01／分量（≈NT$0.64）。
        **3.1 倍。**
     ② **取整是 `round` 不是 `floor`。** floor 會把 NT$30 算成 27、NT$20 算成 18，
        兩個都錯。NT$20 那一點就是專門為了分辨這件事去取的。

   ⚠️ 佐證：`priceoverview` 的 TWD `lowest_price` 三次都是整數
      （NT$8／NT$2,931／NT$5,053），`median_price` 才有小數——
      **掛單價是整數元**，中位數只是統計值。

   ⚠️⚠️ **這個錯誤與推薦順序同向，這才是它真正危險的地方。**
      下限只咬低價品項（US$0.5 以上幾乎沒差、US$0.3 以下急速惡化），
      而低價品項的倍率因此被灌水，**計算器的組合演算法永遠先挑倍率最高的**
      ——它會優先推薦錯得最厲害的品項。

   ⚠️ 不要為了「跟美元版一致」把這裡改成 floor。美元版那組期望值是拿本站自己的
      `calc_steam_income()` 產生的，**從來沒有對過 Steam 的真實輸出**；
      它「正確」只證明前後端一致。要動美元版，先照這次的做法去 Steam 實測。 */
var STEAM_TWD_MIN_FEE_COMPONENT = 1;   // 每個分量最低 NT$1

/* 賣家實拿 NT$net（整數元）→ Steam 會收多少手續費（整數元）。

   ⚠️⚠️ **為什麼是 `(r+10)/20` 而不是 `Math.round(r * 0.05)`。**
      兩者在 JS 裡結果完全相同（r = 0…200000 逐一比對過，零筆差異），
      改成整數式**不是為了 JS**，是為了**後端那份 Python 實作**：

        Python 的 round() 是 **banker's rounding**（四捨六入五成雙）。
          round(2.5) → 2      Math.round(2.5) → 3
          round(0.5) → 0      Math.round(0.5) → 1

        直接把這一段照抄成 Python 會在 **20 萬個值裡差 15,000 個**
        （5% 那項每 20 個差 1 個、10% 那項每 10 個差 1 個），
        而且**不會報錯**——資料庫裡的 steam_income_twd 會安靜地錯。

      整數式沒有浮點數也沒有取整慣例的差異，兩邊照抄就一定一致。
      推導：round_half_up(r × 5/100) = floor((r + 10) / 20)
            round_half_up(r × 10/100) = floor((r + 5) / 10)

   ⚠️ 要改費率就不能再用這兩個常數式。改之前先回去讀 DECISIONS 4.17，
      並且**兩份實作要一起改**（這裡與 code/common/update_derived_fields.py）。 */
function steamFeeTwd(netTwd) {
  var r = Math.max(0, Math.round(Number(netTwd) || 0));
  return Math.max(Math.floor((r + 10) / 20), STEAM_TWD_MIN_FEE_COMPONENT)
       + Math.max(Math.floor((r + 5) / 10), STEAM_TWD_MIN_FEE_COMPONENT);
}

/* 賣價（買家付的錢，整數元）→ 賣家實拿。
   ⚠️ 與 Steam 一樣是**反解**：找出使「實拿 + 手續費 ≤ 賣價」的最大實拿。
      不要寫成「賣價 × 0.87」那種近似——下限咬進來的時候差到 20% 以上。
   ⚠️ 二分搜尋成立的前提是 `R + steamFeeTwd(R)` 對 R **單調不遞減**。
      現在的手續費是兩個 max(round(比例), 常數) 相加，兩項都單調，所以成立。
      **改動 steamFeeTwd 之前先確認這件事還成立**，不然這裡會回錯答案而且不會報錯。 */
function steamNetTwd(grossTwd) {
  var g = Math.floor(Number(grossTwd) || 0);
  if (!(g > 0)) return 0;
  var lo = 0, hi = g;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (mid + steamFeeTwd(mid) <= g) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ── ⑮-c 保本掛價 breakEvenAskTwd()（2026-09-12）─────────────
   回答賣出頁上唯一一個「要不要現在賣掉」會用到的數字：
   **掛到多少以上，這一批就不會是負收益。**

   使用者的實際用途是評估「賣給最高求購價（快速賣出）」划不划算——
   那個價格 Steam 畫面上看得到，但**本站沒有**（`priceoverview` 只有
   lowest / median / volume，最高求購在 `itemordershistogram`）。
   所以這裡不預測、不建議，只給一條線，比對留給使用者。

   ⚠️ **這是 Steam 標價（買家付的錢），不是你實拿。** 跟回填欄同一套講法，
      畫面上一定要寫出來——拿它去跟「實拿」那個數字比是錯的。

   算式（不需要二分搜尋，有精確解）：

     每件最低實拿  n = ceil(實付總額 ÷ 件數)      整數元
     保本掛價      x = n + steamFeeTwd(n)

   `steamNetTwd(n + steamFeeTwd(n)) === n`，所以 x 就是「實拿 ≥ n」的
   最小整數標價。台幣掛單價本來就是整數元（4.17），不必再取整。

   ⚠️⚠️ **一定要逐件算，不可以拿總額去反解。**
      NT$1／分量的下限是**每件咬一次**：13 件實付 280 的保本價是
      breakEven(280,13) = 每件實拿 22 → 掛 25；
      拿總額反解會得到「整批掛 313」→ 每件 24，**低估 1 元／件**，
      而低價品項上這個方向就是「其實在賠卻說有賺」。

   ⚠️ `ceil` 是刻意往保守走（寧可多算幾角）。護欄 3 要的保守是寧可勸退，
      而這個數字錯的方向如果是低估，使用者會照著它賣掉。

   ⚠️ 件數是估計值時（沒填「實際買到幾個」，退回計畫數量）**分母就是估的**：
      件數高估 → 保本價低估 → 在會賠的時候說有賺。函式照算，
      **呼叫端必須把「估」標出來**（2026-09-12 決定：標記而不是擋掉）。

   回傳 null = 算不出來（沒有實付總額、或件數不明），呼叫端要說去哪裡補，
   ⚠️ 不要印 0——0 會被讀成「掛多少都不賠」。 */
function breakEvenAskTwd(paidTwd, qty) {
  var paid = Number(paidTwd);
  var q = Math.floor(Number(qty));
  if (!isFinite(paid) || paid <= 0) return null;
  if (!isFinite(q) || q <= 0) return null;
  var net = Math.ceil(paid / q);          /* 每件至少要實拿這麼多（整數元） */
  return net + steamFeeTwd(net);
}

/* ── ⑮-b 沒有台幣報價時，這個品項還能不能信 ──────────────────
   （2026-09-04）

   ⑮ 解決的是「**有**台幣報價時要用哪條規則」。這一段解決的是它的補集：
   `steam_income_twd` 缺席時（新品項還沒被台幣抓過、或遷移沒跑完），
   全站只剩「美元實拿 × 匯率」這條退路，而**那條路在低價品項上是錯的**。

   4.17 量到的誤差隨價格急速惡化：

     買方價 US$0.50 以上 → 差 ≤1.2%      （NT$1 的下限幾乎不咬）
     買方價 US$0.30      → 差 +7.4%
     買方價 US$0.22      → 差 +27.3%，倍率 +21.4%

   ⚠️⚠️ **只是「講出來」不夠。** 舊做法是照樣放進候選池、另外顯示一行黃字，
      但誤差與推薦順序**同向**——倍率被灌水的品項會被組合演算法優先挑走，
      於是黃字響的當下，畫面上金額佔比最高的正好就是錯得最厲害的那一顆。
      2026-09-04 線上實測：一顆 NT$1.93、沒有台幣報價的品項拿走了 20% 的金額
      與 267 件中的 236 件，而它的真實實拿趨近於零（NT$2 的手續費下限）。
      **警語要留，但同時要把它擋在池子外面。**

   ⚠️ 為什麼是「低於門檻才排除」而不是「一律排除」：
      US$0.50 以上退回路徑的誤差 ≤1.2%，在本站其他噪音之下。一律排除會讓
      「遷移被回滾」這種情況直接把整個候選池清空，而那是拿一個**可用**的
      近似去換一個**不可用**的空畫面。門檻只砍掉近似真的失效的那一段。

   ⚠️ 門檻寫成**買方價**，因為 4.17 的量測是在買方價上做的；
      實際比對時用 steamNetUsd() 換成實拿，跟著費率規則一起走，
      不要在這裡寫死一個換算後的常數。 */
var TWD_FALLBACK_SAFE_GROSS_USD = 0.50;

/* netUsd = cases_data 的 steam_income（美元實拿）。
   回傳 true = 沒有台幣報價時仍然可以用美元路徑近似。 */
function twdFallbackUsable(netUsd) {
  var n = Number(netUsd);
  if (!isFinite(n) || n <= 0) return false;
  return n >= steamNetUsd(TWD_FALLBACK_SAFE_GROSS_USD);
}

/* 一列 cases_data → 該顯示的台幣數字（2026-08-24）。

   ⚠️ 這個函式存在的唯一理由是**不要讓四個頁面各算一次**。
      marketlist / case / calculator / sell 都要把同一列資料換成台幣，
      而換算規則有三個容易各自寫歪的地方：
        ① 台幣欄位在不在（遷移沒跑、或那一輪台幣沒抓到）
        ② 缺席時退回哪一條路（美元 × 匯率，會在低價品項高估實拿）
        ③ 倍率的分母用哪一個匯率
      PROJECT_OVERVIEW〈三個會重複踩的坑〉第 1 條就是這種「各自重算、邏輯分歧」。

   參數 row 是 cases_data 的一列，rate 是**中間價**（不是 buyRate）。

   ⚠️ 分母刻意用中間價、不含刷卡的 1.5%：
      這裡是瀏覽用的市場倍率，而 1.5% 對所有品項是同一個常數，加了不影響排序。
      試算頁的「實際倍率」會比這個低約 1.5%，那是對的——兩者量的不是同一件事，
      不要為了對齊而改其中一邊。見第⑭節。

   回傳 isTwd：**畫面上要講出來**這一列是真台幣還是換算的。
   ⚠️ 不要把 isTwd=false 靜靜地當成一樣的東西——退回路徑在 US$0.22 的品項上
      高估實拿 27.3%、倍率 21.4%，而且錯誤方向與推薦順序同向。 */
function twdView(row, rate) {
  var r = Number(rate);
  if (!isFinite(r) || r <= 0) r = 0;
  var costUsd = Number(row && row.csfloat_cost) || 0;
  var hasTwd = row && row.steam_income_twd !== null && row.steam_income_twd !== undefined;

  var priceTwd = (row && row.steam_price_twd !== null && row.steam_price_twd !== undefined)
    ? Number(row.steam_price_twd)
    : (Number(row && row.steam_price) || 0) * r;
  var incomeTwd = hasTwd
    ? Number(row.steam_income_twd)
    : (Number(row && row.steam_income) || 0) * r;
  var costTwd = costUsd * r;

  return {
    isTwd: !!hasTwd,
    steamPriceTwd: priceTwd,
    steamIncomeTwd: incomeTwd,
    csfloatCostTwd: costTwd,
    netProfitTwd: incomeTwd - costTwd,
    /* ⚠️ 一律重算，不要直接讀 row.ratio。資料庫的 ratio 是**純美元**的
          （後端刻意不寫 ratio_twd，理由見 update_derived_fields.py），
          而台幣實拿跟美元實拿不是同一個常數倍——低價品項差很多。 */
    ratio: costTwd > 0 ? incomeTwd / costTwd : 0
  };
}

/* ── ⑭ 匯率：買進側與賣出側不是同一個數字 ────────────────────
   （2026-08-24 新增。實測見 DECISIONS.md 4.17）

   網站抓的是 open.er-api.com 的**中間價**（interbank mid-market），
   免費層**一天更新一次**。它是「銀行之間的參考價」，不是任何人實際換得到的價。

   ⚠️ 買進側：CSFloat 以美元計價，台灣使用者刷卡付款時，
      Visa／Mastercard 收約 1% 跨境交易費，發卡行再收 ≤0.5% 國外交易服務費，
      合計常見 **1.5%**（凱基銀行說明頁，2026-08-24 查證）。
      所以他實際付出去的台幣，比中間價換算出來的**多約 1.5%**。

   ⚠️⚠️ **這 1.5% 不在 `CSFLOAT_BUYER_FEE_RATE = 0.075` 裡面。**
      那 7.5% 是**美元內部**的入金費（2.8% + US$0.30，US$10 時等效 5.80%，
      與帳本實測 5.82% 吻合，見 DECISIONS 4.1／4.12）。
      兩者是**相乘不是相加**：實付台幣 = 美元價 × 1.075 × 匯率 × 1.015。
      所以加這 1.5% 不會吃掉 7.5% 的保守邊際，那是兩個不同層的成本。

   ⚠️ 為什麼一定要加：試算頁的「預估要花的現金」是使用者**拿去入金的依據**。
      低估 1.5% 的後果不是數字難看，是他照著入金之後錢包不夠，清單買不完。
      這正好踩到護欄「寧可高估成本、低估折扣」。

   ⚠️ 賣出側**不要**套這個。它換的是 Steam 錢包餘額，沒有經過刷卡。
      （賣出側另有問題，見 DECISIONS 4.17 與 site.js 第⑪節的待驗證註記。）

   ⚠️ 副作用要知道：試算頁的「實際倍率」＝台幣進／台幣出，會比市場列表的
      `ratio`（純美元市場比值）**低約 1.5%**。兩者量的不是同一件事，
      這是對的，不要為了對齊而把其中一邊改掉。 */
var FX_CARD_FEE_RATE = 0.015;

/* 買進側該用的匯率。呼叫端一律走這個，不要各頁自己乘 1.015。 */
function buyRate(midRate) {
  var r = Number(midRate);
  if (!isFinite(r) || r <= 0) return 0;
  return r * (1 + FX_CARD_FEE_RATE);
}

/* ── ⑬ 台幣顯示格式 ─────────────────────────────────────────
   全站台幣一律**兩位小數**（2026-08-24 改，原本各處寫死 `toFixed(0)`）。

   ⚠️ 為什麼需要小數：武器箱單價常只有 US$0.5，換算約 NT$16.25。
      顯示成「16」的時候，買 20 件的小計是 325 而不是 320——而小計是用
      **未取整**的值算的，於是畫面上「單價 × 數量 ≠ 小計」，想自己驗算的
      使用者直接卡住。PROJECT_OVERVIEW〈三個會重複踩的坑〉第 1 條講的就是
      這種對不起來，只是那次是欄位用錯、這次是顯示精度不夠。

   ⚠️ **只給顯示用。** 任何計算一律用原始浮點值，不要先格式化再 parse 回來——
      那會把捨入誤差累進到結果裡。

   ⚠️ **百分比、件數、成交量不要走這裡。** 它們不是金額，`toFixed(0)` 是對的。

   ⚠️ **兩位小數把落差壓小，但不會歸零。** 小計仍然是用未取整的值算的，
      所以「顯示的單價 × 數量」跟小計還是會差一點——差的是角分（例如
      16.24 × 88 = 1,429.12 vs 小計 1,428.68），不再是幾十元。
      要完全對齊只能把單價也顯示到更多位數，那反而更難讀。
      **不要為了讓兩個數字相等，改成用取整後的單價去算小計**——
      那會讓總額偏離你實際要付的錢，而總額才是使用者拿去入金的依據。

   ⚠️ 千分位由 `toLocaleString` 帶出來（12,345.67）。四位數以上的金額本來就
      很難一眼讀對，而現在多了兩位小數，沒有分隔會更難。 */
function fmtTwd(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return v.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* 使用者敲進來的金額，寫進 localStorage 或網址之前先收斂到兩位小數。
   ⚠️ 不收的話浮點誤差會被原樣存起來（例如 279.49999999999994），
      之後每次讀出來都帶著，而且會在「少了多少」那個減法裡放大。 */
function roundTwd(n) {
  var v = Number(n);
  if (!isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

/* ── ⑫ 資格快檢狀態 ─────────────────────────────────────────
   `eligibility.html` 的答案。三個頁面在讀它（eligibility / help /
   2026-08-24 起加上 index），key 字串原本各寫一份，集中到這裡。

   ⚠️ v2：q3 的 data-val 語意在 2026-08 修正過（yes 從「沒有限制」改成
      「有限制」）。沿用舊 key 會把舊答案讀成相反的意思，所以當時直接
      換版本號讓舊狀態自然失效。**不要改回 v1。**

   ⚠️ 判定條件必須與 `eligibility.html` 的 `isBlocking()` 一致。那一頁改了
      擋人的條件、這裡沒跟著改，首頁就會把一個資格頁明說「暫時還不行」
      的人直接送進試算頁。

   ⚠️ `passed` 為 false 有兩種完全不同的原因：**沒答過**，和**答了但被擋住**。
      所以回傳的是兩個旗標不是一個布林——把「沒答過」當成「不符合資格」，
      等於替一個什麼都還沒說的人宣告他不能用。 */
var ELIG_STORAGE_KEY = 'sah-eligibility-v2';

function readEligibility() {
  var s = null;
  try { s = JSON.parse(localStorage.getItem(ELIG_STORAGE_KEY) || 'null'); } catch (e) { /* 無痕模式 */ }
  if (!s || typeof s !== 'object') s = {};
  return s;
}

/* 這一題的答案會不會擋住使用。與 eligibility.html 的 isBlocking() 同一份判斷。 */
function eligIsBlocking(key, val) {
  if (key === 'q1') return val === 'no';
  if (key === 'q2') return val === 'no' || val === 'recent';
  if (key === 'q3') return val === 'yes';   // q3 問「有沒有限制」，有限制才是擋住
  if (key === 'q4') return val === 'no';
  return false;
}

/* 回傳 { answered, passed }。
   answered = 四題都答了（「不確定」也算答了）
   passed   = 四題都答了、沒有任何一題擋住，**而且沒有任何一題是「不確定」**
              ——不確定在資格頁本來就會列進待釐清清單，不能當成通過。 */
function eligibilityState() {
  var s = readEligibility();
  var answered = true, passed = true;
  ['q1', 'q2', 'q3', 'q4'].forEach(function (k) {
    var v = s[k];
    if (!v) { answered = false; passed = false; return; }
    if (v === 'unknown' || eligIsBlocking(k, v)) passed = false;
  });
  return { answered: answered, passed: passed };
}

/* ── ⑯ 單品歷史：走勢圖與「冷卻期 7 天過去怎麼動」（2026-09-11）─────────
   case.html 那兩張卡用的純函式。畫面（事件、tooltip）留在 case.html，
   這裡只放「給定資料 → 算出什麼」，零 DOM，test-history.js 直接跑。

   ⚠️⚠️ 三個設計決定都來自 DECISIONS 4.29，改之前先讀那一節：

   1. **只用每日中位數（`*_median`），不用單點欄位。** 4.15：單點快照有四分之一的
      波動是取樣噪音，畫成圖就是一根一根假的尖刺。中位數 8/14 起才有，
      當天的中位數隔天才寫，所以序列會停在「昨天」——這是對的，不要拿單點補。
   2. **畫兩邊各自的漲跌幅，不畫倍率。** 買完之後 CSFloat 怎麼動跟使用者無關，
      他承擔的只有 Steam 賣價；倍率把兩邊混在一起，CSFloat 同步下跌時會把
      Steam 側的損失蓋掉（4.29 二：Recoil 倍率 +0.64%、Steam 側 −3.34%）。
      用漲跌幅也順便避開換匯——圖上沒有任何一個台幣數字會跟上方卡片打架（4.23）。
   3. **不做「倍率在 30 天內算高還是算低」。** 2026-09-11 量過：當天倍率落在自己
      歷史前 20% 的，之後 7 天 Steam 賣價平均 −4.6%；後 20% 的 +0.7%。
      那張卡會在最糟的時點說「現在算高」——提示與錯誤同向，跟 4.22 同一種形狀。
      換成冷卻期統計：只講過去發生過什麼，不給時機建議。

   ⚠️ 冷卻期天數讀 COOLDOWN_DAYS（第⑥節），**不要在這裡另寫一個 7**。
   ⚠️ 缺日不內插（跟 analyze_7day_drift.py 同一條規矩）：圖上斷開，配對直接跳過。 */
var HISTORY_DAYS = 30;          // 走勢圖與冷卻期統計共用的視窗
var HISTORY_MIN_POINTS = 7;     // 少於 7 天不畫圖
var COOLING_MIN_PAIRS = 7;      // 少於 7 個「買進 → 7 天後」的起點不給統計

/* 系列色：dataviz 驗證器在本站卡片底色 #0f172a 上跑過（2026-09-11）——
   亮度帶、彩度、色盲分離（ΔE 26.8）、一般視覺分離（ΔE 31.8）、對比 ≥ 3:1 全過。
   ⚠️ 不要換成 --brand 青色：它跟灰色、紫色配都過不了驗證器。
   ⚠️ 顏色不是唯一的區分：CSFloat 那條另外用虛線，圖例與 tooltip 都有文字標籤。 */
var HISTORY_COLORS = { steam: '#3987e5', csfloat: '#d95926' };

function ymdAddDays(ymd, n) {
  var t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

function ymdDiffDays(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/* "2026-09-03" → "9/3" */
function ymdShort(ymd) {
  return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10));
}

/* 百分比顯示：+1.2% / −3.4% / 0.0%。負號用 U+2212，不是連字號。 */
function fmtPct(v, digits) {
  var d = digits === undefined ? 1 : digits;
  var s = Math.abs(v).toFixed(d);
  if (Number(s) === 0) return (0).toFixed(d) + '%';
  return (v > 0 ? '+' : '−') + s + '%';
}

/* cases_ratio_history 的列（順序不拘）→ 走勢序列。
   回傳 null（完全沒有中位數）或
   { from, to, points: [{ d, s, c, sPct, cPct }], sChg, cChg, tooFew }
     s / c       ＝ 當天 Steam 賣價／CSFloat 買價的中位數（美元，只拿來算比例）
     sPct / cPct ＝ 相對視窗第一天的漲跌幅（%）
   視窗是「最後一個有中位數的日子」往回 HISTORY_DAYS 天。 */
function historySeries(rows, days) {
  var win = days || HISTORY_DAYS;
  var pts = (rows || []).map(function (r) {
    return {
      d: String((r && r.snapshot_date) || '').slice(0, 10),
      s: Number(r && r.steam_price_median),
      c: Number(r && r.csfloat_price_median),
    };
  }).filter(function (p) {
    return /^\d{4}-\d{2}-\d{2}$/.test(p.d) && isFinite(p.s) && p.s > 0 && isFinite(p.c) && p.c > 0;
  }).sort(function (a, b) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });
  if (!pts.length) return null;

  var to = pts[pts.length - 1].d;
  var from = ymdAddDays(to, -(win - 1));
  pts = pts.filter(function (p) { return p.d >= from; });
  var s0 = pts[0].s, c0 = pts[0].c;
  pts.forEach(function (p) {
    p.sPct = (p.s / s0 - 1) * 100;
    p.cPct = (p.c / c0 - 1) * 100;
  });
  var last = pts[pts.length - 1];
  return {
    from: pts[0].d, to: to, points: pts,
    sChg: last.sPct, cChg: last.cPct,
    tooFew: pts.length < HISTORY_MIN_POINTS,
  };
}

/* 最多能切出幾段「互不重疊」的 COOLDOWN_DAYS 天。與 analyze_7day_drift.py 的
   independent_windows() 同一個貪婪法：從最早的起點開始取，取一段就跳過它蓋住的天數。
   ⚠️ 只扣時間上的重疊；這個數字是上界，不是「幾次獨立觀察」。 */
function independentWindows(dates) {
  var uniq = {}, list = [];
  (dates || []).forEach(function (d) { if (!uniq[d]) { uniq[d] = 1; list.push(d); } });
  list.sort();
  var count = 0, cursor = null;
  list.forEach(function (d) {
    if (cursor === null || d >= cursor) { count++; cursor = ymdAddDays(d, COOLDOWN_DAYS); }
  });
  return count;
}

/* 走勢序列 → 「任何一天買、COOLDOWN_DAYS 天後賣」的 Steam 賣價變化。
   回傳 { n, tooFew } 或
   { n, median, worst: { chg, from, to }, ups, windows }
     ups     ＝ 7 天後賣價**嚴格高於**買進當天的次數（持平不算漲）
     windows ＝ independentWindows()，畫面上要跟 n 一起講，否則 n 會被當成獨立樣本數
   ⚠️ 只看 Steam 側（見本節開頭第 2 點）。 */
function coolingStats(series) {
  var pts = (series && series.points) || [];
  var byDate = {};
  pts.forEach(function (p) { byDate[p.d] = p; });
  var pairs = [];
  pts.forEach(function (p) {
    var q = byDate[ymdAddDays(p.d, COOLDOWN_DAYS)];
    if (q) pairs.push({ from: p.d, to: q.d, chg: (q.s / p.s - 1) * 100 });
  });
  if (pairs.length < COOLING_MIN_PAIRS) return { n: pairs.length, tooFew: true };

  var sorted = pairs.map(function (x) { return x.chg; }).sort(function (a, b) { return a - b; });
  var m = sorted.length;
  var median = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
  var worst = pairs[0];
  pairs.forEach(function (x) { if (x.chg < worst.chg) worst = x; });
  return {
    n: m,
    median: median,
    worst: { chg: worst.chg, from: worst.from, to: worst.to },
    ups: pairs.filter(function (x) { return x.chg > 0; }).length,
    windows: independentWindows(pairs.map(function (x) { return x.from; })),
    tooFew: false,
  };
}

/* 座標換算。圖與 case.html 的 hover 共用同一份，才不會「線畫在這、十字線對在那」。
   x 用**日期**不是索引：缺日在圖上是一段空白，不會被擠掉。 */
var HISTORY_PAD = { l: 44, r: 58, t: 12, b: 26 };

function historyScales(series, W, H) {
  var P = HISTORY_PAD, pts = series.points;
  var lo = 0, hi = 0;
  pts.forEach(function (p) {
    lo = Math.min(lo, p.sPct, p.cPct);
    hi = Math.max(hi, p.sPct, p.cPct);
  });
  var span = Math.max(hi - lo, 2);
  var steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  var step = steps[steps.length - 1];
  for (var i = 0; i < steps.length; i++) { if (steps[i] >= span / 4) { step = steps[i]; break; } }
  var yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
  if (yMax - yMin < step) yMax = yMin + step;
  var ticks = [];
  for (var v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  var days = Math.max(ymdDiffDays(series.from, series.to), 1);
  var plotW = W - P.l - P.r, plotH = H - P.t - P.b;
  return {
    W: W, H: H, ticks: ticks, yMin: yMin, yMax: yMax,
    x: function (d) { return P.l + ymdDiffDays(series.from, d) / days * plotW; },
    y: function (v) { return P.t + (yMax - v) / (yMax - yMin) * plotH; },
  };
}

/* 一條線的 path。相鄰兩點差超過一天就斷開（缺日不內插）。 */
function historyPath(points, key, sc) {
  var out = '', prev = null;
  points.forEach(function (p) {
    var cmd = (prev && ymdDiffDays(prev.d, p.d) === 1) ? 'L' : 'M';
    out += cmd + sc.x(p.d).toFixed(1) + ' ' + sc.y(p[key]).toFixed(1) + ' ';
    prev = p;
  });
  return out.trim();
}

/* 走勢圖的 SVG 字串（純字串，零 DOM）。hover 用的十字線與兩顆點預先放好、預設隱藏，
   由 case.html 移動。文字一律走文字色，不穿系列色（系列色只給線與圖例的線段）。 */
function historyChartSvg(series, W, H) {
  var sc = historyScales(series, W, H), P = HISTORY_PAD, pts = series.points;
  var C = HISTORY_COLORS, out = [];
  var label = 'Steam 賣價 ' + fmtPct(series.sChg) + '、CSFloat 買價 ' + fmtPct(series.cChg) +
              '（' + ymdShort(series.from) + ' 到 ' + ymdShort(series.to) + '）';
  out.push('<svg class="hist-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
           '" role="img" tabindex="0" aria-label="' + label + '" style="display:block;max-width:100%;overflow:visible">');

  // 格線（1px 實線、壓低）與 y 軸刻度
  sc.ticks.forEach(function (t) {
    var y = sc.y(t).toFixed(1);
    out.push('<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y + '" y2="' + y + '" stroke="' +
             (t === 0 ? '#334155' : '#1e293b') + '" stroke-width="1"/>');
    out.push('<text x="' + (P.l - 8) + '" y="' + (+y + 4) + '" text-anchor="end" font-size="11" fill="#64748b" ' +
             'style="font-variant-numeric:tabular-nums">' + fmtPct(t, t % 1 ? 1 : 0) + '</text>');
  });

  // x 軸：頭、中、尾三個日期
  var mid = ymdAddDays(series.from, Math.round(ymdDiffDays(series.from, series.to) / 2));
  [[series.from, 'start'], [mid, 'middle'], [series.to, 'end']].forEach(function (a) {
    out.push('<text x="' + sc.x(a[0]).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + a[1] +
             '" font-size="11" fill="#64748b">' + ymdShort(a[0]) + '</text>');
  });

  // 兩條線：CSFloat 先畫（在下），Steam 後畫（在上、是使用者要看的那一條）
  out.push('<path d="' + historyPath(pts, 'cPct', sc) + '" fill="none" stroke="' + C.csfloat +
           '" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>');
  out.push('<path d="' + historyPath(pts, 'sPct', sc) + '" fill="none" stroke="' + C.steam +
           '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');

  // 線尾的點與數值（直接標籤）。兩個數值太近就上下分開，並用短引線接回去。
  var last = pts[pts.length - 1], xe = sc.x(last.d);
  var ends = [
    { key: 'sPct', color: C.steam, y: sc.y(last.sPct) },
    { key: 'cPct', color: C.csfloat, y: sc.y(last.cPct) },
  ];
  ends.forEach(function (e) { e.ly = e.y; });
  if (Math.abs(ends[0].y - ends[1].y) < 14) {
    var up = ends[0].y <= ends[1].y ? ends[0] : ends[1], dn = up === ends[0] ? ends[1] : ends[0];
    var m = (ends[0].y + ends[1].y) / 2;
    up.ly = m - 7; dn.ly = m + 7;
  }
  ends.forEach(function (e) {
    out.push('<circle cx="' + xe.toFixed(1) + '" cy="' + e.y.toFixed(1) + '" r="3.5" fill="' + e.color +
             '" stroke="#0f172a" stroke-width="2"/>');
    if (Math.abs(e.ly - e.y) > 0.5) {
      out.push('<line x1="' + (xe + 4).toFixed(1) + '" y1="' + e.y.toFixed(1) + '" x2="' + (xe + 9).toFixed(1) +
               '" y2="' + e.ly.toFixed(1) + '" stroke="#64748b" stroke-width="1"/>');
    }
    out.push('<text x="' + (xe + 11).toFixed(1) + '" y="' + (e.ly + 4).toFixed(1) + '" font-size="11" fill="#94a3b8" ' +
             'style="font-variant-numeric:tabular-nums">' + fmtPct(last[e.key]) + '</text>');
  });

  // hover 層：十字線、兩顆焦點、整塊透明的感應區（比線粗很多，指到日期就好）
  out.push('<line class="hist-cross" x1="0" x2="0" y1="' + P.t + '" y2="' + (H - P.b) +
           '" stroke="#94a3b8" stroke-width="1" visibility="hidden"/>');
  out.push('<circle class="hist-dot-s" r="4" fill="' + C.steam + '" stroke="#0f172a" stroke-width="2" visibility="hidden"/>');
  out.push('<circle class="hist-dot-c" r="4" fill="' + C.csfloat + '" stroke="#0f172a" stroke-width="2" visibility="hidden"/>');
  out.push('<rect class="hist-hit" x="' + P.l + '" y="0" width="' + (W - P.l - P.r) + '" height="' + H +
           '" fill="transparent"/>');
  out.push('</svg>');
  return out.join('');
}

/* ── ⑰ 品項圖片（2026-09-15）─────────────────────────────────
   圖片沒有進 repo，也沒有任何截圖：`<img>` 直接指向 Steam 自己的 CDN
     https://community.cloudflare.steamstatic.com/economy/image/<icon_url>/<尺寸>
   下面存的只是每個品項的 `icon_url`——Steam 市場端點回傳的那串雜湊。

   ⚠️ **為什麼是寫死的對照表，不是 `cases_data` 加一欄。**
      箱子的圖幾乎不會變，而加一欄要動 schema、抓價腳本與一次 migration，
      三個地方全都在「每 3 小時跑一次的正式流程」上。
      對照表的代價只有一個：**新品項要補一筆**，而沒補的後果只是那一列不顯示圖
      ——不破版、不報錯、價格照樣正確。補的方法不用手抄：
        node tools/fetch-case-icons.js          （印出整段，貼回來換掉）
        node tools/fetch-case-icons.js --check  （只比對，缺哪幾個品項會列出來）

   ⚠️ **這些圖是 Valve 的美術資產，本站沒有任何授權關係。** 所以：
      - 一律熱連對方的 CDN。**不要下載、不要轉存、不要放進 repo**
        ——那就從「引用一個網址」變成「重製並散布」，是完全不同的位置。
      - 頁尾那句「與 Valve、CSFloat 無任何合作或授權關係」是這件事的配套，不要拿掉。
      - `referrerpolicy="no-referrer"`：不要把使用者正在看哪一頁送給第三方。

   ⚠️ **alt 一律留空。** 每一個用到圖的地方，品項名都**就在旁邊**；
      再唸一次只會讓報讀使用者聽到兩次同樣的字。它是裝飾，不是資訊。

   ⚠️ **寬高一定要寫死在 `<img>` 上。** 市場列表一次 45 列，沒有寬高就是 45 次版面位移，
      而那張表本身可以排序——位移會讓正要點的人點到別列。 */

var CASE_ICON_BASE = 'https://community.cloudflare.steamstatic.com/economy/image/';

/* name（＝ cases_data.name ＝ market_hash_name）→ Steam icon_url 雜湊。
   2026-09-15 由 tools/fetch-case-icons.js 產生，涵蓋當時資料庫裡全部 45 個品項。 */
var CASE_ICONS = {
  'Chroma 2 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fqmwOuKD2PqI6caDBWDeUkO8uteM9SnDglklw6miEn9j6IHKfblNxA5pxW6dU5UH4LtBe',
  'Chroma 3 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHAVuKf7PaJucPLHW2TExb9z4OdvHirixEomtW7cyduvci2VZ1AiCsR2Q_lK7EdW_VBhrw',
  'Chroma Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fq2wP7qr6bqI5cvHDCzfBlbcv57JqF3zrxRkj4W6Dwo34dy6QPQAoC5ZyW6dU5cxvklfG',
  'Clutch Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHsVtqr8a_dsdKTAWDWVxLgjsrAwHSvgwEQk4m-ByYuqIC2eO1VyD5QiR_lK7EcxQQPYQA',
  'CS:GO Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bji61XxRCKg0MSz_nUDvPb-OPFvdKTFDzbAkbp16bY5Gn6wkx9ysj7Xntf9IC6WZgA-Sswnnj45WXo',
  'CS:GO Weapon Case 2': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bji61XxRCKj0M-xr3IIvqP5PqI_c6LDCjWUkrdw5LUwTivgkE9wsGnUnNr8InzBP1c-SswnzDatg2g',
  'CS:GO Weapon Case 3': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bji61XxRCKi0JS0pCZYvaCvOPI0eaHKWjGVmbovs7ZrHH_nl0oj5mXSzNqqdS7BaAc-SswnOWLoN2Y',
  'CS20 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3YVvfD9aqVveKaQDDKSl7134bg_HH3hlBty6z7Vn9v6eXmeZgBxWJd0EflK7Efs4hZiKQ',
  'Danger Zone Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3MVv_H4a6FucPPBWjDIkbdz4rg4Syyyxxsi5mzRntuvJCqVbwAgDZBwRPlK7EcZJ5GkQA',
  'Dreams & Nightmares Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnIV7Kb5OaU-JqfHDzXFle0u4LY8Gy_kkRgisGzcm4v4J3vDOAQmDMdyRvlK7EcmeCU3yw',
  'eSports 2013 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bjx-UnoUwniocSwrHEV7KaobPdud6HEWjXGmbYl6LIwHn2ywhgh5GzXzdmsc3yRalAkD5R3FvlK7Ed7JoXDRQ',
  'eSports 2013 Winter Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bjx-UnoUwniocSwrHFkvqbgafw-JKHKWTGSw7wmtOMxTX2yw0ki5DyGm4ugcirGPQ4nC5B3EbNetw74zIMdBc4CJw',
  'eSports 2014 Summer Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bjx-UnoUwniocSwrHZk_OejZaF_bvXGWT6Vkughs-A5H321kUQl5myEm9__dHKQaw8gWZtzQ7VYu0a-lYf5d7S1qrUfUsY',
  'Falchion Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fpWwI7Pb-P6Y5dvPEDGSSlrsh57U8HHHiwx5yt2-Dwo7_JSnCOw8oCJF0W6dU5dgrLNA1',
  'Fever Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frncVtqv7MPE8JaHHCj_Dl-wk4-NtFirikURy4jiGwo2udHqVaAEjDZp3EflK7EeSMnMs4w',
  'Fracture Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3QV7aD7OP01IfbGDzPCmbsm4LU5GnvkzUsi4WvUmIqtci_CPQNyApsjE_lK7EfrhW545A',
  'Gallery Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnYVuPD5baE6IfTFCmSRme0j5eU5SXrjkRwmt2rWnoqhdnjEPQQiDpRxTflK7EePRV2-Kg',
  'Gamma 2 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bjz61TqQCKj0JfipHMN7aX2bfM9eaPDXT7Glbx1s7Y8HHHnw0sltWXSmYmqcH-UaAU-Sswn_16VNj0',
  'Gamma Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHEVtvP5bPZrd6XECmOSxe0v4bRoTnnjwBkitWrRm4yoeX3GagMnCZZ2FPlK7EcEv22BnQ',
  'Glove Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHcVuPaoafU1JqiVWWSVkux15OQ8Giiylk0k5mvTnIqpd3PCaQIhWMYkE_lK7EcNeCKW-w',
  'Horizon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3IV6vSrbfw8eaiWCjWVkewgseM9TXyxl0wi6mSHn9-tIHqUbg5yDpEmEPlK7EcXFmSLsw',
  'Huntsman Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frmxY6qr9OqU0cvbKCGTDk7dys7k-S36yzU114GrRmNaoeSmXaVV0WJp0W6dU5Q_KKWwm',
  'Kilowatt Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnEVvqf_a6VoIfGSXz7Hlbwg57QwSS_mxhl15jiGyN37c3_GZw91W8BwRflK7EfKsa2sfw',
  'Operation Bravo Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj7-lz1QAn4kZjf9CsVuvf7OfQ5IabBVzbHlb915bcwHCjikEp_sTnTn4z6eH6RblQlC8RwFPlK7EdXSP0Ibg',
  'Operation Breakout Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fqWxdv_b8O_w5eKXBWWXHw-smtrBvTHDmwEsl4jvWn4z_I3qWZwV1X5ZwW6dU5RcRF1o0',
  'Operation Broken Fang Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3UVu6P-MPQ0dKbCVzLGx7wgtbM6S3jhw0V25m-EnNj7JS7GaQ4nD8QiRflK7EfH0YGFHg',
  'Operation Hydra Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHUVt_b6PfY1JfOSXDXJxbgjtLFqHnDqx0Qmtm_Vzdf4ICmUZlJ2C5F2TPlK7EdjN0FcPg',
  'Operation Phoenix Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr2wPtqP5PKVvJPSQDWSSl7sn6eMxHC3hwhl3sDuDztivJHrEagJzWZd3W6dU5fXcT7oM',
  'Operation Riptide Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3sVtvD2O_Q9dqfEXTWSlepz4bA5THnikx915z6BytmuIHiXaAdyDpEhTflK7EdW-TaRMg',
  'Operation Vanguard Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fqGwPtvP9MKA_JKOSCGGWmL8useQ6TXywwB8k4T-EyImgeCmXbA4oAsRzW6dU5QwRm5UL',
  'Operation Wildfire Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHMVu6r9MaA6ePPAWjbGwrwm47dtTnu2kUl14mzUnomudnqQaQ4iApF5TPlK7Ee3MsZV-w',
  'Prisma 2 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3cV6vT9avBvefWWDDGTxbZ14rhsTX7qkE90sDiHwt2pdC-TblJ2DsB1QPlK7Ee9riHKAA',
  'Prisma Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3AV6aD8O6BpdKKQVmPEwr1zs-c8Tnngl09w52zTmY2sc3jBag8jXpohE_lK7Ede7E2Kfw',
  'Recoil Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnMVu6b-avA-JqSSCjSWwuhz47U9TCzlxh9yt2WGnNqgIi-fbgUkWMNxFPlK7EdIJF6a2Q',
  'Revolution Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnAVvfb6aqduc_TFVjTCxbx05OU4S3jilE9w4DzRnImtIy2Sa1JzDJEhRPlK7EcO4U8gfA',
  'Revolver Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHIV7qWvOqE9IqSVWGKVlu8v6eM7Girmxkwl4TnWmIv8J36WagEiCpImQvlK7EclOzxxiQ',
  'Sealed Dead Hand Terminal': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnVk7P6he6FpbqHGCmSTk-hz5rZsHS3mwxgjsGjRytb7dC2VPwYlAschRrFbsBC4xNH5d7S1gfLQnNE',
  'Sealed Genesis Terminal': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frnRk7P6he6FpbqWXCzSVkL4h6bExTHuwx0wk6mjUmdn_Iy2TbAUkCZslQu8CtBTrkNz5d7S1oNprwEg',
  'Shadow Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fpGxet6H-O_Q6dfXCDzfJl7ci6bZoG3zjx0xz4ziEztj8IiiRa1QkWZdwW6dU5RegDbP-',
  'Shattered Web Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3EVvKD6MKU_cKPKXWHFxLkls7FsSnDqwUl_sWTczoqheHifbwMmD5F1RvlK7Ec_KL6Q_A',
  'Snakebite Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_fr3oVvvT4bfI4dvTLCGTCmLl16ec7TX_mk08k42iHwtqscy-WPVUmCZJ4R_lK7Ed8Q6OYtw',
  'Spectrum 2 Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHoVu6D7PaA0JaDACjKUwOom47VrTSzrw0Vx4W_Sydz9JC7FZgckCZYjRPlK7EcPuDAQzw',
  'Spectrum Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frHQV7qCra_JscqPGCzLCl78ktuAxHSzmzUh_sjvWzdqoI33CaQF2DscjR_lK7EeF3oM7TA',
  'Winter Offensive Weapon Case': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bj35VTqVBP4io_frGxZvqX4avxuIabDXDPJxb534uQ-TH-3wk8isGqByIuoIHKRbQRyXpJ2W6dU5a9fuS_R',
  'X-Ray P250 Package': 'i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJKz2lu_XsnXwtmkJjSU91dh8bjs-Fj-fg2jy8auqXMJuvf3afJsdfXFC2GTxLcm6bQ9S3q2zE1y4zzSyYmrJSrGPwQkDowwG7DTNlIwTA'
};

/* 圖片網址。查無這個品項就回 null——呼叫端自己決定要不要留空位。
   ⚠️ `size` 是**要跟 CDN 要的像素**，不是顯示尺寸。要 2 倍是給高解析度螢幕用的，
      呼叫端請走 caseIconHtml()，不要自己記得乘 2。 */
function caseIconUrl(name, size) {
  var key = String(name == null ? '' : name);
  /* ⚠️ 一定要 hasOwnProperty，不能直接 CASE_ICONS[key]：
     'constructor' / 'toString' 這種名字會從原型鏈拿到函式，然後被接進網址
     （實際長出 .../function Object() { [native code] }/64fx64f）。
     箱子不會叫這些名字，但這一頁的 name 是**從網址參數來的**。 */
  if (!Object.prototype.hasOwnProperty.call(CASE_ICONS, key)) return null;
  var hash = CASE_ICONS[key];
  if (!hash) return null;
  var px = Math.round(Number(size));
  if (!(px > 0)) px = 64;
  return CASE_ICON_BASE + hash + '/' + px + 'fx' + px + 'f';
}

/* 可以直接塞進樣板字串的 <img>。查無品項回傳空字串（那一列就只有文字，不破版）。
   px 是**顯示尺寸**；跟 CDN 要 2 倍。
   ⚠️ onerror 是把圖藏起來（visibility），不是移除——移除會讓那一列的寬度突然變窄。 */
function caseIconHtml(name, px, extraClass) {
  var show = Math.round(Number(px));
  if (!(show > 0)) show = 32;
  var url = caseIconUrl(name, show * 2);
  if (!url) return '';
  return '<img class="case-icon' + (extraClass ? ' ' + extraClass : '') + '"'
       + ' src="' + tradeEscape(url) + '"'
       + ' width="' + show + '" height="' + show + '"'
       + ' alt="" aria-hidden="true" loading="lazy" decoding="async"'
       + ' referrerpolicy="no-referrer"'
       + ' onerror="this.style.visibility=\'hidden\'">';
}

/* 依 <body data-page="xxx"> 自動載入 nav / footer，各頁不用再自己呼叫。
   （仍然可以手動呼叫 loadNav()，重複呼叫只會多一次 fetch，不會出錯。） */
document.addEventListener('DOMContentLoaded', function () {
  var page = document.body.getAttribute('data-page');
  if (page) { loadNav(page); loadFooter(); }
});
