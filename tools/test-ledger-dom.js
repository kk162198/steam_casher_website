/* 帳本頁的畫面實測。這一頁不連資料庫——每個數字都來自使用者自己填的東西，
   所以測試也不需要任何網路替身。
   node tools/test-ledger-dom.js —— 全綠才 commit。 */
const fs = require('fs');
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

const BUY = '2026-08-01T00:00:00.000Z';
const SOLDAT = '2026-08-11T00:00:00.000Z';   // 買進後第 10 天賣掉

const ORDERS = {
  v: 4,
  orders: {
    o_done: { createdAt: BUY, closedAt: '2026-08-12T00:00:00.000Z',
      plan: [{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }] },
    o_open: { createdAt: '2026-08-20T00:00:00.000Z', closedAt: null,
      plan: [{ name: 'Clutch Case', qty: 5, unitCostTwd: 40, defIndex: 4002 }] },
  },
};
const CHECKED = {
  v: 4,
  orders: {
    o_done: { 'Kilowatt Case': { lots: [{ at: BUY, got: null, qty: 13, paidTwd: 280 }], closed: true } },
    o_open: { 'Clutch Case': { lots: [{ at: '2026-08-20T02:00:00.000Z', got: null, qty: 5, paidTwd: 200 }], closed: false } },
  },
};
/* 賣在每個 NT$30。13 個 → 實拿 steamNetTwd(30) × 13 = 26 × 13 = 338。 */
const SOLD = { v: 4, sold: { 'o_done::Kilowatt Case': { twd: 30, at: SOLDAT } } };

function boot(seed) {
  const html = fs.readFileSync(__dirname + '/../ledger.html', 'utf8')
    .replace('<body data-page="ledger">', '<body>')
    /* ⚠️ site.js 的註解裡有一個 </script> 字樣，直接內嵌會把 script 提早關掉。 */
    .replace('<script src="assets/site.js"></script>', () =>
      '<script>' + fs.readFileSync(__dirname + '/../assets/site.js', 'utf8')
        .replace(/<\/script/gi, '<\\/script') + '</script>');
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/ledger.html',
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('no network in test'));
      if (seed !== false) {
        w.localStorage.setItem('sah-orders-v1', JSON.stringify(ORDERS));
        w.localStorage.setItem('sah-checklist-checked-v1', JSON.stringify(CHECKED));
        w.localStorage.setItem('sah-sold-v1', JSON.stringify(SOLD));
      }
    },
  });
}

const dom = boot();
const { document, localStorage } = dom.window;
const cards = () => [...document.querySelectorAll('#lg-list .card')];

eq('兩單各一張卡', cards().length, 2);
eq('新的排前面（帳本是往回看的）', cards()[0].textContent.includes('進行中'), true);
eq('已結案的標成已結案', cards()[1].textContent.includes('已結案'), true);

const done = cards()[1];
eq('結案單顯示實付', done.textContent.includes('實付 NT$ 280.00'), true);
/* ⚠️ 實拿必須過 steamNetTwd()：13 × 26 = 338，不是 13 × 30 = 390。
   直接拿毛額當實拿會憑空生出約 13% 的假獲利——DECISIONS 4.7 踩過的那一次。 */
eq('實拿是稅後的 338，不是毛額 390', done.textContent.includes('實拿 NT$ 338.00'), true);
eq('差額 +58', done.textContent.includes('+NT$ 58.00'), true);
eq('鎖了幾天用成交時間算', done.textContent.includes('鎖了 10 天'), true);

const open = cards()[0];
eq('沒回填成交價的單不編一個差額出來',
  open.textContent.includes('還沒回填成交價'), true);
eq('還沒賣完就不能說「鎖了幾天」', open.textContent.includes('鎖了'), false);
eq('還沒賣完講的是「還沒賣完」', open.textContent.includes('還沒賣完'), true);

/* 合計只加已結案的單。進行中的還會變，加進來等於把沒發生完的事寫成結論。 */
eq('合計區出現', document.getElementById('lg-sum-sec').hidden, false);
eq('合計只算已結案的 1 單', document.getElementById('lg-sum-orders').textContent, '1 單');
eq('合計實付不含進行中的 200',
  document.getElementById('lg-sum-paid').textContent, 'NT$ 280.00');
eq('合計實拿是稅後的', document.getElementById('lg-sum-net').textContent, 'NT$ 338.00');
/* ⚠️ 這一頁刻意不做績效。年化、報酬率曲線、下一單建議都不該出現。 */
eq('不講報酬率，只講「已經發生的事的加總」',
  document.getElementById('lg-sum-note').textContent.includes('不是報酬率'), true);
eq('沒有年化', document.getElementById('lg-list').textContent.includes('年化'), false);

/* 重新打開：結案是可逆的，而且不動任何一筆資料 */
document.querySelector('[data-toggle="o_done"]').dispatchEvent(new dom.window.Event('click'));
eq('重新打開清掉 closedAt',
  JSON.parse(localStorage.getItem('sah-orders-v1')).orders.o_done.closedAt, null);
eq('重新打開後不再有已結案的單', document.getElementById('lg-sum-sec').hidden, true);
eq('重新打開不動批次',
  JSON.parse(localStorage.getItem('sah-checklist-checked-v1'))
    .orders.o_done['Kilowatt Case'].lots[0].paidTwd, 280);

/* 成本不完整時要標出來，不要混在一起講得像實際損益 */
const partial = boot(false);
partial.window.localStorage.setItem('sah-orders-v1', JSON.stringify({
  v: 4, orders: { x: { createdAt: BUY, closedAt: null,
    plan: [{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }] } },
}));
partial.window.localStorage.setItem('sah-checklist-checked-v1', JSON.stringify({
  v: 4, orders: { x: { 'Kilowatt Case': { lots: [{ at: BUY, qty: null, paidTwd: null }], closed: false } } },
}));
partial.window.localStorage.setItem('sah-sold-v1', JSON.stringify({ v: 4, sold: { 'x::Kilowatt Case': { twd: 30, at: SOLDAT } } }));
partial.window.render();
{
  const t = partial.window.document.querySelector('#lg-list .card').textContent;
  eq('沒填實付 → 標出成本是估計值', t.includes('部分成本是試算估計值'), true);
  eq('沒填數量 → 標出用計畫值', t.includes('部分數量用計畫值'), true);
  eq('講明這個差額不是實際損益', t.includes('不是實際損益'), true);
}

/* 空的時候不要留白，要給下一步 */
const empty = boot(false);
eq('沒有任何一單時給出路',
  empty.window.document.getElementById('lg-list').textContent.includes('還沒有任何一單'), true);
eq('空的時候不顯示合計', empty.window.document.getElementById('lg-sum-sec').hidden, true);

/* ── 刪除 ──────────────────────────────────────────────────
   ⚠️ 這一頁唯一不可逆的地方。守三件事：兩段式（第一下不能刪）、武裝時要把
      具體會失去什麼講出來、只刪那一單。 */
{
  const d = boot();
  const doc2 = d.window.document;
  const cardOf = oid => [...doc2.querySelectorAll('#lg-list [data-del]')]
    .find(b => b.dataset.del === oid);
  const note = () => doc2.getElementById('lg-io-note').textContent;
  const click = el => el.dispatchEvent(new d.window.Event('click'));

  eq('每張卡都有刪除鍵', doc2.querySelectorAll('#lg-list [data-del]').length, 2);
  eq('結案與刪除是兩顆不同的按鈕（不可逆的那顆不要混進可逆的那顆）',
    doc2.querySelectorAll('#lg-list [data-toggle]').length, 2);

  click(cardOf('o_done'));
  eq('第一下不刪任何東西', Object.keys(JSON.parse(
    doc2.defaultView.localStorage.getItem('sah-orders-v1')).orders).sort(), ['o_done', 'o_open']);
  eq('第一下改成「再按一次」', cardOf('o_done').textContent.includes('再按一次'), true);
  /* ⚠️ 只說「確定嗎」沒有用。按錯的成本不是抽象的，要把金額講出來。 */
  eq('武裝時講出幾批', note().includes('1 批'), true);
  eq('武裝時講出實付多少', note().includes('280.00'), true);
  eq('武裝時講出回填了幾筆成交價', note().includes('成交價 1 筆'), true);
  eq('武裝時講明不能復原', note().includes('不能復原'), true);
  eq('武裝時把「先匯出」擺在同一句', note().includes('匯出'), true);

  click(cardOf('o_done'));
  const after = JSON.parse(doc2.defaultView.localStorage.getItem('sah-orders-v1')).orders;
  eq('第二下才真的刪', Object.keys(after), ['o_open']);
  eq('只刪那一單，別單的批次原封不動',
    JSON.parse(doc2.defaultView.localStorage.getItem('sah-checklist-checked-v1'))
      .orders.o_open['Clutch Case'].lots[0].paidTwd, 200);
  eq('那一單的成交價也一起走',
    JSON.parse(doc2.defaultView.localStorage.getItem('sah-sold-v1')).sold['o_done::Kilowatt Case'],
    undefined);
  eq('刪完畫面只剩一張卡', doc2.querySelectorAll('#lg-list .card').length, 1);
}

/* 整批刪除：兩顆的範圍不一樣 */
{
  const d = boot();
  const w = d.window, doc2 = w.document;
  const click = id => doc2.getElementById(id).dispatchEvent(new w.Event('click'));
  w.localStorage.setItem('sah-setup-v1', JSON.stringify({ steps: {}, doneAt: '2026-08-20T00:00:00.000Z' }));

  click('lg-wipe-records');
  eq('整批刪除也是兩段式：第一下不刪',
    !!w.localStorage.getItem('sah-orders-v1'), true);
  eq('武裝時講出會刪掉幾單幾批',
    doc2.getElementById('lg-wipe-note').textContent.includes('2 單、2 批'), true);
  click('lg-wipe-records');
  eq('第二下刪掉全部交易紀錄', w.localStorage.getItem('sah-orders-v1'), null);
  eq('成交價一起走', w.localStorage.getItem('sah-sold-v1'), null);
  /* ⚠️ 範圍要對：交易紀錄與「這台不是我的電腦」是兩個不同的需求 */
  eq('設定不在這顆的範圍裡', !!w.localStorage.getItem('sah-setup-v1'), true);
  eq('刪完畫面回到空狀態',
    doc2.getElementById('lg-list').textContent.includes('還沒有任何一單'), true);
}

{
  const d = boot();
  const w = d.window, doc2 = w.document;
  const click = id => doc2.getElementById(id).dispatchEvent(new w.Event('click'));
  w.localStorage.setItem('sah-setup-v1', JSON.stringify({ steps: {}, doneAt: '2026-08-20T00:00:00.000Z' }));
  w.localStorage.setItem('sah-cap-pct-v1', '0.25');
  click('lg-wipe-all');
  eq('清空全部：第一下也不動', !!w.localStorage.getItem('sah-orders-v1'), true);
  click('lg-wipe-all');
  eq('清空全部：交易紀錄沒了', w.localStorage.getItem('sah-orders-v1'), null);
  eq('清空全部：設定也沒了', w.localStorage.getItem('sah-setup-v1'), null);
  eq('清空全部：偏好也沒了', w.localStorage.getItem('sah-cap-pct-v1'), null);
}

/* ⚠️ 取代與刪除都不用 confirm()：它會擋住畫面，而使用者這一刻要看的就是
   背後那幾張卡。匯入用的是頁面上的確認條。 */
{
  const d = boot();
  eq('匯入的確認在頁面上，不是 confirm()',
    !!d.window.document.getElementById('lg-import-confirm'), true);
  eq('確認條預設是收起來的',
    d.window.document.getElementById('lg-import-confirm').hidden, true);
  eq('確認條有「取消」這條路',
    !!d.window.document.getElementById('lg-import-no'), true);
}

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
