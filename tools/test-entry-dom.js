/* 入口動線的畫面實測（2026-08-24 新增）。
   涵蓋三件在這次改動裡最容易靜默壞掉、而且壞了沒人會發現的事：

     ① 首頁主按鈕到底指哪裡。指錯的後果是新來的人直接進試算頁——
        那正是這次要修掉的問題，而它只有在 localStorage 有／沒有特定內容時
        才看得出差別，手點很難全部走過。
     ② 購物清單的「上一份清單留下的」標示。試算頁已經不再刪勾選了，
        這個標示是唯一擋得住「舊的購買時間被當成這次冷卻期起點」的東西。
     ③ 試算頁的組合表真的是唯讀的。少刪一個勾選框，那一頁就又變回
        `sah-checklist-checked-v1` 的寫入端。

   node tools/test-entry-dom.js —— 全綠才 commit。 */
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

/* site.js 直接內嵌進 HTML，讓它跟頁面的 inline script 照原本的順序執行。
   ⚠️ 一定要跳脫 `</script>`——site.js 的註解裡有一個，不跳脫的話 script 會
      提早關掉，症狀是「site.js 的註解變成畫面上的文字」。 */
function inlineSite(html) {
  const site = fs.readFileSync(__dirname + '/../assets/site.js', 'utf8')
    .replace(/<\/script>/g, '<\\/script>');
  return html.replace('<script src="assets/site.js"></script>',
    '<script>' + site + '</script>');
}

// Supabase 的最小替身：查什麼都回空陣列。這幾支測試不碰價格計算。
function fakeSupabase() {
  return {
    createClient() {
      return { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
    }
  };
}

function boot(file, seed) {
  const html = inlineSite(fs.readFileSync(__dirname + '/../' + file, 'utf8'));
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/' + file,
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('no network in test'));
      w.supabase = fakeSupabase();
      if (seed) seed(w.localStorage);
    },
  });
}

const tick = () => new Promise(r => setTimeout(r, 0));

const PASS_ALL = { q1: 'yes', q2: 'yes', q3: 'no', q4: 'yes', amount: 3000 };

(async () => {
  /* ── ① 首頁入口 ───────────────────────────────────────── */

  // 沒答過：預設就該指資格快檢。這是新人會看到的畫面。
  {
    const { window } = boot('index.html');
    await tick();
    const p = window.document.getElementById('cta-primary');
    const s = window.document.getElementById('cta-secondary');
    eq('沒答過：主按鈕指資格快檢', p.getAttribute('href'), 'eligibility.html');
    eq('沒答過：仍留一條直接試算的路（不擋人）', s.getAttribute('href'), 'calculator.html');
    eq('沒答過：頁尾那顆也指資格快檢',
      window.document.getElementById('cta-foot-btn').getAttribute('href'), 'eligibility.html');
  }

  // 四題全過：不要再問一次
  {
    const { window } = boot('index.html', ls => ls.setItem('sah-eligibility-v2', JSON.stringify(PASS_ALL)));
    await tick();
    eq('已通過：主按鈕換成試算',
      window.document.getElementById('cta-primary').getAttribute('href'), 'calculator.html');
    eq('已通過：資格快檢退成次要',
      window.document.getElementById('cta-secondary').getAttribute('href'), 'eligibility.html');
    eq('已通過：頁尾那顆也換成試算',
      window.document.getElementById('cta-foot-btn').getAttribute('href'), 'calculator.html');
  }

  // 「不確定」不算通過——資格頁本來就會把它列進待釐清
  {
    const seed = Object.assign({}, PASS_ALL, { q3: 'unknown' });
    const { window } = boot('index.html', ls => ls.setItem('sah-eligibility-v2', JSON.stringify(seed)));
    await tick();
    eq('有不確定：主按鈕仍指資格快檢',
      window.document.getElementById('cta-primary').getAttribute('href'), 'eligibility.html');
    eq('有不確定：文案講明是回去補',
      window.document.getElementById('cta-primary').textContent.includes('還差什麼'), true);
  }

  // 被擋住的答案更不能放行
  {
    const seed = Object.assign({}, PASS_ALL, { q2: 'recent' });
    const { window } = boot('index.html', ls => ls.setItem('sah-eligibility-v2', JSON.stringify(seed)));
    await tick();
    eq('驗證器未滿 7 天：不放行到試算頁',
      window.document.getElementById('cta-primary').getAttribute('href'), 'eligibility.html');
  }

  // 只答了兩題：沒答完就是沒答完
  {
    const { window } = boot('index.html', ls => ls.setItem('sah-eligibility-v2', JSON.stringify({ q1: 'yes', q2: 'yes' })));
    await tick();
    const p = window.document.getElementById('cta-primary');
    eq('沒答完：主按鈕指資格快檢', p.getAttribute('href'), 'eligibility.html');
    eq('沒答完：不要說「還差什麼」（他根本還沒答完）', p.textContent.includes('還差什麼'), false);
  }

  // 初始設定做完的人，前三題本來就等於答過了
  {
    const { window } = boot('index.html', ls => ls.setItem('sah-setup-v1', JSON.stringify({
      steps: {}, doneAt: '2026-08-20T00:00:00.000Z', source: 'manual'
    })));
    await tick();
    eq('已完成初始設定：直接進試算，不再問資格',
      window.document.getElementById('cta-primary').getAttribute('href'), 'calculator.html');
  }

  /* ── ② 購物清單：多單（2026-08-31 取代「上一份清單留下的」標示）─────
     以前勾選紀錄是全站一張表，沒有「這批屬於哪一單」，所以只能用「每一批都
     早於這次試算」去**猜**哪些是舊的。猜錯的方向特別糟：第一單還在冷卻期、
     回來試算第二單，第一單整批會被標成「上一份留下的」——而那是使用者真的
     買過、正在等的東西。

     現在每一批記在自己的單底下，舊單根本不會出現在這一單的畫面上，
     也就沒有東西需要標示或猜測。下面幾條守的是那個取代確實成立。 */

  const ORDERS_V4 = {
    v: 4,
    orders: {
      o_old: { createdAt: '2026-08-01T00:00:00.000Z', closedAt: null,
        plan: [{ name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 }] },
      o_now: { createdAt: '2026-08-10T00:00:00.000Z', closedAt: null,
        plan: [{ name: 'Clutch Case', qty: 5, unitCostTwd: 40, defIndex: 4002 }] },
    },
  };
  const CHECKED_V4 = {
    v: 4,
    orders: {
      o_old: { 'Kilowatt Case': { lots: [{ at: '2026-08-01T02:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false } },
      o_now: { 'Clutch Case': { lots: [{ at: '2026-08-11T00:00:00.000Z', qty: 5, paidTwd: 200 }], closed: false } },
    },
  };

  {
    const { window } = boot('checklist.html', ls => {
      ls.setItem('sah-orders-v1', JSON.stringify(ORDERS_V4));
      ls.setItem('sah-checklist-checked-v1', JSON.stringify(CHECKED_V4));
    });
    await tick();
    const { document, localStorage } = window;
    const rows = () => [...document.querySelectorAll('#cl-body tr')];

    eq('預設顯示最新的那一單', rows().length, 1);
    eq('顯示的是新單的品項', rows()[0].textContent.includes('Clutch Case'), true);
    eq('舊單的品項不會混進來', rows()[0].textContent.includes('Kilowatt Case'), false);
    /* ⚠️ 這個標示應該從畫面上消失。它還在＝補丁沒被模型取代掉。
       （只看表格，不看 document.body——頁面自己的 <script> 註解也在 body 裡。） */
    eq('不再有「早於這次試算」這種猜測',
      document.getElementById('cl-body').textContent.includes('早於這次試算'), false);
    eq('舊單的實付金額原封不動',
      JSON.parse(localStorage.getItem('sah-checklist-checked-v1'))
        .orders.o_old['Kilowatt Case'].lots[0].paidTwd, 280);

    // 兩單並行 → 出現單選擇器，可以切回去看舊單
    const chips = () => [...document.querySelectorAll('#cl-orders [data-order]')];
    eq('兩單並行時出現單選擇器', chips().length, 2);
    eq('選擇器講出每一單買了幾批',
      chips().some(b => b.textContent.includes('1 批')), true);
    chips().find(b => b.dataset.order === 'o_old').dispatchEvent(new window.Event('click'));
    eq('切到舊單看得到舊單的品項', rows()[0].textContent.includes('Kilowatt Case'), true);
    eq('切到舊單看得到舊單填的數量',
      rows()[0].querySelector('[data-qty-for]').value, '13');

    /* 結案：不刪東西，只是移出「還要處理」。 */
    document.getElementById('cl-close-order').dispatchEvent(new window.Event('click'));
    const afterClose = JSON.parse(localStorage.getItem('sah-orders-v1'));
    eq('結案寫下時間', typeof afterClose.orders.o_old.closedAt, 'string');
    eq('結案不刪任何批次',
      JSON.parse(localStorage.getItem('sah-checklist-checked-v1'))
        .orders.o_old['Kilowatt Case'].lots.length, 1);
    eq('結案後選擇器只剩一單', chips().length, 0);
  }

  // 清單來自網址參數時不屬於任何一單，不給選擇器也不給結案
  {
    const { window } = boot('checklist.html', ls => {
      ls.setItem('sah-orders-v1', JSON.stringify(ORDERS_V4));
      ls.setItem('sah-checklist-checked-v1', JSON.stringify(CHECKED_V4));
    });
    window.history.replaceState({}, '', '?items=Kilowatt%20Case:20:21:4001');
    await tick();
    // 重跑一次頁面邏輯（網址是在 script 跑完之後才改的）
    const inline = [...window.document.querySelectorAll('script:not([src])')]
      .map(e => e.textContent).filter(t => t.includes('renderChecklistRow')).pop();
    window.eval(inline);
    eq('網址參數清單：顯示的是網址裡那一項',
      window.document.querySelector('#cl-body tr').textContent.includes('Kilowatt Case'), true);
    eq('網址參數清單：不給單選擇器', window.document.getElementById('cl-orders').hidden, true);
    eq('網址參數清單：不給結案鍵', window.document.getElementById('cl-close-order').hidden, true);
  }

  /* ── ③ 試算頁的組合表是唯讀的 ─────────────────────────── */
  {
    const { window } = boot('calculator.html');
    await tick();
    const { document } = window;
    const heads = [...document.querySelectorAll('#combo-body')][0]
      .closest('table').querySelectorAll('thead th');
    eq('組合表只剩 5 欄', heads.length, 5);
    eq('沒有「已買到」欄', [...heads].some(th => th.textContent.includes('已買到')), false);
    eq('沒有「前往 CSFloat」欄', [...heads].some(th => th.textContent.includes('前往')), false);
    eq('沒有進度列', document.getElementById('shopping-progress'), null);
    eq('沒有清除全部勾選', document.getElementById('shopping-reset-btn'), null);

    /* 三組篩選鈕的方向要一致：最左邊都是最寬鬆的那一個。
       只有一組反過來的話，使用者掃過去會以為自己選的是另一端。 */
    const firstOf = id => document.querySelector('#' + id + ' button').textContent.trim();
    eq('佔比上限最左是「不限」', firstOf('cap-group'), '不限');
    eq('保守緩衝最左是「不留緩衝」', firstOf('buffer-group'), '不留緩衝');
    eq('流動性篩選最左是「不限」', firstOf('liq-group'), '不限');
    eq('佔比上限由寬到嚴',
      [...document.querySelectorAll('#cap-group button')].map(b => b.dataset.cap),
      ['1', '0.3333', '0.2', '0.1']);
    // ⚠️ 反過來排只動 DOM 順序，預設值不變
    eq('預設仍是 20%',
      [...document.querySelectorAll('#cap-group button')]
        .find(b => b.getAttribute('aria-pressed') === 'true').dataset.cap, '0.2');

    // 直接叫樣板產一列，確認裡面沒有任何可操作的東西
    const html = window.renderComboRow(
      { name: 'Kilowatt Case', qty: 20, inventory: 99, volume: 5000, updatedAt: '2026-08-24T00:00:00.000Z' },
      { unitCostTwd: 21, subtotalTwd: 420, valueTwd: 500, sharePct: 40, qtyShare: 0.004 });
    eq('列裡沒有勾選框', /<input/i.test(html), false);
    eq('列裡沒有交易連結', /trade-link/.test(html), false);
    eq('出口在表之前：頁面上有兩顆產生購物清單',
      [...document.querySelectorAll('a[href="checklist.html"]')].length, 2);

    /* 兩個金額欄位：標籤與數字的字級差距不要拉太開，否則看起來像兩塊
       獨立的數字，而不是「這個欄位叫什麼、值是多少」。 */
    const calcCss = fs.readFileSync(__dirname + '/../calculator.html', 'utf8')
      .replace(/\s*\n\s*/g, '');
    eq('輸入數字是 24px（不是 32）', /\.result-input\s*\{[^}]*font-size:\s*24px/.test(calcCss), true);

    /* 買進側含國外交易費、賣出側不含。這兩行如果被「順手對齊」成同一個匯率，
       畫面上不會有任何症狀——只有使用者入完金才發現錢不夠。 */
    eq('成本用 buyRate()', /totalCostUsd \* buyRate\(usdToTwd\)/.test(calcCss), true);
    eq('單價用 buyRate()', /row\.costUsd \* buyRate\(usdToTwd\)/.test(calcCss), true);
    eq('賣出側維持中間價', /totalIncomeUsd \* usdToTwd;/.test(calcCss), true);
    eq('畫面上講明含 1.5% 國外交易費',
      document.querySelector('.calc-foot').textContent.includes('1.5% 國外交易費'), true);

    /* 更新按鈕：實測有人以為它是「把試算重置」。
       ⚠️ 按鈕文字要講它抓什麼，而且旁邊要明說不會動到輸入——
          光改名不夠，會怕的人需要被講明白才敢按。 */
    const reload = document.getElementById('reload-btn');
    eq('按鈕不再叫「重新載入」', /重新載入/.test(reload.textContent), false);
    eq('按鈕講明抓的是匯率與報價', reload.textContent.trim(), '更新匯率與報價');
    eq('旁邊明說不會清掉輸入',
      reload.closest('.calc-foot').textContent.includes('不會清掉你填的金額'), true);
    // 按下去之後填的值真的不能變
    const before = { t: document.getElementById('target-input').value,
                     b: document.getElementById('budget-input').value };
    reload.dispatchEvent(new window.Event('click'));
    await new Promise(r => setTimeout(r, 50));
    eq('按了之後目標金額沒被清掉', document.getElementById('target-input').value, before.t);
    eq('按了之後投入現金沒被清掉', document.getElementById('budget-input').value, before.b);
    eq('兩個欄位標籤都用 t-sub',
      [...document.querySelectorAll('label[for="target-input"], label[for="budget-input"]')]
        .every(l => l.classList.contains('t-sub')), true);

    // 顯示用的資訊要留著
    eq('數量還在', html.includes('20 個'), true);
    eq('單價還在', html.includes('NT$ 21'), true);
  }

  /* ── ③-b 指南頁 = 一次性設定 + 每一輪四步（2026-08-24 合併）───────
     setup.html 併進 help.html。要確認的是**狀態沒有跟著搬丟**：
     勾選寫的仍是 sah-setup-v1，勾完仍會讓 isSetupDone() 變 true，
     否則試算頁的門檻會永遠停在「第一次」。 */
  {
    const { window } = boot('help.html');
    await tick();
    const { document, localStorage } = window;

    const boxes = [...document.querySelectorAll('.su-box')];
    eq('一次性設定剩四項（入金搬走了）', boxes.map(b => b.dataset.step),
      ['authenticator', 'spend5', 'notrestricted', 'csfloat']);
    eq('每一輪變成五步（多了入金）',
      [...document.querySelectorAll('.step .t-sub')].length, 5);
    /* ⚠️ CSFloat 是錢包制、餘額每輪花光，入金**不是**一次性的事。
       擺回上半段等於告訴使用者做過就不用再做，而他第二輪回來錢包是空的。 */
    /* CSFloat 那三步（註冊／入金／下單）都要有一條過去的路，
       否則使用者得自己在瀏覽器打 csfloat.com。 */
    const csf = [...document.querySelectorAll('a.chk-link[href="https://csfloat.com/"]')];
    eq('CSFloat 的網址出現在註冊、入金、下單三步', csf.length, 3);
    eq('CSFloat 連結不帶任何參數（不放推薦碼）',
      csf.every(a => a.getAttribute('href') === 'https://csfloat.com/'), true);
    eq('CSFloat 連結不指深層路徑（SPA，路徑沒查證過）',
      [...document.querySelectorAll('a.chk-link')]
        .filter(a => /csfloat\.com\/./.test(a.getAttribute('href'))).length, 0);

    eq('入金在「每一輪都要做」那一段，不在上半段',
      [...document.querySelectorAll('.step .t-sub')].some(h => h.textContent.includes('入金')), true);
    eq('上半段沒有任何入金勾選框',
      boxes.some(b => b.dataset.step === 'funded'), false);
    eq('換裝置的補丁還在（否則桌機設定完、手機就沒路回來）',
      !!document.getElementById('su-manual'), true);

    // 四項全勾 → sah-setup-v1 應該蓋上 doneAt
    boxes.forEach(b => { b.checked = true; b.dispatchEvent(new window.Event('change')); });
    const st = JSON.parse(localStorage.getItem('sah-setup-v1') || '{}');
    eq('四項勾完會蓋 doneAt（試算頁的門檻靠它）', typeof st.doneAt === 'string', true);
    eq('來源標成逐項勾選', st.source, 'checklist');

    // 取消一項 → doneAt 要被清掉
    boxes[0].checked = false;
    boxes[0].dispatchEvent(new window.Event('change'));
    eq('取消任何一項就清掉 doneAt',
      JSON.parse(localStorage.getItem('sah-setup-v1')).doneAt, null);

    // 第三份資格清單必須不存在
    eq('舊的第三份資格清單已經拿掉',
      document.querySelectorAll('.eligibility-check').length, 0);
  }

  /* 過渡：舊資料勾了四項、只差已被移除的 funded，載入時要自動補上 doneAt。
     不補的話畫面說「四項都完成了」、結果區卻說「還有 0 項沒完成」，
     而且試算頁會一直用第一次的成本估算他。 */
  {
    const { window } = boot('help.html', ls => ls.setItem('sah-setup-v1', JSON.stringify({
      steps: {
        authenticator: '2026-08-01T00:00:00.000Z',
        spend5: '2026-08-01T00:00:00.000Z',
        notrestricted: '2026-08-01T00:00:00.000Z',
        csfloat: '2026-08-01T00:00:00.000Z'
        // funded 沒勾——舊版第 5 項，現在已經不算數
      },
      doneAt: null, source: null
    })));
    await tick();
    const st = JSON.parse(window.localStorage.getItem('sah-setup-v1'));
    eq('舊資料四項齊全 → 自動補上 doneAt', typeof st.doneAt === 'string', true);
    eq('結果區顯示已完成',
      window.document.getElementById('su-result').textContent.includes('設定完成'), true);
  }

  /* setup.html 只剩轉址殼：舊網址不能 404，也不能被索引。 */
  {
    const html = fs.readFileSync(__dirname + '/../setup.html', 'utf8');
    eq('舊網址還在（不會 404）', html.length > 0, true);
    eq('meta refresh 指向指南頁', /http-equiv="refresh"[^>]*help\.html/.test(html), true);
    eq('JS 用 replace 不是 href（不要讓上一頁彈回來）',
      html.includes("location.replace('help.html'"), true);
    eq('canonical 指向指南頁', /canonical"[^>]*help\.html/.test(html), true);
    eq('標了 noindex', /name="robots"[^>]*noindex/.test(html), true);
  }

  /* ── ③-c 資格快檢只剩四題 ─────────────────────────────── */
  {
    const { window } = boot('eligibility.html');
    await tick();
    const { document } = window;
    eq('四題', document.querySelectorAll('.q-card').length, 4);
    eq('進度條四段', document.querySelectorAll('.prog-seg').length, 4);
    eq('沒有金額輸入（能省多少交給試算頁）',
      document.getElementById('elig-amount'), null);
    eq('沒有金額快捷鍵', document.querySelectorAll('.opt[data-amount]').length, 0);

    // 四題全過 → 結果卡不該出現任何金額
    [['q1', 'yes'], ['q2', 'yes'], ['q3', 'no'], ['q4', 'yes']].forEach(([q, v]) => {
      document.querySelector(`.opt[data-q="${q}"][data-val="${v}"]`)
        .dispatchEvent(new window.Event('click'));
    });
    const result = document.getElementById('elig-result').textContent;
    eq('結果講的是資格，不是省多少', result.includes('可以用這個方式加值'), true);
    eq('結果沒有出現預估省下的金額', /省下約 NT\$/.test(result), false);
  }

  /* ── ③-d 保守緩衝的說明搬到資料透明頁（2026-08-24）───────
     ⚠️ 樣本說明（n=51、作者一人、不是市場統計）**不可以跟著搬走**：
        DECISIONS.md 4.7 要求這個限制寫在「使用者正在用這個數字」的地方，
        也就是試算頁的檔位按鈕旁邊。 */
  {
    const calc = fs.readFileSync(__dirname + '/../calculator.html', 'utf8');
    const tr = fs.readFileSync(__dirname + '/../transparency.html', 'utf8');
    /* ⚠️ 比對前先把 HTML 註解拿掉。這一頁的註解裡就寫著「原本是那張卡片」，
       不剝掉的話這條檢查永遠是紅的，而且紅的原因跟畫面無關。 */
    const calcVisible = calc.replace(/<!--[\s\S]*?-->/g, '');

    eq('試算頁不再有那張檔位說明卡', calcVisible.includes('上面的數字會變，請自己留緩衝'), false);
    eq('檔位表也不在試算頁了', calcVisible.includes('目標要多抓'), false);
    eq('檔位表搬到資料透明頁', tr.includes('保守緩衝：那三個數字怎麼來的'), true);
    eq('資料透明頁有 #buffer 錨點', /<section[^>]*id="buffer"/.test(tr), true);
    eq('試算頁連得過去', calc.includes('transparency.html#buffer'), true);

    // 搬走的三塊確實都在新家
    eq('「多買不是萬靈丹」還在', tr.includes('多買不是萬靈丹'), true);
    eq('÷(1−落差) 的算式還在', tr.includes('1 ÷ 0.840 = 1.191'), true);
    eq('樣本說明也在新家', tr.includes('本站作者自己的交易紀錄'), true);

    // ⚠️ 但試算頁自己也一定要留一份
    eq('試算頁仍寫明 51 筆來自作者本人', calc.includes('51 筆交易'), true);
    eq('試算頁仍寫明不是市場統計', calc.includes('不是市場統計'), true);

    // 錨點不能被黏住的導覽列蓋住
    const css = fs.readFileSync(__dirname + '/../assets/style.css', 'utf8');
    eq('錨點有讓開導覽列', /:target\{scroll-margin-top:\d+px\}/.test(css.replace(/\s*\n\s*/g, '')), true);
  }

  /* ── ④ 官網連結的靜態檢查 ─────────────────────────────
     這幾條靠人工看很容易漏，而漏掉的後果都很具體：
       · 帶語言前綴 → 使用者習慣看英文卻被強制換成繁中（2026-08-24 決定拿掉）
       · 少了 rel="noopener" → 新分頁可以透過 window.opener 反向操作本站頁面
       · 網址帶了追蹤／推薦參數 → 正面踩到「不從交易平台收分潤」那條 */
  {
    const pages = ['index.html', 'eligibility.html', 'setup.html', 'help.html',
      'checklist.html', 'calculator.html', 'faq.html', 'risks.html', 'sell.html'];
    const src = pages.map(p => {
      try { return fs.readFileSync(__dirname + '/../' + p, 'utf8'); }
      catch (e) { return ''; }
    }).join('\n');

    const locale = src.match(/(?:help|store)\.steampowered\.com\/(?:zh-TW|en|zh-CN)\//g) || [];
    eq('Steam 連結不帶語言前綴（讓 Steam 照使用者設定顯示）', locale, []);

    // 每一顆 .chk-link 都要另開分頁且切斷 window.opener
    const anchors = src.match(/<a class="chk-link"[^>]*>/g) || [];
    eq('官網連結不只一顆（有真的加上去）', anchors.length > 10, true);
    eq('每顆官網連結都 target="_blank"',
      anchors.filter(a => !a.includes('target="_blank"')), []);
    eq('每顆官網連結都 rel="noopener noreferrer"',
      anchors.filter(a => !a.includes('rel="noopener noreferrer"')), []);

    // 外站網址不可以帶追蹤或推薦參數
    const hrefs = anchors.map(a => (a.match(/href="([^"]+)"/) || [])[1]).filter(Boolean);
    eq('官網連結不帶推薦碼／追蹤參數',
      hrefs.filter(h => /[?&](ref|utm_|aff|affiliate|partner)/i.test(h)), []);
    eq('官網連結都是 https',
      hrefs.filter(h => !h.startsWith('https://')), []);

    // 樣式必須在共用檔裡，不要各頁再寫一份
    const css = fs.readFileSync(__dirname + '/../assets/style.css', 'utf8');
    eq('.chk-link 定義在共用 style.css', css.includes('.chk-link'), true);
    eq('觸控尺寸 44px 沒有被縮掉', /\.chk-link\{[^}]*min-height:44px/.test(css.replace(/\s*\n\s*/g, '')), true);

    /* 合併之後不可以再有指向 setup.html 的站內連結（轉址頁本身除外）。
       留著的話使用者會多吃一次跳轉，而且看起來像兩個不同的地方。 */
    const inbound = pages
      .filter(p => p !== 'setup.html')
      .map(p => {
        try { return [p, fs.readFileSync(__dirname + '/../' + p, 'utf8')]; }
        catch (e) { return [p, '']; }
      })
      .concat([['nav.html', fs.readFileSync(__dirname + '/../nav.html', 'utf8')],
               ['footer.html', fs.readFileSync(__dirname + '/../footer.html', 'utf8')]])
      .filter(([, body]) => /href="setup\.html"/.test(body))
      .map(([p]) => p);
    eq('站內已經沒有連到 setup.html 的連結', inbound, []);
  }

  console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
