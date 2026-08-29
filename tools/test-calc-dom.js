/* 試算頁的畫面實測（2026-08-24 新增，DECISIONS 4.17）。

   為什麼需要這一支：台幣實拿改動的血管全都在 calculator.html 裡，
   而它是全站唯一「拿數字去決定要買什麼」的頁面。改錯的後果不是版面歪掉，
   是**推薦錯的品項**——而且錯的方向與推薦順序同向（低價品項倍率被灌水，
   演算法永遠先挑倍率最高的），所以錯誤會被放大而不是被平均掉。

   ⚠️ 這裡刻意用「同一組品項、只差有沒有 steam_income_twd」跑兩次，
      比的是兩條路徑的**差異**，不是絕對值。絕對值會隨匯率與價格變，
      差異才是這次改動要保證的東西。

   node tools/test-calc-dom.js —— 全綠才 commit。 */
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

const RATE = 32.5;

/* 兩個品項，刻意設計成「美元看起來一樣好、台幣分得出高下」：

   便宜箱  成本 US$0.22（NT$7.15）  美元實拿 US$0.23  台幣實拿 NT$6
       → 美元倍率 1.05、台幣倍率 0.84。
       **美元路徑說「賺 4.5%」，台幣路徑說「虧 16%」——結論完全相反。**
   貴箱    成本 US$3.00（NT$97.5）  美元實拿 US$3.30  台幣實拿 NT$107
       → 兩條路徑都約 1.10，因為 NT$1 的下限對這個價位幾乎不咬。

   ⚠️ 便宜箱的數字取自 DECISIONS 4.17 的 US$0.22 那一格——
      那正是「實拿被高估 27.3%」的位置。 */
function rows(withTwd) {
  const mk = (name, id, costUsd, incomeUsd, priceTwd, incomeTwd, vol) => {
    const r = {
      name: name, CSFloat_ID: id,
      csfloat_cost: costUsd, csfloat_inventory: 500,
      steam_price: incomeUsd * 1.15, steam_income: incomeUsd,
      ratio: incomeUsd / costUsd, diff: incomeUsd - costUsd,
      steam_volume: vol, csfloat_updated_at: new Date().toISOString(),
    };
    if (withTwd) { r.steam_price_twd = priceTwd; r.steam_income_twd = incomeTwd; }
    return r;
  };
  return [
    mk('Cheap Case', 4001, 0.22, 0.23, 8, 6, 50000),
    mk('Pricey Case', 4002, 3.00, 3.30, 124, 107, 50000),
  ];
}

/* fail：模擬兩種讀取失敗。
     'throw' → 請求本身丟例外（斷網、DNS、CORS、Supabase 不通）
     'error' → Supabase 回 { error }（查詢送到了但被拒絕）
   ⚠️ 兩條路都要測。2026-08-29 的 bug 就是只接了後者，前者讓整頁靜靜停在
      「資料載入中...」——而那正是使用者看得到的那一種。 */
async function boot(data, fail) {
  const html = fs.readFileSync(__dirname + '/../calculator.html', 'utf8')
    .replace(/<body[^>]*>/, '<body>')
    .replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/g, '')
    /* ⚠️ site.js 的註解裡有 </script> 字樣，直接內嵌會把 script 提早關掉。跳脫。 */
    .replace('<script src="assets/site.js"></script>', () =>
      '<script>' + fs.readFileSync(__dirname + '/../assets/site.js', 'utf8')
        .replace(/<\/script/gi, '<\\/script') + '</script>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/calculator.html',
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ rates: { TWD: RATE } }) });
      // Supabase client 的最小替身：只支援本頁用到的那條鏈
      const res = fail === 'throw'
        ? Promise.reject(new Error('network down'))
        : (fail === 'error'
            ? Promise.resolve({ data: null, error: { message: 'boom' } })
            : Promise.resolve({ data: data, error: null }));
      w.supabase = {
        createClient: () => ({
          from: () => ({ select: () => ({ order: () => res }) }),
        }),
      };
    },
  });
  await new Promise(r => setTimeout(r, 120));
  return dom;
}

(async () => {
  const twd = await boot(rows(true));
  const usd = await boot(rows(false));

  const pick = dom => {
    const w = dom.window;
    const pool = w.usableCases();
    return {
      names: pool.map(c => c.name),
      ratios: pool.map(c => Math.round(c.ratio * 1e4) / 1e4),
      cheap: pool.find(c => c.name === 'Cheap Case') || null,
    };
  };

  const pT = pick(twd), pU = pick(usd);

  /* ── 1. 兩條路徑都跑得起來、沒有 NaN ─────────────────────── */
  eq('台幣路徑的倍率都是有限數', pT.ratios.every(r => isFinite(r)), true);
  eq('退回路徑的倍率都是有限數', pU.ratios.every(r => isFinite(r)), true);

  /* ── 2. 這次改動的核心：便宜箱被踢出候選池 ────────────────
     ⚠️ 這一條是整支測試的重點。US$0.22 的箱子在美元路徑上倍率 1.05
        （看起來會賺 4.5%），台幣路徑上是 0.84——**賣掉其實虧 16%**。
        兩條路徑給的不是「準一點」的差別，是**相反的結論**。
        它不該進候選池，更不該被演算法優先挑走。 */
  eq('美元路徑：便宜箱還在池子裡', pU.names.includes('Cheap Case'), true);
  eq('台幣路徑：便宜箱被踢掉了', pT.names.includes('Cheap Case'), false);
  eq('台幣路徑只剩貴箱', pT.names, ['Pricey Case']);

  /* ── 3. 貴箱兩條路徑幾乎一樣（下限只咬低價的）────────────── */
  const rT = pT.ratios[pT.names.indexOf('Pricey Case')];
  const rU = pU.ratios[pU.names.indexOf('Pricey Case')];
  eq('貴箱兩條路徑差 < 2%', Math.abs(rT / rU - 1) < 0.02, true);

  /* ── 4. 便宜箱的高估幅度確實在 20% 以上 ─────────────────── */
  eq('退回路徑把便宜箱的倍率灌水 > 15%',
    (pU.cheap.ratio / (6 / RATE / 0.22) - 1) > 0.15, true);

  /* ── 5. 池子一定是由倍率高到低排好的 ────────────────────
     ⚠️ 組合演算法是「由倍率最高往下取」，它**假設**輸入已經排好。
        台幣換算會改變高低順序，所以排序不能沿用資料庫的。 */
  const many = await boot([].concat(rows(true), [{
    name: 'Mid Case', CSFloat_ID: 4003, csfloat_cost: 1.0, csfloat_inventory: 500,
    steam_price: 1.5, steam_income: 1.3, ratio: 1.3, diff: 0.3,
    steam_price_twd: 49, steam_income_twd: 42,
    steam_volume: 50000, csfloat_updated_at: new Date().toISOString(),
  }]));
  const mp = many.window.usableCases();
  eq('池子由倍率高到低',
    mp.every((c, i) => i === 0 || mp[i - 1].ratio >= c.ratio), true);
  eq('倍率 ≤ 1 的一律不進池子', mp.every(c => c.ratio > 1), true);

  /* ── 6. 畫面上不能出現 NaN / undefined ────────────────── */
  const doc = twd.window.document;
  const target = doc.getElementById('target-input');
  if (target) {
    target.value = '1000';
    target.dispatchEvent(new twd.window.Event('input'));
    await new Promise(r => setTimeout(r, 60));
  }
  /* ⚠️ 不能直接用 body.textContent：這支測試把 site.js **內嵌**進頁面，
     於是它的原始碼（裡面本來就有 isNaN、undefined、Infinity）也算進 textContent。
     只掃真的會被看到的文字。 */
  const clone = doc.body.cloneNode(true);
  clone.querySelectorAll('script, style, template').forEach(el => el.remove());
  const visible = clone.textContent;
  eq('畫面上沒有 NaN', /NaN/.test(visible), false);
  eq('畫面上沒有 undefined', /undefined/.test(visible), false);
  eq('畫面上沒有 Infinity', /Infinity/.test(visible), false);

  /* ── 7. 讀不到資料的時候，畫面要說話、按鈕要能再按 ──────────
     ⚠️ 這一段是 2026-08-29 那個 bug 的回歸測試。症狀是「試算頁當掉」，
        但程式沒有丟出任何東西給使用者看——組合表停在「資料載入中...」，
        重試按鈕還是 disabled。**靜默的失敗比錯的數字更糟**，因為錯的
        數字至少看得出來不對，而這個看起來就只是「網站壞了」。
     ⚠️ 兩條失敗路徑都要測，而且要斷言的是**畫面**不是 console。 */
  for (const mode of ['throw', 'error']) {
    const bad = await boot([], mode);
    const w = bad.window;
    const body = w.document.getElementById('combo-body');
    eq(mode + '：組合表不會停在「資料載入中」', /資料載入中/.test(body.textContent), false);
    eq(mode + '：畫面講出「讀不到」', /讀不到目前的價格資料/.test(body.textContent), true);
    eq(mode + '：沒有誣賴使用者篩選設錯', /放寬篩選/.test(body.textContent), false);

    const btn = w.document.getElementById('reload-btn');
    eq(mode + '：重試按鈕可以按', !btn.disabled, true);
    btn.dispatchEvent(new w.Event('click'));
    await new Promise(r => setTimeout(r, 120));
    eq(mode + '：重試失敗後按鈕沒被鎖死', !btn.disabled, true);
    eq(mode + '：重試失敗後按鈕文字回得來', btn.innerText || btn.textContent, '更新匯率與報價');
  }

  console.log(fail ? '\n' + fail + ' 個失敗' : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
