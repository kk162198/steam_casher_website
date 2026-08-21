/* ══════════════════════════════════════════════════════════════
   site.js — 全站共用的畫面層程式
   ──────────────────────────────────────────────────────────────
   改版前這些函式在 12 個頁面裡各複製一份，而且寫法還不統一
   （有的有 .catch，多數沒有），修一個 bug 要改 12 個檔案。

   內容：
     ① 資料時間戳章 renderTimestamps()
     ② 導覽列狀態點 setNavStatus()
     ③ nav / footer 片段載入 loadNav() / loadFooter()
     ④ 交易連結 csfloatBuyUrl() / steamMarketUrl() / tradeLinksHtml()
     ⑤ 流動性分級 liquidityTier() / liquidityChipHtml()
     ⑥ 冷卻期 COOLDOWN_DAYS / unlockAt() / cooldownText()
     ⑦ 特賣時程 STEAM_SALES / nextSale()
     ⑧ 行事曆 icsCalendar() / downloadIcs()
     ⑨ 持有清單 readHoldings() / holdingsToParam() / paramToHoldings()
     ⑩ 初始設定與時間成本 isSetupDone() / opMinutes() / worthVerdict()

   引用方式（放在 </body> 前，或用 defer）：
     <script defer src="assets/site.js"></script>
   各頁自己的 <script> 要在 site.js 之後執行才拿得到這些函式。
   ══════════════════════════════════════════════════════════════ */

/* ── ① 資料時間戳章 ─────────────────────────────────────────
   用法：<span class="ts-chip" data-source="steam" data-updated="ISO 字串"></span>
   三態門檻（分鐘）依資料來源的更新頻率設定。 */
var TS_RULES = {
  csfloat: { label: 'CSFloat', aging: 180, stale: 360 },
  steam:   { label: 'Steam',   aging: 360, stale: 720 },
  rate:    { label: '匯率',     aging: 720, stale: 1440 }
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

/* 表格用的「買 / 賣」雙連結。外部連結一律 rel="noopener noreferrer"，
   避免新分頁透過 window.opener 反向操作本站頁面。 */
function tradeLinksHtml(defIndex, name) {
  var buy = csfloatBuyUrl(defIndex);
  var sell = steamMarketUrl(name);
  var safeName = tradeEscape(name);
  var out = '<span class="trade-links">';
  out += buy
    ? '<a class="trade-link trade-buy" href="' + tradeEscape(buy) + '" target="_blank" rel="noopener noreferrer"'
      + ' aria-label="到 CSFloat 買 ' + safeName + '（另開分頁）">CSFloat 買</a>'
    : '<span class="trade-link trade-off" title="資料庫還沒有這個品項的 CSFloat ID">CSFloat 買</span>';
  out += sell
    ? '<a class="trade-link trade-sell" href="' + tradeEscape(sell) + '" target="_blank" rel="noopener noreferrer"'
      + ' aria-label="到 Steam 市場看 ' + safeName + '（另開分頁）">Steam 賣</a>'
    : '<span class="trade-link trade-off">Steam 賣</span>';
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

function unlockAt(boughtAt) {
  var t = boughtAt ? Date.parse(boughtAt) : NaN;
  return isNaN(t) ? null : new Date(t + COOLDOWN_MS);
}

/* 回傳 { state, days, text }。
   state：'locked'（還在冷卻）｜'ready'（可以賣了）｜'unknown'（沒有購買時間） */
function cooldownText(boughtAt, now) {
  var u = unlockAt(boughtAt);
  if (!u) return { state: 'unknown', days: null, text: '沒有記錄購買時間' };
  var ms = u.getTime() - (now || Date.now());
  if (ms <= 0) return { state: 'ready', days: 0, text: '可以賣了' };
  var days = Math.ceil(ms / 86400000);
  var hours = Math.ceil(ms / 3600000);
  return {
    state: 'locked',
    days: days,
    text: hours <= 24 ? ('約 ' + hours + ' 小時後解鎖') : ('還有 ' + days + ' 天解鎖')
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

/* 買進期限＝特賣開始前 7 天（冷卻期長度）。這是精確的時間點。 */
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
   而跑到前一天晚上。 */
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
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + icsEscape(e.summary),
        'TRIGGER:-P' + e.alarmDaysBefore + 'D', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function downloadIcs(text, filename) {
  var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  var a = document.createElement('a');
  var url = URL.createObjectURL(blob);
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* ── ⑨ 持有清單 ─────────────────────────────────────────────
   資料來源沿用購物清單那一套，不另起一份：
     sah-combo-v1                買了什麼（試算頁寫入）
     sah-checklist-checked-v1    哪些已經買到、以及**什麼時候**買到

   ⚠️ 舊版的 checked 是純名稱陣列 ["A","B"]，沒有時間。這裡升級成
      { "A": "ISO 時間" }，並保留舊格式的讀取相容——舊資料沒有時間，
      退回用 combo 的 savedAt 當近似值，並在畫面上標示那是估計的。
      **不要靜默假裝知道時間**，冷卻期算錯會讓人白等或提早去掛單。 */
var COMBO_STORAGE_KEY = 'sah-combo-v1';
var CHECK_STORAGE_KEY = 'sah-checklist-checked-v1';

function readCheckedMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(CHECK_STORAGE_KEY) || 'null');
    if (Array.isArray(raw)) {          // 舊格式：只有名稱，沒有時間
      var m = {};
      raw.forEach(function (n) { m[n] = null; });
      return m;
    }
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}
function writeCheckedMap(map) {
  try { localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(map)); } catch (e) { /* 無痕模式 */ }
}

/* 回傳已買到的品項 + 各自的購買時間。
   { items:[{name,qty,unitCostTwd,defIndex,boughtAt,boughtAtIsEstimate}], savedAt } */
function readHoldings() {
  var combo = null;
  try { combo = JSON.parse(localStorage.getItem(COMBO_STORAGE_KEY) || 'null'); } catch (e) { /* 忽略 */ }
  if (!combo || !Array.isArray(combo.items)) return { items: [], savedAt: null };
  var checked = readCheckedMap();
  var items = combo.items.filter(function (i) {
    return Object.prototype.hasOwnProperty.call(checked, i.name);
  }).map(function (i) {
    var at = checked[i.name];
    return {
      name: i.name, qty: i.qty, unitCostTwd: i.unitCostTwd, defIndex: i.defIndex == null ? null : i.defIndex,
      boughtAt: at || combo.savedAt || null,
      boughtAtIsEstimate: !at            // 舊資料沒有勾選時間，用試算時間近似
    };
  });
  return { items: items, savedAt: combo.savedAt || null };
}

/* 跨裝置：localStorage 不跨裝置，桌機買、手機收提醒是很常見的組合。
   解法是讓行事曆事件自己攜帶品項清單，點連結時由網址參數還原。
   格式沿用購物清單頁既有的 `名稱:數量:單價:defIndex`，多一個 bought 參數。

   ⚠️ 網址參數是使用者看得到也改得動的，所以它只攜帶「買了什麼」，
      **不攜帶任何價格計算結果**——賣價一律在頁面載入時重新查。 */
function holdingsToParam(items) {
  return items.map(function (i) {
    return [i.name, i.qty, Math.round(i.unitCostTwd || 0), i.defIndex == null ? '' : i.defIndex]
      .map(encodeURIComponent).join(':');
  }).join(',');
}
function paramToHoldings(raw, boughtAt) {
  if (!raw) return [];
  return raw.split(',').map(function (part) {
    var seg = part.split(':').map(decodeURIComponent);
    return {
      name: seg[0] || '未命名',
      qty: Number(seg[1]) || 0,
      unitCostTwd: Number(seg[2]) || 0,
      defIndex: (seg[3] !== undefined && seg[3] !== '') ? seg[3] : null,
      boughtAt: boughtAt || null,
      boughtAtIsEstimate: false
    };
  }).filter(function (i) { return i.qty > 0; });
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

   `setup.html` 的五個步驟全部勾完 → `doneAt` 有值 → 之後一律用回訪成本。

   ⚠️ 刻意**不用**到訪次數。來看五次但一次都沒買過的人，操作時間仍然是
      第一次的那個數字；到訪次數量的是「看過」不是「做過」。

   ⚠️ `localStorage` 不跨裝置：桌機設定完、手機打開會退回首訪。所以
      `setup.html` 一定要保留一個「我在別的裝置設定過了」的手動開關，
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
var OP_TIME = {
  setupMinutes:      45,  // 一次性：驗證器設定、確認資格、註冊 CSFloat、綁交易連結、首次入金
  roundFixedMinutes: 10,  // 每輪固定：查價、決定組合、登入、確認餘額
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

/* setup.html 的一次性步驟。id 同時是 localStorage 裡的 key，上線後不要改。
   fromElig：可以從資格快檢（sah-eligibility-v2）的哪一題自動帶入。 */
var SETUP_STEPS = [
  { id: 'authenticator', fromElig: { q: 'q2', pass: 'yes' } },
  { id: 'spend5',        fromElig: { q: 'q1', pass: 'yes' } },
  { id: 'notrestricted', fromElig: { q: 'q3', pass: 'no'  } },
  { id: 'csfloat',       fromElig: null },
  { id: 'funded',        fromElig: null }
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

/* 依 <body data-page="xxx"> 自動載入 nav / footer，各頁不用再自己呼叫。
   （仍然可以手動呼叫 loadNav()，重複呼叫只會多一次 fetch，不會出錯。） */
document.addEventListener('DOMContentLoaded', function () {
  var page = document.body.getAttribute('data-page');
  if (page) { loadNav(page); loadFooter(); }
});
