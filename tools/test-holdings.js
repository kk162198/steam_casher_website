/* site.js 第⑨/⑪節的實測。不是正式測試套件，是「改完跑一次確認沒白改」用的。
   node tools/test-holdings.js —— 全綠才 commit（零相依，不需要 npm install）。 */
const fs = require('fs');
const vm = require('vm');

const store = {};
const ctx = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  // site.js 在載入時會跑一次 renderTimestamps / 綁 DOMContentLoaded，
  // 這裡只是餵它足夠的假 DOM 讓檔案跑得完，不測畫面。
  document: { addEventListener() {}, querySelectorAll: () => [], body: { getAttribute: () => null } },
  setInterval() {}, setTimeout() {},
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../assets/site.js', 'utf8'), ctx);

let fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log('✗ ' + label + '\n   got  ' + g + '\n   want ' + w); fail++; }
  else console.log('✓ ' + label);
}

const COMBO = JSON.stringify({
  savedAt: '2026-08-01T00:00:00.000Z',
  items: [
    { name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 },
    { name: 'Clutch Case',   qty: 5,  unitCostTwd: 40, defIndex: 4002 },
  ],
});

function reset(checked) {
  Object.keys(store).forEach(k => delete store[k]);
  store['sah-combo-v1'] = COMBO;
  if (checked !== undefined) store['sah-checklist-checked-v1'] = JSON.stringify(checked);
}

/* ── 1. v1 純名稱陣列 ────────────────────────────────────── */
reset(['Kilowatt Case']);
let h = ctx.readHoldings().items;
eq('v1 陣列 → 一列', h.length, 1);
eq('v1 數量退回計畫值', h[0].qty, 20);
eq('v1 數量標為估計', h[0].qtyIsEstimate, true);
eq('v1 時間標為估計', h[0].boughtAtIsEstimate, true);
eq('v1 沒有實付', h[0].paidTwd, null);
eq('v1 key = 品項名', h[0].key, 'Kilowatt Case');

/* ── 2. v2 name → ISO ───────────────────────────────────── */
reset({ 'Kilowatt Case': '2026-08-15T02:00:00.000Z' });
h = ctx.readHoldings().items;
eq('v2 保留購買時間', h[0].boughtAt, '2026-08-15T02:00:00.000Z');
eq('v2 時間不是估計', h[0].boughtAtIsEstimate, false);
eq('v2 數量仍是估計', h[0].qtyIsEstimate, true);

/* ── 3. v3 單批，部分成交 ───────────────────────────────── */
reset({
  'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: true },
});
h = ctx.readHoldings().items;
eq('v3 用實際買到數，不是計畫數', h[0].qty, 13);
eq('v3 計畫數仍讀得到', h[0].plannedQty, 20);
eq('v3 數量不是估計', h[0].qtyIsEstimate, false);
eq('v3 實付總額', h[0].paidTwd, 280);
eq('v3 closed', h[0].closed, true);

/* ── 4. v3 分批：一批一列，各自的冷卻期起點 ─────────────── */
reset({
  'Kilowatt Case': {
    lots: [
      { at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 },
      { at: '2026-08-16T09:00:00.000Z', qty: 7,  paidTwd: 160 },
    ],
    closed: false,
  },
});
h = ctx.readHoldings().items;
eq('分批 → 兩列', h.length, 2);
eq('第一批數量', h[0].qty, 13);
eq('第二批數量', h[1].qty, 7);
eq('兩批時間不同', h[0].boughtAt !== h[1].boughtAt, true);
eq('兩批 key 不撞', h[0].key !== h[1].key, true);
eq('合計買到', ctx.lotsTotalQty(ctx.readCheckedMap()['Kilowatt Case']), 20);
eq('合計實付', ctx.lotsTotalPaid(ctx.readCheckedMap()['Kilowatt Case']), 440);

/* ── 5. 沒填的一律當「不知道」，不要當 0 ────────────────── */
reset({
  'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: null }], closed: false },
});
eq('有一批沒填金額 → 合計是 null 不是 13', ctx.lotsTotalPaid(ctx.readCheckedMap()['Kilowatt Case']), null);
reset({ 'Kilowatt Case': { lots: [{ at: null, qty: 0, paidTwd: 0 }], closed: false } });
eq('qty 0 視為沒填（0 個不算買到）', ctx.readHoldings().items[0].qtyIsEstimate, true);
eq('paidTwd 0 是有效值（免費拿到也算填了）', ctx.readHoldings().items[0].paidTwd, 0);

/* ── 6. 壞資料不能讓頁面掛掉 ────────────────────────────── */
Object.keys(store).forEach(k => delete store[k]);
store['sah-combo-v1'] = COMBO;
store['sah-checklist-checked-v1'] = '{ 這不是 JSON';
eq('壞掉的 JSON → 空 map', ctx.readCheckedMap(), {});
eq('壞掉的 JSON → 沒有持有', ctx.readHoldings().items.length, 0);
reset({ 'Kilowatt Case': { lots: [{ qty: 13 }, { qty: null }], closed: false } });
eq('多批中沒數量的那批被丟掉', ctx.readHoldings().items.length, 1);

/* ── 7. 網址參數往返 ────────────────────────────────────── */
reset({
  'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false },
  'Clutch Case':   { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: null, paidTwd: null }], closed: false },
});
h = ctx.readHoldings().items;
const param = ctx.holdingsToParam(h);
const back = ctx.paramToHoldings(param, '2026-08-15T02:00:00.000Z');
eq('往返後列數相同', back.length, h.length);
eq('往返後數量', back.map(i => i.qty), [13, 5]);
eq('往返後實付', back.map(i => i.paidTwd), [280, null]);
eq('往返後保住「數量是估計」的標記', back.map(i => i.qtyIsEstimate), [false, true]);
eq('往返後 defIndex', back.map(i => i.defIndex), ['4001', '4002']);
eq('品項名有 : 或 , 也不會拆錯', ctx.paramToHoldings(
  ctx.holdingsToParam([{ name: 'A:B,C', qty: 2, unitCostTwd: 1, defIndex: null, paidTwd: 9, qtyIsEstimate: false, boughtAtIsEstimate: false }]),
  null)[0].name, 'A:B,C');

/* 舊網址（四段，沒有實付與旗標）仍要讀得回來 */
const old = ctx.paramToHoldings('Kilowatt%20Case:20:21:4001', '2026-08-15T02:00:00.000Z');
eq('舊四段網址 → 數量', old[0].qty, 20);
eq('舊四段網址 → 實付為 null', old[0].paidTwd, null);
eq('舊四段網址 → 不謊稱數量是實填的', old[0].qtyIsEstimate, false);

/* 同名兩批進同一個網址時 key 不能撞 */
const dup = ctx.paramToHoldings('A:3:10:::,A:4:10:::', null);
eq('同名兩批 key 不撞', dup[0].key !== dup[1].key, true);

/* ── 7b. 追蹤網址：整份清單搬到另一台裝置 ─────────────────
   跟行事曆提醒不同，追蹤網址是**整份**一起搬，所以計畫數量與各批
   自己的時間都要帶得過去，不然「還差幾個」與冷卻期會在新裝置上算錯。 */
reset({
  'Kilowatt Case': {
    lots: [
      { at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 },
      { at: '2026-08-17T09:30:00.000Z', qty: 4,  paidTwd: 95 },
    ],
    closed: true,
  },
  'Clutch Case': { lots: [{ at: '2026-08-16T00:00:00.000Z', qty: 5, paidTwd: 210 }], closed: false },
});
const src = ctx.readHoldings().items;
const url = ctx.holdingsTrackUrl(src, 'https://x.test/sell.html?old=1');
eq('追蹤網址指向乾淨的 base', url.indexOf('https://x.test/sell.html?items=') === 0, true);
eq('追蹤網址帶產生時間', /[?&]at=\d+/.test(url), true);

const moved = ctx.paramToHoldings(
  decodeURIComponent(url.match(/items=([^&]+)/)[1]), null);
eq('搬過去：批數', moved.length, 3);
eq('搬過去：各批數量', moved.map(i => i.qty), [13, 4, 5]);
eq('搬過去：計畫數量沒有被實際數量取代', moved.map(i => i.plannedQty), [20, 20, 5]);
eq('搬過去：closed 旗標', moved.map(i => i.closed), [true, true, false]);
eq('搬過去：各批保有自己的時間（分批的冷卻期不同）',
  moved.slice(0, 2).map(i => i.boughtAt), ['2026-08-15T02:00:00.000Z', '2026-08-17T09:30:00.000Z']);
eq('搬過去：實付', moved.map(i => i.paidTwd), [280, 95, 210]);

/* 存進新裝置之後，readHoldings() 要讀出一模一樣的東西 */
Object.keys(store).forEach(k => delete store[k]);       // 模擬一台全新的裝置
eq('新裝置原本是空的', ctx.countStoredHoldings(), 0);
eq('存進去成功', ctx.saveHoldingsToDevice(moved), true);
const after = ctx.readHoldings().items;
eq('存完：批數一樣', after.length, 3);
eq('存完：數量一樣', after.map(i => i.qty), [13, 4, 5]);
eq('存完：計畫數量還在（品項層級，取最大值不是加總）',
  after.map(i => i.plannedQty), [20, 20, 5]);
eq('存完：實付一樣', after.map(i => i.paidTwd), [280, 95, 210]);
eq('存完：時間一樣', after.map(i => i.boughtAt),
  ['2026-08-15T02:00:00.000Z', '2026-08-17T09:30:00.000Z', '2026-08-16T00:00:00.000Z']);
eq('存完：closed 還在', ctx.readCheckedMap()['Kilowatt Case'].closed, true);
eq('存完：品項數', ctx.countStoredHoldings(), 2);

/* ⚠️ 估計值不可以在搬家過程中被洗成確定值 */
Object.keys(store).forEach(k => delete store[k]);
ctx.saveHoldingsToDevice(ctx.paramToHoldings(
  ctx.holdingsToParam([{
    name: 'A', qty: 7, plannedQty: 7, unitCostTwd: 10, defIndex: null, paidTwd: null,
    qtyIsEstimate: true, boughtAtIsEstimate: true, boughtAt: '2026-08-15T02:00:00.000Z', closed: false,
  }]), null));
eq('搬家不會把「沒填數量」洗成確定值', ctx.readCheckedMap()['A'].lots[0].qty, null);
eq('搬家後仍標為估計', ctx.readHoldings().items[0].qtyIsEstimate, true);

/* 沒東西可存時不要寫出一個空的 combo 蓋掉現有資料 */
reset({ 'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } });
eq('空清單不寫入', ctx.saveHoldingsToDevice([]), false);
eq('空清單不會蓋掉原本的紀錄', ctx.countStoredHoldings(), 1);

/* ── 7c. 試算頁那張表的整批同步 ────────────────────────────
   ⚠️ 試算頁看不到買到數量與實付金額，但那些資料就在同一個 key 裡。
      在試算頁勾／取消別的品項，不可以把已經填好的那幾筆洗掉。 */
reset({
  'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: true },
});
ctx.syncCheckedNames(['Kilowatt Case', 'Clutch Case']);   // 在試算頁多勾一個
let m = ctx.readCheckedMap();
eq('同步後：既有的買到數量沒被洗掉', m['Kilowatt Case'].lots[0].qty, 13);
eq('同步後：既有的實付沒被洗掉', m['Kilowatt Case'].lots[0].paidTwd, 280);
eq('同步後：既有的購買時間沒被重設', m['Kilowatt Case'].lots[0].at, '2026-08-15T02:00:00.000Z');
eq('同步後：既有的 closed 沒被洗掉', m['Kilowatt Case'].closed, true);
eq('同步後：新勾的建了一筆空的', m['Clutch Case'].lots[0].qty, null);
eq('同步後：新勾的有記時間', typeof m['Clutch Case'].lots[0].at, 'string');
eq('同步後：新勾的不是裸 ISO 字串（不要留混格式）', Array.isArray(m['Clutch Case'].lots), true);
ctx.syncCheckedNames(['Kilowatt Case']);                  // 取消勾 Clutch
m = ctx.readCheckedMap();
eq('取消勾選 → 那筆消失', m['Clutch Case'], undefined);
eq('取消勾選 → 別人的資料還在', m['Kilowatt Case'].lots[0].paidTwd, 280);

/* ── 7d. 交易連結：哪一頁出哪幾顆 ──────────────────────────
   ⚠️ 這不是版面精簡。在試算頁擺 Steam 按鈕、在賣出頁擺 CSFloat 按鈕，
      等於在使用者正要動手的那一刻遞給他一個會做錯事的出口。 */
const both = ctx.tradeLinksHtml(4001, 'Kilowatt Case');
eq('預設兩顆都出（比較型頁面）', /CSFloat 買/.test(both) && /Steam 賣/.test(both), true);
const buyOnly = ctx.tradeLinksHtml(4001, 'Kilowatt Case', 'buy');
eq('buy：有 CSFloat', /CSFloat 買/.test(buyOnly), true);
eq('buy：沒有 Steam', /Steam 賣/.test(buyOnly), false);
const sellOnly = ctx.tradeLinksHtml(4001, 'Kilowatt Case', 'sell');
eq('sell：有 Steam', /Steam 賣/.test(sellOnly), true);
eq('sell：沒有 CSFloat', /CSFloat 買/.test(sellOnly), false);
eq('sell：不需要 defIndex 也出得來', /Steam 賣/.test(ctx.tradeLinksHtml(null, 'Kilowatt Case', 'sell')), true);
eq('buy：沒有 defIndex 就出停用狀態，不亂猜網址',
  /trade-off/.test(ctx.tradeLinksHtml(null, 'Kilowatt Case', 'buy')), true);
eq('外部連結一律 noopener noreferrer',
  (both.match(/rel="noopener noreferrer"/g) || []).length, 2);
eq('品項名裡的引號不會撐破 HTML',
  ctx.tradeLinksHtml(1, 'A" onerror="x', 'sell').indexOf('onerror="x"') < 0, true);

/* ── 8. 毛額 → 淨額：必須與後端 calc_steam_income 逐分對齊 ──
   右邊的期望值是直接跑 update_derived_fields.py 的 calc_steam_income
   取得的，不是手算的。改動任一邊時這幾條會先紅。 */
[[1.52, 1.33], [0.03, 0.01], [0.50, 0.44], [3.87, 3.38], [100, 86.97], [0, 0]]
  .forEach(([gross, net]) => eq('毛額 ' + gross + ' → 淨額 ' + net, ctx.steamNetUsd(gross), net));
eq('不是 ×0.85（那會低估約 2.3%）', ctx.steamNetUsd(100) !== 85, true);

/* ── 9. 台幣格式：兩位小數（2026-08-24 新增）──────────────
   ⚠️ 這一組存在的理由是「單價 × 數量 ≠ 小計」：US$0.5 換算約 NT$16.25，
      顯示成 16 的時候買 20 件會跟小計差 5 元，而小計是用未取整的值算的。
      想自己驗算的使用者會直接卡住。 */
eq('整數也補兩位', ctx.fmtTwd(280), '280.00');
eq('小數保留兩位', ctx.fmtTwd(16.25), '16.25');
eq('第三位四捨五入', ctx.fmtTwd(16.255), '16.26');
eq('四位數帶千分位', ctx.fmtTwd(12345.6), '12,345.60');
eq('0 是 0.00，不是空的', ctx.fmtTwd(0), '0.00');
eq('壞值當 0，不要吐 NaN 到畫面上', ctx.fmtTwd(undefined), '0.00');
eq('負數也照樣兩位（最差情況倒賠會用到）', ctx.fmtTwd(-58.5), '-58.50');

eq('寫入前收斂到兩位', ctx.roundTwd('279.499'), 279.5);
eq('字串進得來', ctx.roundTwd('280'), 280);
eq('空的當 0', ctx.roundTwd(''), 0);
eq('負的一律當 0（金額不會是負的）', ctx.roundTwd(-5), 0);
/* ⚠️ 浮點誤差要在寫進 localStorage 之前收掉，不然每次讀出來都帶著，
      而且會在「預期 vs 實際」那個減法裡被放大。 */
eq('浮點誤差收掉', ctx.roundTwd(0.1 + 0.2), 0.3);

/* 網址參數也要帶得動小數——刷卡帳單上的金額本來就有角有分 */
const decParam = ctx.holdingsToParam([{
  name: 'Kilowatt Case', qty: 13, unitCostTwd: 16.25, defIndex: 4001,
  paidTwd: 279.5, qtyIsEstimate: false, boughtAtIsEstimate: false,
  boughtAt: '2026-08-15T02:00:00.000Z'
}]);
const decBack = ctx.paramToHoldings(decParam, null)[0];
eq('往返後實付保住小數', decBack.paidTwd, 279.5);
eq('往返後單價保住小數', decBack.unitCostTwd, 16.25);
/* ⚠️ 舊網址是整數，一定要仍然讀得回來，不要在遷移時把人家的紀錄弄丟 */
eq('舊的整數網址照樣讀得回', ctx.paramToHoldings('A:2:21:4001:280::2:', null)[0].paidTwd, 280);

/* ── 10. 買進側匯率：中間價之外還要加國外交易費（2026-08-24 新增）──
   ⚠️ 這 1.5% 不在 CSFLOAT_BUYER_FEE_RATE 的 7.5% 裡面——那是美元內部的
      入金費，兩者相乘不是相加。加它是因為「預估要花的現金」是使用者拿去
      入金的依據，低估的後果是他入完金發現清單買不完。 */
eq('國外交易費率 1.5%', ctx.FX_CARD_FEE_RATE, 0.015);
eq('買進側 = 中間價 × 1.015', Math.round(ctx.buyRate(31.82) * 1e6) / 1e6, 32.29730);
eq('壞值不要吐 NaN 到金額上', ctx.buyRate(undefined), 0);
eq('0 或負的匯率一律回 0', ctx.buyRate(-1), 0);
/* ⚠️ 賣出側沒有對應函式，是刻意的：Steam 錢包餘額沒有經過刷卡。
      要是哪天有人補了一個 sellRate()，先回去看 site.js 第⑭節。 */
eq('沒有 sellRate()（賣出側不該有國外交易費）', typeof ctx.sellRate, 'undefined');

/* ── 11. 台幣市場手續費（2026-08-24 實測，DECISIONS 4.17）────────
   ⚠️ 下面四條**不是手算的**，是作者在 Steam 賣出畫面實填價位、
      抄回「您將收到」的數字。它們是這一節唯一的真值來源。
      改 steamFeeTwd／steamNetTwd 而這四條變紅 = 改錯了，不是測試過期。 */
[[3, 1], [12, 10], [20, 17], [30, 26]]
  .forEach(([gross, net]) => eq('實測 NT$' + gross + ' → 實拿 ' + net, ctx.steamNetTwd(gross), net));

/* ⚠️ NT$20 是專門為了分辨 floor 與 round 去取的：
      floor 會給 18、ceil 會給 16，只有 round 給 17。
      下面兩條把「換回 floor」這個很自然的手滑擋住。 */
eq('NT$20 不是 18（那是 floor）', ctx.steamNetTwd(20) !== 18, true);
eq('NT$30 不是 27（那是 floor）', ctx.steamNetTwd(30) !== 27, true);

eq('每個分量最低 NT$1', ctx.STEAM_TWD_MIN_FEE_COMPONENT, 1);
/* 低價區：兩個下限都咬著，手續費固定 NT$2 */
eq('NT$3 的手續費是 2（兩個下限）', ctx.steamFeeTwd(1), 2);
eq('實拿 10 時 5% 那項仍是下限', ctx.steamFeeTwd(10), 1 + 1);
/* 反解要自洽：實拿 + 手續費 一定 ≤ 賣價，而且再加 1 就會超過 */
[3, 12, 20, 30, 64, 159, 636, 2931, 5053].forEach(g => {
  const r = ctx.steamNetTwd(g);
  eq('NT$' + g + ' 反解自洽（' + r + ' + 費 ≤ ' + g + '）', r + ctx.steamFeeTwd(r) <= g, true);
  eq('NT$' + g + ' 是最大解（再多 1 就超過）', (r + 1) + ctx.steamFeeTwd(r + 1) > g, true);
});

/* ⚠️ 台幣的下限是 NT$1／分量，美元是 US$0.01／分量（約 NT$0.32）——**三倍以上**。
      這一條擋的是「把台幣毛額換成美元丟進 steamNetUsd() 再換回來」這個捷徑：
      低價品項會因此高估實拿，而高估實拿 = 高估倍率 = 演算法優先推薦它。 */
eq('低價品項：台幣模型比「換美元再算」少拿', ctx.steamNetTwd(12) < Math.round(ctx.steamNetUsd(12 / 31.8) * 31.8), true);

eq('0 元回 0', ctx.steamNetTwd(0), 0);
eq('負的回 0', ctx.steamNetTwd(-5), 0);
eq('壞值回 0，不要吐 NaN', ctx.steamNetTwd(undefined), 0);
/* 掛單價是整數元（priceoverview 的 TWD lowest_price 三次都是整數），
   帶小數進來一律無條件捨去——寧可少算實拿，不要多算。 */
eq('小數的毛額往下取整', ctx.steamNetTwd(30.9), ctx.steamNetTwd(30));

/* ── 12. twdView()：四頁共用的台幣換算（2026-08-24）─────────────
   ⚠️ 這個函式存在的理由就是「不要讓 marketlist / case / calculator / sell
      各算一次」。下面這幾條盯的是它的兩條路徑不要互相污染。 */
const RATE = 32.5;
const rowTwd = {
  csfloat_cost: 0.22, steam_price: 0.26, steam_income: 0.22,
  steam_price_twd: 8, steam_income_twd: 6
};
const vTwd = ctx.twdView(rowTwd, RATE);
eq('有台幣欄位就標成真台幣', vTwd.isTwd, true);
eq('掛牌價直接用台幣，不再乘匯率', vTwd.steamPriceTwd, 8);
eq('實拿直接用台幣', vTwd.steamIncomeTwd, 6);
eq('成本仍走美元 × 中間價', Math.round(vTwd.csfloatCostTwd * 1e6) / 1e6, 7.15);
eq('淨利是重算的，不是讀 diff', Math.round(vTwd.netProfitTwd * 1e6) / 1e6, -1.15);
eq('倍率是重算的台幣倍率', Math.round(vTwd.ratio * 1e4) / 1e4, Math.round((6 / 7.15) * 1e4) / 1e4);

/* ⚠️⚠️ 這一條是整組裡最重要的：它量的就是「不改會錯多少」。
      同一列走美元退回路徑，實拿會被高估到 7.15，倍率被高估到 1.0——
      也就是從「賣掉是虧的」翻成「打平」。而組合演算法永遠先挑倍率最高的。 */
const rowUsd = { csfloat_cost: 0.22, steam_price: 0.26, steam_income: 0.22 };
const vUsd = ctx.twdView(rowUsd, RATE);
eq('沒有台幣欄位就標成換算的', vUsd.isTwd, false);
eq('退回路徑真的會高估實拿', vUsd.steamIncomeTwd > vTwd.steamIncomeTwd, true);
eq('高估幅度 > 15%（不是四捨五入的零頭）',
  (vUsd.steamIncomeTwd / vTwd.steamIncomeTwd - 1) > 0.15, true);
/* ⚠️ 錯誤方向：退回路徑把「虧」講成「不虧」。這正是為什麼不能默默退回不講。 */
eq('台幣算出來是虧的', vTwd.ratio < 1, true);
eq('美元算出來卻不虧', vUsd.ratio >= 1, true);

/* 高價品項兩條路徑應該幾乎一樣——下限只咬低價的 */
const hi = ctx.twdView({ csfloat_cost: 90, steam_price: 100, steam_income: 87,
                         steam_price_twd: 3250, steam_income_twd: 2827 }, RATE);
const hiUsd = ctx.twdView({ csfloat_cost: 90, steam_price: 100, steam_income: 87 }, RATE);
eq('高價品項兩條路徑差 < 1%',
  Math.abs(hi.steamIncomeTwd / hiUsd.steamIncomeTwd - 1) < 0.01, true);

eq('壞匯率不要吐 NaN 到畫面上', ctx.twdView(rowUsd, 0).steamIncomeTwd, 0);
eq('沒有成本時倍率回 0，不是 Infinity', ctx.twdView({ steam_income_twd: 6 }, RATE).ratio, 0);
/* ⚠️ steam_income_twd 可以合法等於 0（NT$2 全被兩個 NT$1 下限吃掉）。
      用真假值判斷會把它誤當成「沒資料」而退回美元，於是顯示成正的。 */
const zero = ctx.twdView({ csfloat_cost: 0.05, steam_income: 0.04, steam_income_twd: 0 }, RATE);
eq('實拿 0 是有效值，不是沒資料', zero.isTwd, true);
eq('實拿 0 就顯示 0', zero.steamIncomeTwd, 0);

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
