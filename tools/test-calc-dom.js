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
  eq('台幣路徑：便宜箱被踢掉了', pT.names.includes('Cheap Case'), false);
  eq('台幣路徑只剩貴箱', pT.names, ['Pricey Case']);

  /* ⚠️⚠️ 2026-09-04 補：**退回路徑也要踢掉它**（site.js ⑮-b）。
     舊版只在「有台幣報價」時擋，沒有台幣報價時照樣放進池子、另外顯示一行黃字。
     但誤差與推薦順序同向，警語響的當下畫面上佔比最高的正好是錯得最厲害的那顆
     ——線上實測一顆 NT$1.93 的品項拿走 20% 金額與 267 件中的 236 件。
     **警語不是防線。** */
  eq('退回路徑：便宜箱也被踢掉了', pU.names.includes('Cheap Case'), false);
  eq('退回路徑：貴箱留著（US$0.50 以上誤差 ≤1.2%，不該連坐）',
    pU.names.includes('Pricey Case'), true);
  eq('退回路徑的門檻對得上費率規則',
    usd.window.TWD_FALLBACK_SAFE_GROSS_USD, 0.50);

  /* ── 3. 貴箱兩條路徑幾乎一樣（下限只咬低價的）────────────── */
  const rT = pT.ratios[pT.names.indexOf('Pricey Case')];
  const rU = pU.ratios[pU.names.indexOf('Pricey Case')];
  eq('貴箱兩條路徑差 < 2%', Math.abs(rT / rU - 1) < 0.02, true);

  /* ── 4. 便宜箱的高估幅度確實在 20% 以上 ───────────────────
     ⚠️ 這一條**不能再從候選池裡讀**——便宜箱現在兩條路徑都被踢掉了，
        池子裡本來就沒有它。改成直接驗算固定資料本身，這樣它證明的是
        「當初為什麼挑這組數字當 fixture」，比從池子裡撈回來更貼題。 */
  const inflated = (0.23 / 0.22);          // 退回路徑會算出來的倍率
  const truth    = (6 / RATE / 0.22);      // 台幣規則下的真實倍率
  eq('退回路徑把便宜箱的倍率灌水 > 15%', (inflated / truth - 1) > 0.15, true);
  eq('而且方向是「看起來賺、其實虧」', inflated > 1 && truth < 1, true);

  /* ── 4b. 黃字警語要說對它擋掉了幾個、近似了幾個（2026-09-04）──
     ⚠️ 兩個數字要分開：dropped 使用者不必做任何事，approx 他可以自己決定
        要不要等下一輪。合成一個數字會讓前者聽起來像個待處理的問題。 */
  eq('退回路徑：一個被擋掉、一個仍可近似',
    usd.window.twdFallbackCount(), { dropped: 1, approx: 1 });
  eq('台幣路徑：沒有東西需要退回',
    twd.window.twdFallbackCount(), { dropped: 0, approx: 0 });

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

  /* ── 5b. 件數上限：把「最多幾件」翻譯成「每件至少值多少」（2026-09-04）
     ⚠️ 這一組不變式守的是**實作方式**，不只是結果。件數上限有兩種寫法：
        (a) 在 buildCombo 裡硬切件數 —— 演算法照樣先挑最便宜的，把件數預算
            花在最不值錢的東西上，然後回報「湊不到目標」。
        (b) 翻譯成「每件至少到手 = 目標 ÷ 上限」再去篩池子 —— 上限是**構造上**
            成立的，不是事後檢查。
        測「總件數 ≤ 上限」兩種寫法都會過，所以下面同時測「小箱被篩掉了」，
        那一條只有 (b) 會過。 */
  const qtyRows = [
    { name: 'Small Case', CSFloat_ID: 5001, csfloat_cost: 0.60, csfloat_inventory: 999,
      steam_price: 0.81, steam_income: 0.70, ratio: 1.167, diff: 0.10,
      steam_price_twd: 26, steam_income_twd: 22,
      steam_volume: 50000, csfloat_updated_at: new Date().toISOString() },
    { name: 'Big Case', CSFloat_ID: 5002, csfloat_cost: 3.60, csfloat_inventory: 999,
      steam_price: 4.60, steam_income: 4.00, ratio: 1.111, diff: 0.40,
      steam_price_twd: 150, steam_income_twd: 130,
      steam_volume: 50000, csfloat_updated_at: new Date().toISOString() },
  ];
  const q = await boot(qtyRows);
  const qw = q.window, qd = q.window.document;
  const setTarget = async v => {
    const t = qd.getElementById('target-input');
    t.value = String(v); t.dispatchEvent(new qw.Event('input'));
    await new Promise(r => setTimeout(r, 60));
  };
  const clickQty = async id => {
    qd.querySelector(`#qty-group button[data-qty="${id}"]`).click();
    await new Promise(r => setTimeout(r, 60));
  };
  const plannedUsd = () => qw.plannedTargetTwd(Number(qd.getElementById('target-input').value) || 0) / RATE;

  await setTarget(3000);
  await clickQty('all');
  const poolAll = qw.usableCases(plannedUsd());
  eq('不限：小箱大箱都在池子裡', poolAll.map(c => c.name).sort(), ['Big Case', 'Small Case']);
  eq('不限：小箱倍率高，排在前面', poolAll[0].name, 'Small Case');

  await clickQty('25');
  const pool25 = qw.usableCases(plannedUsd());
  /* 目標 3,000 ÷ 25 = 每件至少到手 NT$120。小箱 NT$22 不合格、大箱 NT$130 合格。
     ⚠️ 小箱倍率**比較高**卻被篩掉——這正是這個功能在做的取捨。 */
  eq('25 件上限：只留下單件夠貴的（小箱倍率較高也照樣篩掉）',
    pool25.map(c => c.name), ['Big Case']);

  const combo25 = qw.buildCombo(plannedUsd(), pool25, 1);
  const total25 = combo25.combo.reduce((n, i) => n + i.qty, 0);
  eq('25 件上限：總件數真的 ≤ 25', total25 <= 25, true);
  eq('25 件上限：而且還湊得到目標', combo25.reached, true);

  const comboAll = qw.buildCombo(plannedUsd(), poolAll, 1);
  const totalAll = comboAll.combo.reduce((n, i) => n + i.qty, 0);
  eq('不限的件數明顯比較多（這才是這個功能存在的理由）', totalAll > total25 * 2, true);

  /* 門檻高到沒有品項合格時，要講「放寬件數上限」，不是「放寬篩選」——
     篩選沒有擋任何東西，叫他去放寬篩選是指錯路。 */
  await setTarget(10000);
  await clickQty('25');
  eq('門檻過高時池子是空的', qw.usableCases(plannedUsd()).length, 0);
  eq('而且知道是件數上限造成的', qw.emptiedByQtyCap(plannedUsd()), true);
  const emptyText = qd.getElementById('combo-body').textContent;
  eq('畫面講的是件數上限', /件數上限/.test(emptyText), true);
  eq('畫面沒有誣賴流動性篩選', /放寬篩選/.test(emptyText), false);

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
