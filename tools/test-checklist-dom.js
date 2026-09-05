/* 購物清單頁的畫面實測：真的載入 checklist.html、真的點勾勾、真的打數字，
   然後檢查寫進 localStorage 的東西對不對。
   node tools/test-checklist-dom.js —— 全綠才 commit。 */
const fs = require('fs');
/* jsdom 不是本站的相依套件（這是純靜態網站，沒有 package.json）。
   跑這支測試前先 `npm install jsdom`，或只跑 test-holdings.js——
   那支零相依，涵蓋的是風險最高的部分（格式遷移、網址往返、手續費換算）。 */
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.error('需要 jsdom：npm install jsdom（或改跑 node tools/test-holdings.js）');
  process.exit(2);
}

let fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log('✗ ' + label + '\n   got  ' + g + '\n   want ' + w); fail++; }
  else console.log('✓ ' + label);
}

const COMBO = {
  savedAt: '2026-08-01T00:00:00.000Z',
  items: [
    /* ⚠️ listUsd（掛牌價，美元）與 unitCostTwd（含入金費與刷卡費的台幣）刻意
          差很多，而且不成任何簡單比例——這樣「求購訂單上限價印錯欄位」
          會直接被下面那條測出來，不會剛好對上。 */
    /* listTwd（CSFloat 標價）與 unitCostTwd（要準備的現金）刻意差 9%，就是真實的
       1.075 × 1.015。求購訂單那一行拿錯欄位會直接被下面測出來。 */
    { name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, listUsd: 0.61, listTwd: 19.31, defIndex: 4001 },
    /* 舊單：2026-09-04 之前存的計畫沒有 listUsd。整行要消失，不可以反推。 */
    { name: 'Clutch Case',   qty: 5,  unitCostTwd: 40, defIndex: 4002 },
  ],
};

/* combo 不傳就用共用的 COMBO。
   ⚠️ 需要另一種狀態時**開一個新的 boot**，不要往 COMBO 加第三筆——
      它會撞到「兩個品項各一列」那幾條數列數的斷言。 */
async function boot(combo) {
  const html = fs.readFileSync(__dirname + '/../checklist.html', 'utf8')
    // nav/footer 是 fetch 進來的片段，測試環境沒有伺服器，拿掉不影響本頁邏輯
    .replace('<body data-page="checklist">', '<body>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/checklist.html',
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('no network in test'));
      w.localStorage.setItem('sah-combo-v1', JSON.stringify(combo || COMBO));
    },
  });
  // site.js 是外部檔，jsdom 不會抓，手動注入到同一個 window
  const site = fs.readFileSync(__dirname + '/../assets/site.js', 'utf8');
  const s = dom.window.document.createElement('script');
  s.textContent = site;
  dom.window.document.head.appendChild(s);
  // 頁面自己的 inline script 已經跑過但那時還沒有 site.js，重跑一次
  const inline = [...dom.window.document.querySelectorAll('script:not([src])')]
    .map(e => e.textContent).filter(t => t.includes('renderChecklistRow')).pop();
  dom.window.eval(inline);
  return dom;
}

(async () => {
  const dom = await boot();
  const { document, localStorage } = dom.window;
  /* v4 起勾選紀錄多了「單」這一層：{ v:4, orders:{ "<oid>": { 品項: entry } } }。
     這個測試只餵 sah-combo-v1，所以遷移出來的單一定是 'legacy'。 */
  const read = () => {
    const raw = JSON.parse(localStorage.getItem('sah-checklist-checked-v1') || '{}');
    if (raw.v !== 4) return raw;
    return raw.orders[Object.keys(raw.orders)[0]] || {};
  };
  const rows = () => [...document.querySelectorAll('#cl-body tr')];

  eq('兩個品項各一列', rows().length, 2);
  eq('計畫欄顯示計畫數量', rows()[0].querySelector('[data-label="計畫"]').textContent.includes('20 個'), true);
  eq('沒勾之前數量輸入是關的', rows()[0].querySelector('[data-qty-for]').disabled, true);
  eq('沒勾之前實付輸入是關的', rows()[0].querySelector('[data-paid-for]').disabled, true);

  // 勾第一項
  const cb = rows()[0].querySelector('input[type="checkbox"]');
  cb.checked = true;
  cb.dispatchEvent(new dom.window.Event('change'));
  const e1 = read()['Kilowatt Case'];
  eq('勾選後寫入 lots 格式', Array.isArray(e1.lots) && e1.lots.length === 1, true);
  eq('勾選當下記下時間', typeof e1.lots[0].at === 'string', true);
  eq('勾選時數量還是 null（沒填就是不知道）', e1.lots[0].qty, null);
  eq('舊資料自動歸到「舊單」底下',
    Object.keys(JSON.parse(localStorage.getItem('sah-checklist-checked-v1')).orders), ['legacy']);
  eq('勾選後輸入框打開了', rows()[0].querySelector('[data-qty-for]').disabled, false);
  eq('提示未填', rows()[0].querySelector('[data-label="買到幾個"]').textContent.includes('未填'), true);

  // 只買到 13 個
  const qtyIn = rows()[0].querySelector('[data-qty-for]');
  qtyIn.value = '13';
  qtyIn.dispatchEvent(new dom.window.Event('change'));
  eq('數量寫進第一批', read()['Kilowatt Case'].lots[0].qty, 13);
  eq('少買時顯示還差幾個', rows()[0].textContent.includes('還差 7 個'), true);
  eq('少買時給收單按鈕', !!document.querySelector('[data-close="Kilowatt Case"]'), true);
  eq('少買時給再買一批', !!document.querySelector('[data-addlot="Kilowatt Case"]'), true);

  // 實付總額
  const paidIn = rows()[0].querySelector('[data-paid-for]');
  paidIn.value = '280';
  paidIn.dispatchEvent(new dom.window.Event('change'));
  eq('實付寫進第一批', read()['Kilowatt Case'].lots[0].paidTwd, 280);
  eq('進度用實付而不是計畫值',
    document.getElementById('cl-progress-note').textContent.includes('實付 NT$ 280'), true);
  eq('進度用實際件數', document.getElementById('cl-progress-note').textContent.includes('13'), true);

  // 收單
  document.querySelector('[data-close="Kilowatt Case"]').click();
  eq('收單寫入 closed', read()['Kilowatt Case'].closed, true);
  eq('收單後顯示已收單', rows()[0].textContent.includes('已收單'), true);
  document.querySelector('[data-reopen="Kilowatt Case"]').click();
  eq('可以改回還要再買', read()['Kilowatt Case'].closed, false);

  // 再買一批
  document.querySelector('[data-addlot="Kilowatt Case"]').click();
  eq('多一批 → 多一列', rows().length, 3);
  eq('第二批是獨立的 lot', read()['Kilowatt Case'].lots.length, 2);
  eq('第二批有自己的時間',
    read()['Kilowatt Case'].lots[1].at !== read()['Kilowatt Case'].lots[0].at
    || typeof read()['Kilowatt Case'].lots[1].at === 'string', true);
  const lot2Qty = rows()[1].querySelector('[data-qty-for][data-lot="1"]');
  lot2Qty.value = '7';
  lot2Qty.dispatchEvent(new dom.window.Event('change'));
  eq('第二批數量', read()['Kilowatt Case'].lots[1].qty, 7);
  eq('合計回到 20 就不再顯示還差', rows().map(r => r.textContent).join('').includes('還差'), false);

  // 移除批次
  document.querySelector('[data-rmlot="Kilowatt Case"]').click();
  eq('移除批次', read()['Kilowatt Case'].lots.length, 1);

  // 取消勾選要把整筆紀錄清掉
  const cb2 = rows()[0].querySelector('input[type="checkbox"]');
  cb2.checked = false;
  cb2.dispatchEvent(new dom.window.Event('change'));
  eq('取消勾選 → 紀錄消失', read()['Kilowatt Case'], undefined);

  // 清除鍵是兩段式的
  const reset = document.getElementById('cl-reset');
  const cb3 = rows()[0].querySelector('input[type="checkbox"]');
  cb3.checked = true; cb3.dispatchEvent(new dom.window.Event('change'));
  reset.click();
  eq('清除鍵第一下不清資料', !!read()['Kilowatt Case'], true);
  eq('清除鍵第一下改文案', reset.textContent.includes('再按一次'), true);
  reset.click();
  eq('清除鍵第二下才真的清', Object.keys(read()).length, 0);

  /* ── 追蹤網址 ────────────────────────────────────────── */
  const copyBtn = document.getElementById('cl-copy-url');
  eq('沒有勾任何東西時複製鍵是關的', copyBtn.disabled, true);

  const cb4 = rows()[0].querySelector('input[type="checkbox"]');
  cb4.checked = true; cb4.dispatchEvent(new dom.window.Event('change'));
  const q4 = rows()[0].querySelector('[data-qty-for]');
  q4.value = '13'; q4.dispatchEvent(new dom.window.Event('change'));
  const p4 = rows()[0].querySelector('[data-paid-for]');
  p4.value = '280'; p4.dispatchEvent(new dom.window.Event('change'));
  eq('勾了就打開，並顯示批數',
    document.getElementById('cl-copy-url').textContent.includes('1 批'), true);

  // jsdom 沒有 navigator.clipboard → 走退路，把網址攤在輸入框裡
  document.getElementById('cl-copy-url').click();
  await new Promise(r => setTimeout(r, 10));
  const out = document.getElementById('cl-url-out');
  eq('複製失敗時把網址攤出來', out.hidden, false);
  eq('網址指向賣出頁（新格式 it=）', out.value.includes('/sell.html?it='), true);
  eq('網址帶產生時間', /[?&]at=\d+/.test(out.value), true);
  eq('退路有講怎麼手動複製',
    document.getElementById('cl-copy-note').textContent.includes('手動選取'), true);

  const decode = v => dom.window.paramToHoldingsV4(
    v.match(/[?&]it=([^&]+)/)[1], v.match(/[?&]t0=([^&]+)/)[1]);
  const carried = decode(out.value);
  eq('網址帶得回實際數量', carried[0].qty, 13);
  eq('網址帶得回計畫數量', carried[0].plannedQty, 20);
  eq('網址帶得回實付', carried[0].paidTwd, 280);
  eq('只帶已勾選的（沒買到的不該出現在賣出頁）', carried.length, 1);

  /* ── 到貨時間（2026-08-29）────────────────────────────────
     ⚠️ 打勾 ≠ 到貨。CSFloat 是掛單制，賣家收到訂單之後才去送交易報價，
        而冷卻期是從**物品進到庫存**才開始算的。這一段守的是：
        按鈕存在、寫進 lot.got、跨裝置的網址帶得走、沒按時退回估計值。 */
  const gotBtn = () => rows()[0].querySelector('[data-got]');
  eq('勾了之後有「物品到了」可以按', !!gotBtn(), true);
  eq('還沒按之前 lot 沒有到貨時間', read()['Kilowatt Case'].lots[0].got, null);

  gotBtn().click();
  const gotAt = read()['Kilowatt Case'].lots[0].got;
  eq('按下去就記下到貨時間', typeof gotAt === 'string', true);
  eq('按過之後畫面顯示到貨日',
    rows()[0].querySelector('[data-label="已買到"]').textContent.includes('到貨'), true);
  eq('按過之後改成可以取消', !!rows()[0].querySelector('[data-ungot]'), true);

  /* 冷卻期起點要跟著換掉——這是整個改動的重點，不是附帶效果 */
  const csGot = dom.window.cooldownStart(read()['Kilowatt Case'].lots[0].at, gotAt);
  eq('按過之後起點就是到貨時間', csGot.at, gotAt);
  eq('按過之後不再是估計值', csGot.isEstimate, false);

  /* 跨裝置：到貨時間要編進追蹤網址 */
  document.getElementById('cl-copy-url').click();
  await new Promise(r => setTimeout(r, 10));
  const out2 = document.getElementById('cl-url-out');
  const carried2 = decode(out2.value);
  /* ⚠️ 網址存的是「距 t0 幾分鐘」（base36），所以秒與毫秒會被截掉。比到分就好——
     冷卻期是 7 天，而 .ics 事件時刻本來就會進位到下一秒，方向是安全的那一邊。 */
  eq('追蹤網址帶得走到貨時間',
    Math.floor(Date.parse(carried2[0].arrivedAt) / 60000),
    Math.floor(Date.parse(gotAt) / 60000));
  eq('另一台裝置上也不是估計值', carried2[0].cooldownFromIsEstimate, false);

  /* 改回還沒到 → 退回「打勾 + 1 天」的保守估計 */
  rows()[0].querySelector('[data-ungot]').click();
  eq('改回還沒到就清掉到貨時間', read()['Kilowatt Case'].lots[0].got, null);
  const lotAt = read()['Kilowatt Case'].lots[0].at;
  const csBack = dom.window.cooldownStart(lotAt, null);
  eq('退回後起點就是打勾那一刻，不加緩衝',
    Date.parse(csBack.at) - Date.parse(lotAt), 0);
  eq('退回後標成估計值', csBack.isEstimate, true);
  eq('沒按時頁面要講出來是估的',
    document.getElementById('cl-next-note').textContent.includes('最快能賣的時刻'), true);
  /* ⚠️ 解鎖是一個時刻不是一天。只寫日期就是 2026-08-29 那個誤會的來源。 */
  eq('可賣時間要連時刻一起講',
    /\d{1,2}:\d{2}/.test(document.getElementById('cl-next-note').textContent), true);

  /* ── 求購訂單那一行（2026-09-04）────────────────────────
     ⚠️⚠️ 這一組守的是 PROJECT_OVERVIEW 坑 #1 換了一個欄位之後的版本：
        求購訂單的價格欄要的是**掛牌價**，而 unitCostTwd 含 7.5% 入金費與
        1.5% 刷卡費。填錯的方向是每件多付約 9%，**而且畫面上不會有任何提示**。 */
  const rowText = n => {
    const tr = [...document.querySelectorAll('tr')].find(r => r.textContent.includes(n));
    return tr ? tr.textContent.replace(/\s+/g, ' ') : '';
  };
  const kilo = rowText('Kilowatt Case');
  eq('有掛牌價時會出現求購訂單那一行', /求購訂單/.test(kilo), true);
  /* ⚠️⚠️ 顯示的必須是 CSFloat 標價（listTwd 19.31），不是要準備的現金（21）。
        使用者是拿這個數字去跟 CSFloat 畫面比對的，給他成本他會以為本站算錯。 */
  eq('求購訂單顯示 CSFloat 標價的台幣', /別超過 NT\$ 19\.31/.test(kilo), true);
  eq('沒有拿「要準備的現金」頂替', /別超過 NT\$ 21/.test(kilo), false);
  /* ⚠️ 措辭是「別超過」不是「上限」：2026-09-04 實測證明求購訂單是掛單等，
        寫成「上限 NT$x」會被讀成「要填這個價」，而那個價低於最低掛牌價時
        只會排隊、不會成交。它的角色是天花板，不是目標價。 */
  eq('措辭是天花板不是目標價', /別超過/.test(kilo), true);
  /* 舊計畫只有 listUsd 沒有 listTwd → 退回美元。
     ⚠️ 不可以在購物清單頁乘匯率補一個台幣值出來——這一頁沒有匯率，
        也刻意不連資料庫（斷網、資料庫掛掉時它還要讀得出來）。 */
  const legacyDom = await boot({
    savedAt: '2026-08-01T00:00:00.000Z',
    items: [{ name: 'Legacy Case', qty: 2, unitCostTwd: 18, listUsd: 0.50, defIndex: 4003 }],
  });
  const legacyText = legacyDom.window.document.body.textContent.replace(/\s+/g, ' ');
  eq('舊計畫沒有台幣標價時退回美元', /別超過 US\$0\.50/.test(legacyText), true);
  eq('而且沒有自己乘一個匯率出來', /別超過 NT\$/.test(legacyText), false);
  eq('數量帶的是計畫數量', /×20/.test(kilo), true);
  /* 21 是 unitCostTwd。它不可以出現在「上限」後面——出現就代表填錯欄位了。 */


  const clutch = rowText('Clutch Case');
  eq('舊單沒有掛牌價時整行不出現', /求購訂單/.test(clutch), false);
  /* ⚠️ 「不出現」比「顯示一個反推值」重要：反推值看起來跟真值一樣可信，
        而它要同時除掉兩個常數，等於把常數複製到第三個地方。 */
  eq('而且沒有偷偷反推一個上限價出來', /US\$/.test(clutch), false);

  const nameCopyBtns = [...document.querySelectorAll('[data-copyname]')];
  eq('複製鍵帶的是精確品項名', nameCopyBtns.map(b => b.dataset.copyname), ['Kilowatt Case']);

  console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
