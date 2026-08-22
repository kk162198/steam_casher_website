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

/* ── 8. 毛額 → 淨額：必須與後端 calc_steam_income 逐分對齊 ──
   右邊的期望值是直接跑 update_derived_fields.py 的 calc_steam_income
   取得的，不是手算的。改動任一邊時這幾條會先紅。 */
[[1.52, 1.33], [0.03, 0.01], [0.50, 0.44], [3.87, 3.38], [100, 86.97], [0, 0]]
  .forEach(([gross, net]) => eq('毛額 ' + gross + ' → 淨額 ' + net, ctx.steamNetUsd(gross), net));
eq('不是 ×0.85（那會低估約 2.3%）', ctx.steamNetUsd(100) !== 85, true);

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
