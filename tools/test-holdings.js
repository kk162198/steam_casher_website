/* site.js 第⑨/⑪節的實測。不是正式測試套件，是「改完跑一次確認沒白改」用的。
   node tools/test-holdings.js —— 全綠才 commit（零相依，不需要 npm install）。 */
const fs = require('fs');
const vm = require('vm');

const store = {};
const ctx = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  // site.js 在載入時會跑一次 renderTimestamps / 綁 DOMContentLoaded，
  // 這裡只是餵它足夠的假 DOM 讓檔案跑得完，不測畫面。
  document: { addEventListener() {}, querySelectorAll: () => [], body: { getAttribute: () => null } },
  setInterval() {}, setTimeout() {},
  URLSearchParams,      // holdingsFromLocation() 用得到
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
/* ⚠️ key 從 v4 起帶著單 ID：同一顆箱子出現在兩單是常態（倍率最高的那幾顆
   每輪都會被選中），不含單 ID 的話第二單的成交價會蓋掉第一單的。
   舊的純品項名 key 留在 legacyKey，讓升級前回填過的成交價還讀得到。 */
eq('v1 key 帶著單 ID', h[0].key, 'legacy::Kilowatt Case');
eq('v1 舊 key 仍留著（成交價不會因為升級而消失）', h[0].legacyKey, 'Kilowatt Case');
eq('v3 資料自動歸到「舊單」底下', Object.keys(ctx.readCheckedAll()), ['legacy']);

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
const p4 = ctx.holdingsToParamV4(h);
const back = ctx.paramToHoldingsV4(p4.it, p4.t0);
eq('往返後列數相同', back.length, h.length);
eq('往返後數量', back.map(i => i.qty), [13, 5]);
eq('往返後實付', back.map(i => i.paidTwd), [280, null]);
eq('往返後保住「數量是估計」的標記', back.map(i => i.qtyIsEstimate), [false, true]);
eq('往返後 defIndex', back.map(i => i.defIndex), ['4001', '4002']);
eq('往返後單 ID 跟著回來', back.map(i => i.oid), ['legacy', 'legacy']);
/* ⚠️ **有 defIndex 就不帶名稱**，這是新格式最大的一筆節省（名稱是網址裡最貴的
   東西）。代價是另一端要查資料庫還原——這條測試就是那個代價本身，
   紅了代表有人把名稱又塞回網址，或是把還原那段拿掉了。 */
eq('有 defIndex 時網址不帶名稱', back.map(i => i.name), [null, null]);
eq('沒有 defIndex 時一定要帶名稱（否則另一端認不出來）',
  ctx.paramToHoldingsV4(ctx.holdingsToParamV4([{
    name: 'A:B,C&D', qty: 2, unitCostTwd: 1, defIndex: null, paidTwd: null,
    qtyIsEstimate: false, boughtAtIsEstimate: false }]).it, '0')[0].name, 'A:B,C&D');

/* 舊網址（`items=`）的路必須留著：已經在使用者行事曆裡的 .ics 不會自己更新。 */
eq('新舊參數各走各的路：有 it 就走新的',
  ctx.holdingsFromLocation('?it=' + p4.it + '&t0=' + p4.t0).length, 2);
eq('新舊參數各走各的路：只有 items 就走舊的',
  ctx.holdingsFromLocation('?items=Kilowatt%20Case:20:21:4001').length, 1);

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
eq('追蹤網址指向乾淨的 base', url.indexOf('https://x.test/sell.html?it=') === 0, true);
eq('追蹤網址帶時間基準 t0', /[?&]t0=[0-9a-z]+/.test(url), true);
eq('追蹤網址帶產生時間', /[?&]at=\d+/.test(url), true);

/* 轉手（賣出頁再複製一次）時 `at` 要沿用，不能刷新成現在——
   `at` 講的是資料是什麼時候的快照，另一端「我在看多舊的資料」全靠它。 */
const relay = ctx.holdingsTrackUrl(src, 'https://x.test/sell.html', 1787000000);
eq('轉手時沿用原本的快照時間', /[?&]at=1787000000(&|$)/.test(relay), true);
eq('不給就是現在', Math.abs(Number(url.match(/[?&]at=(\d+)/)[1]) - Date.now() / 1000) < 5, true);
/* 亂值不要當成時間用掉（0／負數／NaN 都退回現在） */
eq('at=0 退回現在',
  Math.abs(Number(ctx.holdingsTrackUrl(src, 'https://x.test/sell.html', 0)
    .match(/[?&]at=(\d+)/)[1]) - Date.now() / 1000) < 5, true);

const moved = ctx.paramToHoldingsV4(url.match(/[?&]it=([^&]+)/)[1], url.match(/[?&]t0=([^&]+)/)[1]);
/* 另一端還原名稱的那一步（賣出頁是拿 defIndex 去查 cases_data 的 CSFloat_ID）。
   ⚠️ 還原完一定要重算 key——key 是拿名稱組出來的。 */
const NAMES = { '4001': 'Kilowatt Case', '4002': 'Clutch Case' };
eq('搬過去：名稱還沒還原之前是 null', moved.every(i => i.name === null), true);
moved.forEach(i => { if (!i.name && i.defIndex != null) i.name = NAMES[String(i.defIndex)]; });
ctx.assignHoldingKeys(moved);
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
eq('存進去成功', ctx.saveHoldingsToDevice(moved).ok, true);
const after = ctx.readHoldings().items;
eq('存完：批數一樣', after.length, 3);
eq('存完：數量一樣', after.map(i => i.qty), [13, 4, 5]);
eq('存完：計畫數量還在（品項層級，取最大值不是加總）',
  after.map(i => i.plannedQty), [20, 20, 5]);
eq('存完：實付一樣', after.map(i => i.paidTwd), [280, 95, 210]);
eq('存完：時間一樣', after.map(i => i.boughtAt),
  ['2026-08-15T02:00:00.000Z', '2026-08-17T09:30:00.000Z', '2026-08-16T00:00:00.000Z']);
eq('存完：closed 還在', ctx.readCheckedMap()['Kilowatt Case'].closed, true);
eq('存完：批數（v4 起數的是批不是品項——問句要講會蓋掉幾批）',
  ctx.countStoredHoldings(), 3);
/* ⚠️⚠️ 到貨時間一定要跟著搬。v3 的 saveHoldingsToDevice() 漏了 got，症狀是
   桌機按過「物品到了」的批次一存到新裝置就退回估計值——而按那顆按鈕的
   唯一理由就是不要估計值。 */
const GOTBUY = '2026-08-15T02:00:00.000Z', GOTARR = '2026-08-18T02:00:00.000Z';
Object.keys(store).forEach(k => delete store[k]);
ctx.saveHoldingsToDevice([{
  oid: 'o1', name: 'Kilowatt Case', qty: 13, plannedQty: 20, unitCostTwd: 21, defIndex: '4001',
  paidTwd: 280, qtyIsEstimate: false, boughtAt: GOTBUY, arrivedAt: GOTARR, closed: false,
}]);
const savedGot = ctx.readHoldings().items[0];
eq('搬家後到貨時間還在', savedGot.arrivedAt, GOTARR);
eq('搬家後冷卻期起點仍是到貨時間', savedGot.cooldownFrom, GOTARR);
eq('搬家後不會退回估計值', savedGot.cooldownFromIsEstimate, false);

/* ⚠️ 估計值不可以在搬家過程中被洗成確定值 */
Object.keys(store).forEach(k => delete store[k]);
const estP = ctx.holdingsToParamV4([{
  name: 'A', qty: 7, plannedQty: 7, unitCostTwd: 10, defIndex: null, paidTwd: null,
  qtyIsEstimate: true, boughtAtIsEstimate: true, boughtAt: '2026-08-15T02:00:00.000Z', closed: false,
}]);
ctx.saveHoldingsToDevice(ctx.paramToHoldingsV4(estP.it, estP.t0));
eq('搬家不會把「沒填數量」洗成確定值', ctx.readCheckedMap()['A'].lots[0].qty, null);
eq('搬家後仍標為估計', ctx.readHoldings().items[0].qtyIsEstimate, true);

/* 沒東西可存時不要寫出一個空的 combo 蓋掉現有資料 */
reset({ 'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } });
eq('空清單不寫入', ctx.saveHoldingsToDevice([]).ok, false);
eq('名稱沒還原就不准存（否則會種下對不上 cases_data 的假品項名）',
  ctx.saveHoldingsToDevice([{ oid: 'x', name: null, defIndex: '4001', qty: 1 }]).reason, 'names');
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
const decP = ctx.holdingsToParamV4([{
  name: 'Kilowatt Case', qty: 13, unitCostTwd: 16.25, defIndex: 4001,
  paidTwd: 279.5, qtyIsEstimate: false, boughtAtIsEstimate: false,
  boughtAt: '2026-08-15T02:00:00.000Z'
}]);
const decBack = ctx.paramToHoldingsV4(decP.it, decP.t0)[0];
eq('往返後實付保住小數', decBack.paidTwd, 279.5);
/* ⚠️ 有實付總額時**刻意不帶計畫單價**：那個估計值只在沒填實付時才用得到。
   代價是使用者事後把實付清掉會只剩 0，所以賣出頁那格要說「沒有成本資料」，
   不能印「估 NT$ 0.00」。 */
eq('有實付時不帶計畫單價', decBack.unitCostTwd, 0);
const noPaid = ctx.holdingsToParamV4([{
  name: 'Kilowatt Case', qty: 13, unitCostTwd: 16.25, defIndex: 4001, paidTwd: null,
  qtyIsEstimate: false, boughtAtIsEstimate: false, boughtAt: '2026-08-15T02:00:00.000Z'
}]);
eq('沒實付時計畫單價要保住小數',
  ctx.paramToHoldingsV4(noPaid.it, noPaid.t0)[0].unitCostTwd, 16.25);
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

/* ── 13. 冷卻期起點：到貨時間才是起點（2026-08-29）─────────────
   ⚠️ 這一段量的是一個**方向**問題，不是精度問題。
      冷卻期是從「物品進到庫存」起算的（DECISIONS 4.10 兩欄都這樣寫），
      但網站原本拿的是購物清單的勾選時間 ≈ 你在 CSFloat 下單那一刻。
      CSFloat 是掛單制，賣家收到訂單之後才去送交易報價——不保證即時。
      拿下單時間當起點會把解鎖日算得**太早**，使用者照著回來卻上架不了。 */
const DAY = 86400000;
const BUY = '2026-08-15T02:00:00.000Z';
const GOT = '2026-08-18T02:00:00.000Z';   // 賣家拖了整整三天才轉移

const csEst = ctx.cooldownStart(BUY, null);
const csGot = ctx.cooldownStart(BUY, GOT);
eq('沒到貨時間 → 起點是估計的', csEst.isEstimate, true);
/* ⚠️ **不加任何緩衝。** 2026-08-29 這裡一度是「下單 + 1 天」，那個 1 天是
   從一份誤診的回報推出來的（真正的問題是行事曆的全天事件只有日期沒有時刻）。
   下界就要是下界——加一個猜的數字上去，既不是下界也不是實際值。 */
eq('沒到貨時間 → 起點就是下單那一刻，不加緩衝',
  Date.parse(csEst.at) - Date.parse(BUY), 0);
eq('沒到貨時間 → at 原封不動', csEst.at, BUY);
eq('有到貨時間 → 起點就是到貨那一刻', csGot.at, GOT);
eq('有到貨時間 → 不是估計值', csGot.isEstimate, false);
eq('兩個都沒有 → 沒有起點', ctx.cooldownStart(null, null).at, null);

/* ⚠️ 賣家拖三天的情況，兩者差的是三天不是一天——緩衝只是退路，
      不是「反正加一天就對了」。這條擋的是「乾脆全站冷卻期改 8 天」那種修法。 */
eq('賣家拖三天時，解鎖日跟著晚三天',
  ctx.unlockAt(csGot.at) - ctx.unlockAt(BUY), 3 * DAY);

/* holdings 要把三個欄位都帶出來，而且 boughtAt 不可以被覆蓋掉——
   它還有另一個用途（認「這是不是這次買的」）。 */
reset({
  'Kilowatt Case': { lots: [{ at: BUY, got: GOT, qty: 13, paidTwd: 280 }], closed: false },
  'Clutch Case':   { lots: [{ at: BUY, qty: 5, paidTwd: 200 }], closed: false },
});
h = ctx.readHoldings().items;
const withGot = h.find(i => i.name === 'Kilowatt Case');
const noGot   = h.find(i => i.name === 'Clutch Case');
eq('有到貨：cooldownFrom = 到貨時間', withGot.cooldownFrom, GOT);
eq('有到貨：不標成估計', withGot.cooldownFromIsEstimate, false);
eq('有到貨：boughtAt 仍然是下單時間', withGot.boughtAt, BUY);
eq('沒到貨：cooldownFrom 就是下單那一刻',
  Date.parse(noGot.cooldownFrom) - Date.parse(BUY), 0);
eq('沒到貨：標成估計', noGot.cooldownFromIsEstimate, true);
eq('沒到貨：arrivedAt 是 null，不要填假的', noGot.arrivedAt, null);

/* 文案：估計的起點不可以講死。使用者白跑一趟比晚一天知道更糟。 */
const NOW = Date.parse('2026-08-20T00:00:00.000Z');
eq('估計時要說「最快」',
  /最快/.test(ctx.cooldownText(noGot.cooldownFrom, NOW, true).text), true);
eq('確定時不要說「最快」',
  /最快/.test(ctx.cooldownText(withGot.cooldownFrom, NOW, false).text), false);
eq('估計且已到期 → 只能說「應該可以賣了」',
  ctx.cooldownText(csEst.at, Date.parse('2026-09-30T00:00:00.000Z'), true).text, '應該可以賣了');

/* 跨裝置：到貨時間一定要編進網址的第 9 段。
   ⚠️ 少了它，桌機按過「物品到了」的批次到手機上會退回估計值——
      而使用者按那顆按鈕的唯一理由就是他不要估計值。 */
const gotP = ctx.holdingsToParamV4(h);
const gotBack = ctx.paramToHoldingsV4(gotP.it, gotP.t0);
gotBack.forEach(i => { if (!i.name) i.name = ({ '4001': 'Kilowatt Case', '4002': 'Clutch Case' })[i.defIndex]; });
const backWith = gotBack.find(i => i.name === 'Kilowatt Case');
const backNo   = gotBack.find(i => i.name === 'Clutch Case');
eq('往返後保住到貨時間', backWith.arrivedAt, GOT);
eq('往返後起點仍是到貨時間', backWith.cooldownFrom, GOT);
eq('往返後仍不是估計值', backWith.cooldownFromIsEstimate, false);
eq('沒到貨的那批往返後仍是估計值', backNo.cooldownFromIsEstimate, true);

/* 舊網址（八段，沒有第 9 段）要讀得回來，而且不可以假裝有到貨時間 */
const eight = ctx.paramToHoldings('Kilowatt%20Case:20:21:4001:280::20:' + Math.floor(Date.parse(BUY) / 1000), null)[0];
eq('舊八段網址 → 到貨時間是 null', eight.arrivedAt, null);
eq('舊八段網址 → 起點退回估計值', eight.cooldownFromIsEstimate, true);
eq('舊八段網址 → 起點就是下單那一刻',
  Date.parse(eight.cooldownFrom) - Date.parse(BUY), 0);


/* ── 12. 多單（v4，2026-08-31）────────────────────────────
   一「單」＝一次「試算 → 買 → 等 7 天 → 賣」。加這一層之前，兩份計畫同時
   在跑會壞在兩個地方：計畫數量被後來的試算蓋掉、還在冷卻期的批次被標成
   「上一份留下的」。下面幾條擋的就是那兩件事回來。 */
function fresh() { Object.keys(store).forEach(k => delete store[k]); }

/* 草稿規則：還沒買東西的那一單就是草稿，重新試算改寫它，不開新單。 */
fresh();
const PLAN_A = [{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }];
const PLAN_B = [{ name: 'Clutch Case', qty: 5, unitCostTwd: 40, defIndex: 4002 }];
const oidA = ctx.saveOrderPlan(PLAN_A);
eq('試算 → 開了一單', Object.keys(ctx.readOrders()).length, 1);
ctx.saveOrderPlan(PLAN_A.concat(PLAN_B));
eq('再試算一次（還沒買東西）→ 仍然只有一單，不是兩單',
  Object.keys(ctx.readOrders()).length, 1);

/* 買了東西之後再試算 → 一定要開新的一單，舊單的計畫不可以被蓋掉。
   ⚠️ 這是 v4 之前最明顯的資料損失：第一單的「計畫 20」被第二單蓋成別的數字，
      「還差幾個」與可買到率跟著全錯，而可買到率是買入側唯一的驗證來源。 */
ctx.writeCheckedMap({ 'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } }, oidA);
const oidB = ctx.saveOrderPlan([{ name: 'Kilowatt Case', qty: 7, unitCostTwd: 22, defIndex: 4001 }]);
eq('買過東西之後再試算 → 開新的一單', Object.keys(ctx.readOrders()).length, 2);
eq('新舊是兩個不同的 ID', oidA !== oidB, true);
eq('舊單的計畫數量沒有被蓋掉', ctx.readOrders()[oidA].plan[0].qty, 20);

/* 兩單買到同一顆箱子：實付與成交價都不可以互相汙染。 */
ctx.writeCheckedMap({ 'Kilowatt Case': { lots: [{ at: '2026-08-20T02:00:00.000Z', qty: 7, paidTwd: 160 }], closed: false } }, oidB);
const two = ctx.readHoldings().items;
/* ⚠️ 用單 ID 找，不要靠陣列順序：兩單可能在同一毫秒建立，那時排序分不出先後。
   （實務上人不可能在一毫秒內試算兩次，但測試會。） */
const itemA = two.find(i => i.oid === oidA);
const itemB = two.find(i => i.oid === oidB);
eq('兩單各自一列', two.length, 2);
eq('兩單都找得到', !!(itemA && itemB), true);
eq('兩單的實付各自獨立', two.map(i => i.paidTwd).sort((a, b) => a - b), [160, 280]);
eq('兩單的 key 不撞（否則第二單的成交價會蓋掉第一單的）',
  itemA.key !== itemB.key, true);
eq('兩單的計畫數量各自獨立', two.map(i => i.plannedQty).sort((a, b) => a - b), [7, 20]);

let soldMap = {};
ctx.setSoldValue(soldMap, itemA, '30');
ctx.setSoldValue(soldMap, itemB, '45');
eq('成交價各記各的', [ctx.soldEntry(soldMap, itemA).twd, ctx.soldEntry(soldMap, itemB).twd], [30, 45]);
eq('成交價有記下成交時間（帳本要算鎖了幾天）',
  typeof ctx.soldEntry(soldMap, itemA).at, 'string');
/* 金額沒變就不要動成交時間 */
const firstAt = ctx.soldEntry(soldMap, itemA).at;
ctx.setSoldValue(soldMap, itemA, '30');
eq('重填同一個金額不會刷新成交時間', ctx.soldEntry(soldMap, itemA).at, firstAt);
/* v4 之前的成交價（key 是純品項名、裸數字）還要讀得到——
   ⚠️ 這條紅了代表升級當下所有回填過的成交價會一起消失。 */
const soldBefore = store['sah-sold-v1'];
store['sah-sold-v1'] = JSON.stringify({ 'Kilowatt Case': 99 });
eq('v4 之前的裸數字成交價讀得回來', ctx.soldEntry(ctx.readSoldAll(), itemA).twd, 99);
eq('v4 之前的成交價沒有成交時間，不要編一個', ctx.soldEntry(ctx.readSoldAll(), itemA).at, null);
if (soldBefore === undefined) delete store['sah-sold-v1']; else store['sah-sold-v1'] = soldBefore;

/* 結案：不刪東西，只是從「還要處理」移到帳本。 */
ctx.setOrderClosed(oidA, true);
eq('結案後不再出現在持有清單', ctx.readHoldings().items.length, 1);
eq('結案後仍然在帳本裡', ctx.readLedger().length, 2);
eq('結案的單資料原封不動',
  ctx.readLedger().find(o => o.oid === oidA).items[0].paidTwd, 280);
eq('重新打開就回來', (ctx.setOrderClosed(oidA, false), ctx.readHoldings().items.length), 2);

/* 匯出／匯入往返。⚠️ 這是 Safari 7 天清除之後唯一的救援路徑，
   往返弄丟任何一個欄位＝那個欄位在使用者的帳本裡永遠消失。 */
ctx.setOrderClosed(oidA, true);
ctx.writeSoldAll(soldMap);
const dump = JSON.parse(JSON.stringify(ctx.exportLedgerData()));
fresh();
eq('匯入回來', ctx.importLedgerData(dump).ok, true);
eq('匯入後單數一樣', ctx.readLedger().length, 2);
eq('匯入後結案狀態保住', !!ctx.readOrders()[oidA].closedAt, true);
const backA = ctx.readLedger().find(o => o.oid === oidA).items[0];
eq('匯入後實付保住', backA.paidTwd, 280);
eq('匯入後成交價保住', ctx.soldEntry(ctx.readSoldAll(), backA).twd, 30);
eq('別人的 JSON 不要收', ctx.importLedgerData({ foo: 1 }).ok, false);

/* CSV：一批一列，開頭要有 BOM（沒有的話 Excel 開起來是亂碼）。 */
const csv = ctx.ledgerCsv();
eq('CSV 有 BOM', csv.charCodeAt(0), 0xFEFF);
eq('CSV 一批一列（兩單各一批 + 表頭）', csv.trim().split('\r\n').length, 3);

/* ── 13. 網址長度：新格式不可以比舊格式長 ────────────────
   ⚠️ 這條是回歸守門。名稱、時間、單價任何一個被塞回網址都會在這裡變紅——
      而網址是 Safari 上唯一帶得走的副本，長度直接決定它貼不貼得進
      LINE／行事曆／記事本（那些中繼常在 2,000 字元附近截斷）。 */
fresh();
const many = [];
for (let i = 0; i < 15; i++) {
  many.push({
    oid: 'o1', name: 'Operation Breakout Weapon Case', defIndex: String(4000 + i),
    qty: 13, plannedQty: 20, unitCostTwd: 16.25, paidTwd: 280.55,
    qtyIsEstimate: false, boughtAtIsEstimate: false, closed: false,
    boughtAt: new Date(1787000000000 + i * 3600000).toISOString(),
    arrivedAt: new Date(1787000000000 + i * 3600000 + 86400000).toISOString(),
  });
}
const newUrl = ctx.holdingsTrackUrl(many, 'https://kk162198.github.io/steam_casher_website/sell.html');
eq('15 批的追蹤網址短於 900 字元（舊格式是 1,413）', newUrl.length < 900, true);
eq('15 批的追蹤網址短於 2,000（貼得進 LINE 與行事曆）', newUrl.length < 2000, true);
/* 同一單的批次連在一起時，單 ID 只寫一次 */
eq('同一單的單 ID 不重複寫',
  (ctx.holdingsToParamV4(many).it.match(/o1/g) || []).length, 1);


/* ── 14. 刪除（2026-08-31）────────────────────────────────
   ⚠️ 刪除是這個站唯一不可逆的動作，而且刪的是重建不回來的東西
      （CSFloat 的結帳紀錄不會自己回來）。下面幾條守的是「刪對範圍」。 */
fresh();
const dA = ctx.saveOrderPlan([{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }]);
ctx.writeCheckedMap({ 'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } }, dA);
const dB = ctx.saveOrderPlan([{ name: 'Clutch Case', qty: 5, unitCostTwd: 40, defIndex: 4002 }]);
ctx.writeCheckedMap({ 'Clutch Case': { lots: [{ at: '2026-08-20T02:00:00.000Z', qty: 5, paidTwd: 200 }], closed: false } }, dB);
let sm = {};
ctx.readHoldings().items.forEach((i, n) => ctx.setSoldValue(sm, i, String(30 + n)));
ctx.writeSoldAll(sm);
eq('刪之前兩單', ctx.readLedger().length, 2);

eq('刪掉不存在的單回 false（不要假裝成功）', ctx.deleteOrder('沒有這一單'), false);
eq('刪掉一單', ctx.deleteOrder(dA), true);
eq('刪完只剩一單', ctx.readLedger().map(o => o.oid), [dB]);
eq('被刪那單的批次也走了', ctx.readCheckedAll()[dA], undefined);
/* ⚠️ 成交價一定要一起刪。留著就是一批永遠對不上任何一單、卻帶著金額的孤兒 key，
   使用者以為刪乾淨了，其實沒有。 */
eq('被刪那單的成交價一起走',
  Object.keys(ctx.readSoldAll()).some(k => k.indexOf(dA + '::') === 0), false);
eq('沒被刪的那單成交價還在',
  Object.keys(ctx.readSoldAll()).some(k => k.indexOf(dB + '::') === 0), true);
eq('沒被刪的那單實付還在', ctx.readLedger()[0].items[0].paidTwd, 200);

/* ⚠️⚠️ 刪光之後不可以從舊 key 復活。readOrders() 的遷移退路只在「這台裝置
   還沒有 v4 容器」時才該生效——有容器但空的，代表使用者把單刪光了，
   而他按刪除的理由常常正是「不想留在這台電腦上」。 */
eq('刪掉最後一單', ctx.deleteOrder(dB), true);
eq('刪光之後就是空的', ctx.readLedger().length, 0);
store['sah-combo-v1'] = COMBO;                    // 舊 key 還在也不能復活
eq('舊的 sah-combo-v1 不會讓刪掉的單復活', ctx.readLedger().length, 0);

/* 舊單（legacy）的計畫住在 sah-combo-v1，刪除要一起清掉——
   不清的話按完「刪除」，資料還躺在磁碟上。 */
reset({ 'Kilowatt Case': { lots: [{ at: '2026-08-15T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } });
eq('遷移出來的舊單在', ctx.readLedger().length, 1);
eq('刪掉舊單', ctx.deleteOrder('legacy'), true);
eq('舊單的計畫也從 sah-combo-v1 清掉', store['sah-combo-v1'], undefined);
eq('刪完真的空了', ctx.readLedger().length, 0);

/* 兩種整批刪除的範圍不一樣 */
function seedEverything() {
  fresh();
  ctx.saveOrderPlan([{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }]);
  store['sah-sold-v1'] = JSON.stringify({ v: 4, sold: {} });
  store['sah-setup-v1'] = JSON.stringify({ steps: {}, doneAt: '2026-08-20T00:00:00.000Z' });
  store['sah-eligibility-v2'] = JSON.stringify({ authenticator: 'yes' });
  store['sah-cap-pct-v1'] = '0.25';
}
seedEverything();
eq('刪掉全部交易紀錄', ctx.clearRecords(), true);
eq('紀錄沒了', ctx.readLedger().length, 0);
eq('設定留著（重做一次就有的東西不必一起殺）', typeof store['sah-setup-v1'], 'string');
eq('偏好留著', store['sah-cap-pct-v1'], '0.25');

seedEverything();
eq('清空全部', ctx.clearAllLocalData(), true);
eq('清空後一個 key 都不剩', Object.keys(store).length, 0);

/* ⚠️ 靜態檢查：所有 `sah-` 開頭的 key 都要在 siteStorageKeys() 裡。
   漏掉一個，「清空這台裝置上的所有本站資料」就是一句謊話——而使用者按那顆
   的理由常常是「這台不是我的電腦」。新增 key 忘了登記時這條會紅。 */
{
  const keys = ctx.siteStorageKeys();
  const known = new Set(keys.records.concat(keys.settings, keys.prefs));
  const used = new Set();
  fs.readdirSync(__dirname + '/..')
    .filter(f => f.endsWith('.html'))
    .concat(['assets/site.js'])
    .forEach(f => {
      const text = fs.readFileSync(__dirname + '/../' + f, 'utf8');
      (text.match(/'sah-[a-z0-9-]+'/g) || []).forEach(m => used.add(m.slice(1, -1)));
    });
  const missing = [...used].filter(k => !known.has(k)).sort();
  eq('沒有漏登記的 localStorage key', missing, []);
  eq('登記的 key 都真的有人用',
    [...known].filter(k => !used.has(k)).sort(), []);
}

/* ⚠️ 靜態檢查：每個 HTML 引用 site.js 都要帶 `?v=`，而且要等於 SITE_JS_VERSION。
   忘了改版本號的後果不是「少一個優化」，是 2026-09-04 那個 bug 會原封不動地回來：
   新 HTML 配到快取裡的舊 site.js，呼叫一個還不存在的函式，整頁報「資料讀取失敗」，
   十分鐘後自己好——最難查的那一種。這條紅了就是「site.js 改了、版本號沒跟上」。
   （setup.html 例外：它是轉址殼，刻意不載入 site.js，見該檔註解。） */
{
  const ver = ctx.SITE_JS_VERSION;
  eq('site.js 有宣告版本號', typeof ver === 'string' && ver.length > 0, true);

  const tag = /<script[^>]*\ssrc="assets\/site\.js(\?v=([^"]*))?"/g;
  const bad = [];
  let tagged = 0;
  fs.readdirSync(__dirname + '/..')
    .filter(f => f.endsWith('.html'))
    .sort()
    .forEach(f => {
      /* ⚠️ 先把 HTML 註解拿掉再掃：setup.html 的註解裡寫著「不要加
         <script src="assets/site.js">」，那是說明不是引用，掃進來會假紅。 */
      const text = fs.readFileSync(__dirname + '/../' + f, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '');
      let m;
      tag.lastIndex = 0;
      while ((m = tag.exec(text))) {
        tagged++;
        if (m[2] !== ver) bad.push(f + ' → ' + (m[1] || '（沒有 ?v=）'));
      }
    });
  eq('每個 HTML 的 site.js 版本號都對得上 SITE_JS_VERSION（' + ver + '）', bad, []);

  /* ⚠️ 上面那條只檢查「有引用的」，所以要防它自己失效：正規式哪天對不上任何東西
     （改了引用寫法、標籤換行、屬性順序變了），bad 會是空陣列而整條靜靜地變成永遠通過。
     頁面數量只增不減，門檻壓在 12 就夠。 */
  eq('掃到的 site.js 引用數量合理（不是正規式壞掉）', tagged >= 12, true);
}

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
