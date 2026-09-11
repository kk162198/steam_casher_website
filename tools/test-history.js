/* site.js 第⑯節（單品歷史）的實測，加上 case.html 的幾條靜態檢查。2026-09-11 新增。
   node tools/test-history.js —— 全綠才 commit（零相依，不需要 npm install）。

   為什麼要有這一支：case.html 的兩張卡是「給使用者看過去」的，錯的方式很安靜——
   圖照樣畫得出來、數字照樣是個百分比，只是量錯了東西。這裡守的是 DECISIONS 4.29
   那三條設計決定：只用每日中位數、只看 Steam 側、不給「現在算高還是算低」。 */
const fs = require('fs');
const vm = require('vm');

const ctx = {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { addEventListener() {}, querySelectorAll: () => [], body: { getAttribute: () => null } },
  setInterval() {}, setTimeout() {},
  URLSearchParams,
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
const near = (a, b, tol) => Math.abs(a - b) < (tol || 1e-9);

/* 連續 n 天的列。sFn / cFn 給第 i 天的中位數；single 是單點欄位（刻意放怪值）。 */
function days(start, n, sFn, cFn, extra) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Object.assign({
      snapshot_date: ctx.ymdAddDays(start, i),
      steam_price_median: sFn(i), csfloat_price_median: cFn(i),
      steam_price: 999, csfloat_price: 0.01,          // 單點：不該被讀到
    }, extra ? extra(i) : {}));
  }
  return out;
}

/* ── 1. 只用每日中位數，不碰單點欄位（4.15）──────────────────── */
{
  const rows = days('2026-08-14', 10, i => 1 + i * 0.01, () => 2);
  const s = ctx.historySeries(rows);
  eq('第一天是 0%', s.points[0].sPct, 0);
  eq('Steam 漲幅照中位數算（1.00 → 1.09 = +9%）', near(s.sChg, 9, 1e-9), true);
  eq('CSFloat 持平', s.cChg, 0);
  eq('單點欄位的 999 沒有滲進來', s.points.every(p => p.s < 2), true);

  // 8/14 以前沒有中位數、當天的中位數隔天才寫 → 那些列不算
  const mixed = [
    { snapshot_date: '2026-08-12', steam_price_median: null, csfloat_price_median: null, steam_price: 1 },
    { snapshot_date: '2026-08-13', steam_price: 1, csfloat_price: 1 },
  ].concat(days('2026-08-14', 8, () => 1, () => 1), [
    { snapshot_date: '2026-08-22', steam_price_median: null, csfloat_price_median: null, steam_price: 5 },
  ]);
  const m = ctx.historySeries(mixed);
  eq('沒有中位數的日子不進序列（頭尾都是）', [m.from, m.to, m.points.length], ['2026-08-14', '2026-08-21', 8]);
  eq('完全沒有中位數 → null', ctx.historySeries([{ snapshot_date: '2026-08-01', steam_price: 1 }]), null);
  eq('空陣列 → null', ctx.historySeries([]), null);
}

/* ── 2. 視窗：最後一個有中位數的日子往回 30 天 ─────────────────── */
{
  const rows = days('2026-08-01', 45, i => 1 + i * 0.01, () => 1);
  const s = ctx.historySeries(rows.slice().reverse());    // 順序打亂也要對
  eq('只留 30 天', s.points.length, ctx.HISTORY_DAYS);
  eq('視窗起點＝終點往回 29 天', s.from, ctx.ymdAddDays(s.to, -29));
  eq('照日期排好', s.points.every((p, i) => i === 0 || s.points[i - 1].d < p.d), true);
  eq('少於 7 天標成 tooFew', ctx.historySeries(days('2026-08-14', 6, () => 1, () => 1)).tooFew, true);
  eq('剛好 7 天可以畫', ctx.historySeries(days('2026-08-14', 7, () => 1, () => 1)).tooFew, false);
}

/* ── 3. 冷卻期統計：只看 Steam 側，而且是 COOLDOWN_DAYS 天一組 ───────
   ⚠️ 這一組是 4.29 的回歸測試：CSFloat 跟著 Steam 一起跌時，倍率看起來持平，
      但使用者（已經付完 CSFloat 的錢）實際承擔的是 Steam 那一側的跌幅。 */
{
  const rows = days('2026-08-14', 21, i => 1 * Math.pow(0.99, i), i => 0.7 * Math.pow(0.99, i));
  const s = ctx.historySeries(rows);
  const st = ctx.coolingStats(s);
  eq('21 天 → 14 個起點', st.n, 21 - ctx.COOLDOWN_DAYS);
  const expect = (Math.pow(0.99, ctx.COOLDOWN_DAYS) - 1) * 100;
  eq('每一組都是 Steam 側的 7 天跌幅（約 −6.8%）', near(st.median, expect, 1e-9), true);
  eq('倍率其實持平——冷卻期統計沒有被它蓋掉', near(s.points[20].s / s.points[20].c, s.points[0].s / s.points[0].c, 1e-9), true);
  eq('一次都沒漲', st.ups, 0);
  eq('最差那組相隔剛好 COOLDOWN_DAYS 天', ctx.ymdDiffDays(st.worst.from, st.worst.to), ctx.COOLDOWN_DAYS);

  // 同一組 Steam、完全不同的 CSFloat → 冷卻期統計必須一模一樣
  const other = ctx.coolingStats(ctx.historySeries(days('2026-08-14', 21, i => 1 * Math.pow(0.99, i), i => 3 + (i % 3))));
  eq('CSFloat 怎麼動都不影響冷卻期統計', [other.n, other.median, other.worst.chg, other.ups], [st.n, st.median, st.worst.chg, st.ups]);
}

/* ── 4. 中位數、最差、上漲次數、獨立段數 ──────────────────────── */
{
  // Steam：前 7 天 1.00，之後 7 天 1.10，再 7 天 0.99 → 起點 0–6 漲 10%，起點 7–13 跌 10%
  const rows = days('2026-08-14', 21, i => (i < 7 ? 1.00 : i < 14 ? 1.10 : 0.99), () => 1);
  const st = ctx.coolingStats(ctx.historySeries(rows));
  eq('14 個起點', st.n, 14);
  eq('7 次漲、7 次跌', st.ups, 7);
  eq('偶數個取中間兩個的平均（+10% 與 −10% → 0%）', near(st.median, 0, 1e-9), true);
  eq('最差 −10%', near(st.worst.chg, -10, 1e-9), true);
  eq('最差那組是第一個出現的（8/21 買）', st.worst.from, '2026-08-21');
  eq('持平不算漲', ctx.coolingStats(ctx.historySeries(days('2026-08-14', 14, () => 1, () => 1))).ups, 0);
  eq('14 個連續起點 → 2 段互不重疊', st.windows, 2);
  eq('21 個連續起點 → 3 段（4.13 那句的量化版）',
    ctx.independentWindows(Array.from({ length: 21 }, (_, i) => ctx.ymdAddDays('2026-08-14', i))), 3);
  eq('剛好隔 7 天的三個起點 → 3 段',
    ctx.independentWindows(['2026-08-14', '2026-08-21', '2026-08-28']), 3);
  eq('少於 7 個起點 → tooFew（不給統計）',
    ctx.coolingStats(ctx.historySeries(days('2026-08-14', 13, () => 1, () => 1))), { n: 6, tooFew: true });
}

/* ── 5. 缺日：不內插。圖上斷開，配對直接跳過 ─────────────────── */
{
  const rows = days('2026-08-14', 21, i => 1 + i * 0.01, () => 1).filter(r => r.snapshot_date !== '2026-08-24');
  const s = ctx.historySeries(rows);
  const st = ctx.coolingStats(s);
  // 8/24 缺：8/17 → 8/24 那組配不到；8/24 → 8/31 那組也配不到
  eq('缺一天，少兩組配對', st.n, 14 - 2);
  const sc = ctx.historyScales(s, 640, 200);
  const path = ctx.historyPath(s.points, 'sPct', sc);
  eq('線在缺日斷開（兩段）', (path.match(/M/g) || []).length, 2);
  eq('x 依日期不依索引：缺日那格留白', near(sc.x('2026-08-25') - sc.x('2026-08-23'), 2 * (sc.x('2026-08-23') - sc.x('2026-08-22')), 1e-6), true);
}

/* ── 6. 顯示格式與 SVG ─────────────────────────────────────── */
{
  eq('正數帶 +', ctx.fmtPct(1.234), '+1.2%');
  eq('負號是 U+2212', ctx.fmtPct(-3.45), '−3.5%');
  eq('四捨五入到 0 就不帶正負號', [ctx.fmtPct(-0.04), ctx.fmtPct(0.04)], ['0.0%', '0.0%']);

  const s = ctx.historySeries(days('2026-08-14', 28, i => 1 - i * 0.003, i => 1 - i * 0.003));
  const svg = ctx.historyChartSvg(s, 640, 200);
  eq('SVG 裡沒有 NaN／undefined／Infinity', /NaN|undefined|Infinity/.test(svg), false);
  eq('兩條線', (svg.match(/<path /g) || []).length, 2);
  eq('CSFloat 那條是虛線（顏色不是唯一的區分）', /stroke="#d95926" stroke-width="2" stroke-dasharray/.test(svg), true);
  eq('Steam 那條後畫、疊在上面', svg.indexOf(ctx.HISTORY_COLORS.steam + '" stroke-width="2" stroke-linecap') > svg.indexOf('stroke-dasharray="6 4"'), true);
  eq('有 aria-label 摘要', /aria-label="Steam 賣價 −[\d.]+%、CSFloat 買價 −[\d.]+%/.test(svg), true);
  // 兩條線重疊時，線尾的兩個數值要分開（不能疊成一團）
  const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" font-size="11" fill="#94a3b8"/g)].map(m => +m[1]);
  eq('線尾兩個數值標籤', ys.length, 2);
  eq('兩條線重疊時標籤上下分開 ≥ 14px', Math.abs(ys[0] - ys[1]) >= 14 - 1e-6, true);
  eq('y 軸刻度含 0', ctx.historyScales(s, 640, 200).ticks.includes(0), true);
}

/* ── 7. case.html 的靜態檢查 ─────────────────────────────────── */
{
  const raw = fs.readFileSync(__dirname + '/../case.html', 'utf8');
  const html = raw.replace(/<!--[\s\S]*?-->/g, '');
  const scriptSrc = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

  eq('佔位文字拿掉了（「預計 9 月起提供」已經過期）', /資料累積中|預計 9 月/.test(markup), false);
  /* ⚠️ 倍率百分位刻意不做（4.29）：它會在最糟的時點說「現在算高」。
        這一條擋的是「之後有人照原規劃把它加回來」。 */
  eq('畫面上沒有「百分位」「算高／算低」', /百分位|算高|算低/.test(markup + scriptSrc), false);
  eq('歷史查詢只 select 中位數欄位',
    /from\('cases_ratio_history'\)\s*\.select\('snapshot_date,steam_price_median,csfloat_price_median'\)/.test(scriptSrc), true);
  eq('冷卻期天數讀 COOLDOWN_DAYS，不在頁面裡另寫一個 7', /COOLDOWN_DAYS/.test(scriptSrc), true);
  eq('「獨立段數」那一行還在（n 不是獨立樣本數，4.13）', /互不重疊/.test(scriptSrc) && /st\.windows/.test(scriptSrc), true);
  eq('資料透明頁有對應的錨點',
    /id="seven-day"/.test(fs.readFileSync(__dirname + '/../transparency.html', 'utf8')), true);
}

console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
process.exit(fail ? 1 : 0);
