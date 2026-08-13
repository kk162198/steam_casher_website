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

/* 依 <body data-page="xxx"> 自動載入 nav / footer，各頁不用再自己呼叫。
   （仍然可以手動呼叫 loadNav()，重複呼叫只會多一次 fetch，不會出錯。） */
document.addEventListener('DOMContentLoaded', function () {
  var page = document.body.getAttribute('data-page');
  if (page) { loadNav(page); loadFooter(); }
});
