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

/* ── 8. 毛額 → 淨額：必須與後端 calc_steam_income 逐分對齊 ──
   右邊的期望值是直接跑 update_derived_fields.py 的 calc_steam_income
   取得的，不是手算的。改動任一邊時這幾條會先紅。 */
[[1.52, 1.33], [0.03, 0.01], [0.50, 0.44], [3.87, 3.38], [100, 86.97], [0, 0]]
  .forEach(([gross, net]) => eq('毛額 ' + gross + ' → 淨額 ' + net, ctx.steamNetUsd(gross), net));
eq('不是 ×0.85（那會低估約 2.3%）', ctx.steamNetUsd(100) !== 85, true);

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
