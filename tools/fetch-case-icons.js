/* tools/fetch-case-icons.js — 產生 site.js 第⑰節的 CASE_ICONS 對照表。
   零相依（Node 18+ 的內建 fetch），但**需要網路**。

     node tools/fetch-case-icons.js           印出整段 CASE_ICONS，貼回 site.js 換掉舊的
     node tools/fetch-case-icons.js --check   只比對，缺哪幾個品項會列出來（缺就 exit 1）

   在做什麼：
     ① 從 Supabase 撈 cases_data 的品項名（＝ market_hash_name）
     ② 一個一個問 Steam 市場的搜尋端點，取回它的 icon_url
     ③ 印成 site.js 吃得下的形狀

   ⚠️ **圖片本身永遠不要下載。** 這支腳本抓的是「網址裡的那串雜湊」，不是圖檔。
      把圖存進 repo 會把本站的位置從「引用一個網址」變成「重製並散布 Valve 的美術資產」
      ——完全不同的位置。理由寫在 site.js 第⑰節，配套是頁尾那兩行免責。

   ⚠️ **UA 偽裝成 Firefox 是刻意的**，跟 steam/upsert_steam_cases_overview.py 同一個理由
      （DECISIONS 4.2：誠實 UA 第一個請求就 429，那是身分判斷不是流量判斷）。
      ⚠️ 這條路站不住腳而我們知道——**不要把它寫進對外文件**。

   ⚠️ 每個品項之間停 900ms。這支一年大概跑不到三次，沒有必要跑快。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DELAY_MS = 900;
const UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* anon key 不另外抄一份：它已經內嵌在每個 HTML 裡，從那裡讀就不會有兩份會不一致。 */
function readSupabaseConfig() {
  const html = fs.readFileSync(path.join(ROOT, 'marketlist.html'), 'utf8');
  const url = /const\s+supabaseUrl\s*=\s*'([^']+)'/.exec(html);
  const key = /const\s+supabaseKey\s*=\s*'([^']+)'/.exec(html);
  if (!url || !key) throw new Error('marketlist.html 裡找不到 supabaseUrl / supabaseKey，寫法可能改了');
  return { url: url[1], key: key[1] };
}

async function fetchNames() {
  const { url, key } = readSupabaseConfig();
  const r = await fetch(url + '/rest/v1/cases_data?select=name&order=name.asc',
    { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return (await r.json()).map(x => x.name).filter(Boolean);
}

/* Steam 市場搜尋。查詢字串加引號是為了收斂結果，但**仍然要比對 hash_name 完全相等**
   ——搜尋是模糊的，拿第一筆會在「Chroma Case / Chroma 2 Case」這種組合上拿錯。 */
async function fetchIcon(name) {
  const u = 'https://steamcommunity.com/market/search/render/'
          + '?query=' + encodeURIComponent('"' + name + '"')
          + '&start=0&count=20&appid=730&norender=1';
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) return { error: 'HTTP ' + r.status };
  const d = await r.json();
  const hit = (d.results || []).find(x => x.hash_name === name);
  if (!hit) return { error: '搜尋不到完全相符的品項（回了 ' + (d.results || []).length + ' 筆）' };
  const icon = hit.asset_description && hit.asset_description.icon_url;
  if (!icon) return { error: '這一筆沒有 icon_url' };
  return { icon };
}

function currentKeys() {
  const js = fs.readFileSync(path.join(ROOT, 'assets/site.js'), 'utf8');
  const block = /var\s+CASE_ICONS\s*=\s*\{([\s\S]*?)\n\};/.exec(js);
  if (!block) throw new Error('site.js 裡找不到 CASE_ICONS，第⑰節可能被改過');
  return (block[1].match(/^\s*'((?:[^'\\]|\\.)*)'\s*:/gm) || [])
    .map(m => /'((?:[^'\\]|\\.)*)'/.exec(m)[1].replace(/\\'/g, "'"));
}

async function main() {
  const check = process.argv.includes('--check');
  const names = await fetchNames();
  console.error('資料庫有 ' + names.length + ' 個品項');

  if (check) {
    const have = new Set(currentKeys());
    const missing = names.filter(n => !have.has(n));
    const extra = [...have].filter(n => !names.includes(n));
    if (missing.length) console.error('\n❗對照表缺這幾個（會沒有圖）：\n  ' + missing.join('\n  '));
    if (extra.length) console.error('\n⚠️ 對照表有、資料庫沒有（下架了？留著不影響畫面）：\n  ' + extra.join('\n  '));
    if (!missing.length && !extra.length) console.error('\n✓ 對照表與資料庫一致');
    process.exit(missing.length ? 1 : 0);
  }

  const icons = {};
  const failed = [];
  for (const name of names) {
    const r = await fetchIcon(name);
    if (r.error) { failed.push([name, r.error]); console.error('✗ ' + name + ' — ' + r.error); }
    else { icons[name] = r.icon; console.error('✓ ' + name); }
    await sleep(DELAY_MS);
  }

  /* ⚠️ 有任何一個抓不到就不要印半套出來——貼回去會靜靜地少掉幾個品項的圖。
     要嘛全部拿到，要嘛修好再跑一次。 */
  if (failed.length) {
    console.error('\n' + failed.length + ' 個沒抓到，先處理完再跑一次（沒有印出任何東西）');
    process.exit(1);
  }

  const lines = Object.keys(icons).map(n =>
    "  '" + n.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "': '" + icons[n] + "'");
  const today = new Date().toISOString().slice(0, 10);
  console.log('/* name（＝ cases_data.name ＝ market_hash_name）→ Steam icon_url 雜湊。');
  console.log('   ' + today + ' 由 tools/fetch-case-icons.js 產生，涵蓋當時資料庫裡全部 '
              + lines.length + ' 個品項。 */');
  console.log('var CASE_ICONS = {');
  console.log(lines.join(',\n'));
  console.log('};');
  console.error('\n✓ ' + lines.length + ' 個品項。把上面那段貼回 site.js 第⑰節換掉舊的，'
                + '然後跑 node tools/bump-site-version.js');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
