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

async function boot(sold) {
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
    url: 'https://example.test/sell.html',
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ rates: { TWD: RATE } }) });
      w.localStorage.setItem('sah-combo-v1', JSON.stringify(COMBO));
      w.localStorage.setItem('sah-checklist-checked-v1', JSON.stringify(CHECKED));
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
  const wantTotal = (0.52 * RATE * 13).toFixed(0);
  eq('總實拿用 13 件計算', doc.getElementById('sl-total').textContent, 'NT$ ' + wantTotal);
  eq('註腳講出成本', doc.querySelector('#sl-total').nextElementSibling.textContent.includes('成本 NT$ 280'), true);
  eq('數量與成本都是實填的 → 不標「估」',
    doc.querySelector('#sl-total').nextElementSibling.textContent.includes('（估）'), false);

  // 回填成交價：填 Steam 標價（毛額），本站扣手續費
  const input = row.querySelector('[data-sold-for]');
  eq('回填欄的 key 用 holding key（單批時＝品項名）', input.dataset.soldFor, 'Kilowatt Case');
  eq('回填欄講明填的是毛額', row.textContent.includes('買家付的'), true);
  input.value = '25';
  input.dispatchEvent(new dom.window.Event('change'));

  row = doc.querySelector('#sl-body tr');
  // 25 TWD 毛額 → USD 0.7692 → 淨額 US$0.66 → ×32.5 ×13 件
  const netUsd = dom.window.steamNetUsd(25 / RATE);
  const wantNet = (netUsd * RATE * 13).toFixed(0);
  const wantGap = (netUsd * RATE * 13 - 280).toFixed(0);
  eq('賺賠用淨額算，不是拿毛額直接減', row.textContent.includes('實拿 NT$ ' + wantNet), true);
  eq('賺賠金額', row.textContent.includes('NT$ ' + Math.abs(wantGap)), true);
  eq('毛額直接減會多算，這裡不該出現那個數字',
    row.textContent.includes('NT$ ' + (25 * 13 - 280).toFixed(0)), false);

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

  console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
