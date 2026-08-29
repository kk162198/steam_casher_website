/* 賣出頁的畫面實測。Supabase 與匯率都用固定假資料，因為要驗的是
   「數量與成本有沒有用對」，不是網路。
   node tools/test-sell-dom.js —— 全綠才 commit。 */
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

const RATE = 32.5;
const COMBO = {
  savedAt: '2026-08-01T00:00:00.000Z',
  items: [{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }],
};
// 20 天前買的 → 早就過了 7 天冷卻期，回填欄才會出現
const BOUGHT = new Date(Date.now() - 20 * 86400000).toISOString();

const CHECKED = {
  'Kilowatt Case': { lots: [{ at: BOUGHT, qty: 13, paidTwd: 280 }], closed: true },
};

const ROW = { name: 'Kilowatt Case', steam_price: 0.60, steam_income: 0.52, steam_volume: 90000, steam_updated_at: new Date().toISOString() };

/* opts.url    覆寫網址（測從追蹤網址進來的情況）
   opts.empty  把 localStorage 清空（模擬一台沒看過這個網站的手機） */
async function boot(sold, opts) {
  opts = opts || {};
  /* site.js 與 supabase 都是外部檔，jsdom 不抓。把 site.js 原地內嵌，
     讓載入順序跟瀏覽器上一模一樣（先 site.js 再頁面自己的 script）。 */
  const html = fs.readFileSync(__dirname + '/../sell.html', 'utf8')
    .replace('<body data-page="sell">', '<body>')
    .replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/, '')
    /* ⚠️ site.js 的註解裡有一個 </script> 字樣，直接內嵌會把 script 提早關掉，
       症狀是「site.js 的註解變成 HTML」。跳脫掉。replace 的第二個參數用
       函式，避免內容裡的 $ 被當成取代樣式。 */
    .replace('<script src="assets/site.js"></script>', () =>
      '<script>' + fs.readFileSync(__dirname + '/../assets/site.js', 'utf8')
        .replace(/<\/script/gi, '<\\/script') + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: opts.url || 'https://example.test/sell.html',
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ rates: { TWD: RATE } }) });
      if (!opts.empty) {
        w.localStorage.setItem('sah-combo-v1', JSON.stringify(COMBO));
        // opts.checked：覆寫勾選紀錄（測不同的冷卻期起點）
        w.localStorage.setItem('sah-checklist-checked-v1', JSON.stringify(opts.checked || CHECKED));
      }
      if (sold) w.localStorage.setItem('sah-sold-v1', JSON.stringify(sold));
      // Supabase client 的最小替身：只支援本頁用到的那條鏈
      w.supabase = {
        createClient: () => ({
          from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [ROW], error: null }) }) }),
        }),
      };
    },
  });
  await new Promise(r => setTimeout(r, 60));   // 等 main() 的 await
  return dom;
}

(async () => {
  let dom = await boot(null);
  let doc = dom.window.document;
  let row = doc.querySelector('#sl-body tr');

  eq('一批一列', doc.querySelectorAll('#sl-body tr').length, 1);
  eq('用實際買到的 13 個，不是計畫的 20', row.textContent.includes('13 個'), true);
  eq('不會出現計畫數量 20 個', row.textContent.includes('20 個'), false);
  eq('成本用實付總額', row.textContent.includes('實付 NT$ 280'), true);
  eq('沒填成交價時不顯示賺賠', row.textContent.includes('賺 NT$'), false);

  // 全部賣掉預計實拿 = 0.52 USD × 32.5 × 13 件
  // ⚠️ 2026-08-24 起台幣一律兩位小數（site.js 第⑬節 fmtTwd），期望值跟著改。
  const wantTotal = (0.52 * RATE * 13)
    .toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  eq('總實拿用 13 件計算', doc.getElementById('sl-total').textContent, 'NT$ ' + wantTotal);
  eq('註腳講出成本', doc.querySelector('#sl-total').nextElementSibling.textContent.includes('成本 NT$ 280'), true);
  eq('數量與成本都是實填的 → 不標「估」',
    doc.querySelector('#sl-total').nextElementSibling.textContent.includes('（估）'), false);

  // 回填成交價：填 Steam 標價（毛額），本站扣手續費
  const input = row.querySelector('[data-sold-for]');
  eq('回填欄的 key 用 holding key（單批時＝品項名）', input.dataset.soldFor, 'Kilowatt Case');
  /* ⚠️ 賣出頁只出 Steam。這裡的箱子已經在庫存裡，再去 CSFloat 買一次
     是完全不同的動作——那顆按鈕不該存在。 */
  eq('賣出頁有 Steam 連結', row.textContent.includes('Steam 賣'), true);
  eq('賣出頁沒有 CSFloat 連結', row.textContent.includes('CSFloat 買'), false);
  eq('回填欄講明填的是毛額', row.textContent.includes('買家付的'), true);
  input.value = '25';
  input.dispatchEvent(new dom.window.Event('change'));

  row = doc.querySelector('#sl-body tr');
  /* ⚠️ 2026-08-24：這一段本來是「NT$25 → 換成美元 → 用美元規則算實拿 → 換回台幣」。
     **那是錯的**（DECISIONS 4.17）。使用者填的是他在 **Steam 台幣市場**
     實際成交的台幣價——台幣進、台幣出，中間不該碰美元，也不該碰匯率。
     NT$25 毛額 → steamNetTwd → 實拿 NT$22／個 × 13 件。 */
  const netTwd = dom.window.steamNetTwd(25);
  eq('NT$25 的實拿是 22（台幣規則）', netTwd, 22);
  const f = n => n.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  eq('賺賠用淨額算，不是拿毛額直接減',
    row.textContent.includes('實拿 NT$ ' + f(netTwd * 13)), true);
  eq('賺賠金額', row.textContent.includes('NT$ ' + f(Math.abs(netTwd * 13 - 280))), true);
  eq('毛額直接減會多算，這裡不該出現那個數字',
    row.textContent.includes('NT$ ' + f(25 * 13 - 280)), false);
  /* ⚠️ 這一條擋的是「哪天有人把它改回繞道美元」。
     美元路徑會算出 22.10／個（高估），跟 22 差得夠多，一改回去就會紅。 */
  eq('沒有繞道美元（美元路徑會給不同的數字）',
    row.textContent.includes('實拿 NT$ ' + f(dom.window.steamNetUsd(25 / RATE) * RATE * 13)), false);

  /* 沒填實付總額時要老實說算不出來，不要拿試算頁的估計值頂上去
     假裝那是實際損益——那就是「拿估計比實際」。 */
  CHECKED['Kilowatt Case'].lots[0].paidTwd = null;
  const dom2 = await boot({ 'Kilowatt Case': 25 });
  const row2 = dom2.window.document.querySelector('#sl-body tr');
  eq('沒填實付 → 不給賺賠數字', row2.textContent.includes('賺 NT$') || row2.textContent.includes('賠 NT$'), false);
  eq('沒填實付 → 說要回去填', row2.textContent.includes('填實付總額'), true);
  eq('沒填實付 → 成本標「估」', row2.textContent.includes('估 NT$'), true);
  eq('沒填實付 → 總覽註腳也標「估」',
    dom2.window.document.querySelector('#sl-total').nextElementSibling.textContent.includes('（估）'), true);

  /* 沒填數量時，數量要標成「用計畫數量」，不要看起來像實際值 */
  CHECKED['Kilowatt Case'].lots[0].qty = null;
  const dom3 = await boot(null);
  const row3 = dom3.window.document.querySelector('#sl-body tr');
  eq('沒填數量 → 退回計畫的 20 個', row3.textContent.includes('20 個'), true);
  eq('沒填數量 → 標示未填', row3.textContent.includes('未填，用計畫數量'), true);
  eq('沒填數量 → 來源說明講出來',
    dom3.window.document.getElementById('sl-source').textContent.includes('沒填實際買到幾個'), true);

  /* 行事曆事件：件數要用實際買到的，連結參數要帶得回實付金額。
     ⚠️ 事件內文本身仍然不放任何市場價格——ics 下載後就固定了，
        七天後在通知列看到的預估售價一定是過期的。 */
  CHECKED['Kilowatt Case'].lots[0] = { at: BOUGHT, qty: 13, paidTwd: 280 };
  const dom4 = await boot(null);
  /* ⚠️ icsCalendar() 會依 RFC 5545 折行（超過 75 octet 就換行 + 一個空白），
     所以長連結在原始檔裡是斷開的。比對前要先反折，不然會誤判成「參數不見了」。 */
  const ics = dom4.window.buildCooldownIcs().replace(/\r\n[ \t]/g, '');
  eq('事件標題用實際件數', /可以賣了：13 個箱子解鎖/.test(ics), true);
  eq('事件內文帶品項與件數', ics.includes('Kilowatt Case ×13'), true);
  eq('連結帶得回實付總額', /items=[^\s]*280/.test(ics), true);
  eq('事件內文不放建議掛價', /建議掛價|實拿 NT/.test(ics), false);
  const carried = dom4.window.paramToHoldings(
    decodeURIComponent(ics.match(/items=([^&\s]+)/)[1]), BOUGHT);
  eq('從 ics 連結還原：數量', carried[0].qty, 13);
  eq('從 ics 連結還原：實付', carried[0].paidTwd, 280);

  /* ── 從追蹤網址進來：要不要存到這台裝置 ─────────────────
     用第一台裝置產生的網址，開在一台空的「手機」上。 */
  CHECKED['Kilowatt Case'].lots[0] = { at: BOUGHT, qty: 13, paidTwd: 280 };
  const src = await boot(null);
  const trackUrl = src.window.holdingsTrackUrl(
    src.window.readHoldings().items, 'https://example.test/sell.html');

  // 空手機
  const phone = await boot(null, { url: trackUrl, empty: true });
  const pdoc = phone.window.document;
  eq('空裝置：跳出「要不要存」', pdoc.getElementById('sl-adopt').hidden, false);
  eq('空裝置：不提取代警告', pdoc.getElementById('sl-adopt-note').textContent.includes('取代'), false);
  eq('空裝置：清單還是看得到', pdoc.querySelectorAll('#sl-body tr').length, 1);
  eq('空裝置：數量是實際的 13', pdoc.querySelector('#sl-body tr').textContent.includes('13 個'), true);
  eq('講出連結是什麼時候產生的',
    pdoc.getElementById('sl-source').textContent.includes('產生'), true);
  eq('講出連結是快照',
    pdoc.getElementById('sl-source').textContent.includes('不會反映'), true);

  /* 按「存起來」→ 真的寫進 localStorage。
     jsdom 會印一行 "Not implemented: navigation to another Document"，
     那是存完之後的 location.replace()（把網址參數拿掉）——瀏覽器上會重整，
     jsdom 不支援導航所以只是印一行，不影響已經寫進去的資料。 */
  eq('存之前是空的', phone.window.countStoredHoldings(), 0);
  pdoc.getElementById('sl-adopt-yes').click();
  eq('存之後讀得到', phone.window.countStoredHoldings(), 1);
  const saved = phone.window.readHoldings().items;
  eq('存進去的是實際數量', saved[0].qty, 13);
  eq('存進去的計畫數量還在', saved[0].plannedQty, 20);
  eq('存進去的實付還在', saved[0].paidTwd, 280);
  eq('存進去的 closed 還在', saved[0].closed, true);

  // 手機上已經有另一份紀錄 → 一定要先警告會被取代
  const phone2 = await boot(null, { url: trackUrl });
  eq('已有紀錄：警告會被整份取代',
    phone2.window.document.getElementById('sl-adopt-note').textContent.includes('整份取代'), true);
  eq('已有紀錄：講出原本有幾筆',
    /已經有 <strong>1 個品項<\/strong>/.test(
      phone2.window.document.getElementById('sl-adopt-note').innerHTML), true);

  // 「這次先不要」只關掉提示，不寫任何東西
  const phone3 = await boot(null, { url: trackUrl, empty: true });
  phone3.window.document.getElementById('sl-adopt-no').click();
  eq('先不要：提示關掉', phone3.window.document.getElementById('sl-adopt').hidden, true);
  eq('先不要：什麼都沒寫進去', phone3.window.countStoredHoldings(), 0);

  // 正常（非連結）進來時不該跳這個提示
  const normal = await boot(null);
  eq('不是從連結進來就不跳提示',
    normal.window.document.getElementById('sl-adopt').hidden, true);

  /* ── 冷卻期起點（2026-08-29）─────────────────────────────
     ⚠️ 這一頁的倒數必須走 cooldownFrom，不是 boughtAt。
        boughtAt 是「你付錢那一刻」，冷卻期是從「物品進到庫存」才開始算的，
        而 CSFloat 的賣家不保證馬上轉移。用 boughtAt 會早一天說「可以賣了」，
        使用者回來卻上架不了——白跑一趟比晚一天知道更糟。 */
  const DAY = 86400000;

  /* 六天前下單、沒按過「物品到了」：起點是「下單 + 1 天」，所以還鎖著。
     ⚠️ 這一筆就是回歸點。改動之前它會被算成「6 天前買的、還差 1 天」，
        看起來很像；但真正咬人的是第 7 天——舊算法會說可以賣，實際不行。 */
  const sixDaysAgo = new Date(Date.now() - 6 * DAY).toISOString();
  const est = await boot(null, { checked: {
    'Kilowatt Case': { lots: [{ at: sixDaysAgo, qty: 13, paidTwd: 280 }], closed: true },
  } });
  const estText = est.window.document.getElementById('sl-body').textContent;
  eq('沒按到貨：還在冷卻', /解鎖/.test(estText), true);
  eq('沒按到貨：文案講「最快」', /最快/.test(estText), true);
  eq('沒按到貨：畫面標成估計值', /估計值/.test(estText), true);
  eq('沒按到貨：給得出校正的去處', /物品到了/.test(estText), true);

  /* 同一筆，但按過「物品到了」而且到貨就在下單當下：起點回到下單時間，
     不加緩衝——按過按鈕的人不該再被多罰一天。 */
  const exact = await boot(null, { checked: {
    'Kilowatt Case': { lots: [{ at: sixDaysAgo, got: sixDaysAgo, qty: 13, paidTwd: 280 }], closed: true },
  } });
  const exactText = exact.window.document.getElementById('sl-body').textContent;
  eq('按過到貨：不再說「最快」', /最快/.test(exactText), false);
  eq('按過到貨：不標估計值', /估計值/.test(exactText), false);

  /* 賣家拖三天的那種：起點跟著晚三天，不是「反正加一天」。
     ⚠️ 這條擋的是「乾脆把 COOLDOWN_DAYS 改成 8」那種修法——
        那會讓真的等了三天的人早三天回來，問題原封不動。 */
  const lateGot = new Date(Date.now() - 3 * DAY).toISOString();
  const late = await boot(null, { checked: {
    'Kilowatt Case': { lots: [{ at: sixDaysAgo, got: lateGot, qty: 13, paidTwd: 280 }], closed: true },
  } });
  eq('賣家拖三天：還鎖著，而且不是估計值',
    /解鎖/.test(late.window.document.getElementById('sl-body').textContent), true);
  eq('賣家拖三天：不標估計值',
    /估計值/.test(late.window.document.getElementById('sl-body').textContent), false);

  console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
