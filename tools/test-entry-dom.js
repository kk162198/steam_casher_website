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

  /* ── ② 購物清單：上一份清單留下的紀錄 ─────────────────── */

  const COMBO = {
    savedAt: '2026-08-10T00:00:00.000Z',
    items: [
      { name: 'Kilowatt Case', qty: 20, unitCostTwd: 21, defIndex: 4001 },
      { name: 'Clutch Case', qty: 5, unitCostTwd: 40, defIndex: 4002 },
    ],
  };

  {
    const { window } = boot('checklist.html', ls => {
      ls.setItem('sah-combo-v1', JSON.stringify(COMBO));
      ls.setItem('sah-checklist-checked-v1', JSON.stringify({
        // 早於 savedAt → 上一份計畫留下的
        'Kilowatt Case': { lots: [{ at: '2026-08-01T00:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false },
        // 晚於 savedAt → 這次買的
        'Clutch Case': { lots: [{ at: '2026-08-11T00:00:00.000Z', qty: 5, paidTwd: 200 }], closed: false },
      }));
    });
    await tick();
    const { document, localStorage } = window;
    const rows = () => [...document.querySelectorAll('#cl-body tr')];

    eq('舊紀錄被標示出來', rows()[0].textContent.includes('早於這次試算'), true);
    eq('這次的紀錄不會被誤標', rows()[1].textContent.includes('早於這次試算'), false);
    eq('⚠️ 只標示、不自動刪：實付金額還在',
      JSON.parse(localStorage.getItem('sah-checklist-checked-v1'))['Kilowatt Case'].lots[0].paidTwd, 280);

    // 使用者自己按了「不是這次買的」
    rows()[0].querySelector('[data-forget]').dispatchEvent(new window.Event('click'));
    const after = JSON.parse(localStorage.getItem('sah-checklist-checked-v1'));
    eq('按了才清掉', Object.prototype.hasOwnProperty.call(after, 'Kilowatt Case'), false);
    eq('別人的紀錄沒被牽連', after['Clutch Case'].lots[0].paidTwd, 200);
  }

  // 清單來自網址參數時沒有 savedAt，不該亂標
  {
    const { window } = boot('checklist.html', ls => {
      ls.setItem('sah-checklist-checked-v1', JSON.stringify({
        'Kilowatt Case': { lots: [{ at: '2020-01-01T00:00:00.000Z', qty: 13, paidTwd: 280 }], closed: false },
      }));
    });
    window.history.replaceState({}, '', '?items=Kilowatt%20Case:20:21:4001');
    await tick();
    // 重跑一次頁面邏輯（網址是在 script 跑完之後才改的）
    const inline = [...window.document.querySelectorAll('script:not([src])')]
      .map(e => e.textContent).filter(t => t.includes('renderChecklistRow')).pop();
    window.eval(inline);
    eq('網址參數清單：沒有 savedAt 就不比對',
      window.document.querySelector('#cl-body tr').textContent.includes('早於這次試算'), false);
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

    // 直接叫樣板產一列，確認裡面沒有任何可操作的東西
    const html = window.renderComboRow(
      { name: 'Kilowatt Case', qty: 20, inventory: 99, volume: 5000, updatedAt: '2026-08-24T00:00:00.000Z' },
      { unitCostTwd: 21, subtotalTwd: 420, valueTwd: 500, sharePct: 40, qtyShare: 0.004 });
    eq('列裡沒有勾選框', /<input/i.test(html), false);
    eq('列裡沒有交易連結', /trade-link/.test(html), false);
    eq('出口在表之前：頁面上有兩顆產生購物清單',
      [...document.querySelectorAll('a[href="checklist.html"]')].length, 2);

    // 顯示用的資訊要留著
    eq('數量還在', html.includes('20 個'), true);
    eq('單價還在', html.includes('NT$ 21'), true);
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
  }

  console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
  process.exit(fail ? 1 : 0);
})();
