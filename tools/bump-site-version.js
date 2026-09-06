/* 把 SITE_JS_VERSION 與所有 HTML 的 ?v= 一起換掉
 *
 *     node tools/bump-site-version.js          # 真的改
 *     node tools/bump-site-version.js --dry    # 只印出會改什麼
 *
 * 為什麼要有這支（2026-09-06）：
 *   第⓪節的規矩是「改了 site.js 就把 SITE_JS_VERSION 與每個 HTML 的 ?v= 一起改」，
 *   而那是 17 個檔案的手動編輯。摩擦大到會讓人想幫規矩加例外
 *   （「只改註解應該不用吧」），但那個例外的失敗成本很不對稱：
 *
 *     該 bump 沒 bump   → 2026-09-04 真的發生過：新 HTML 配到舊 site.js，
 *                         整頁報「資料讀取失敗」，十分鐘後自己好。難重現、難診斷。
 *     不用 bump 卻 bump → 訪客多下載一次 site.js。完全無感。
 *
 *   ⚠️ 所以規矩維持「**動到 site.js 就 bump**」，沒有「純註解不用動」的例外。
 *      要解的是摩擦，不是規矩——這支腳本就是那個解法。
 *
 * ⚠️ 這支只換版本號，不會幫你判斷該不該換。判斷永遠是同一句：你動了 site.js 嗎。
 * ⚠️ 換完請跑 test-holdings.js，它的靜態檢查才是真正的守門員
 *    （對不上 SITE_JS_VERSION、或哪個 HTML 沒帶 ?v=，兩種都會紅）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_JS = path.join(ROOT, 'assets/site.js');
const DRY = process.argv.includes('--dry');

/* 規矩：值用日期；同一天改第二次就加字母（2026-09-05b、-c…）。
   ⚠️ 只認今天的日期。昨天的版本號今天要 bump，直接變成今天，不接字母。 */
function nextVersion(current) {
  const d = new Date();
  const today =
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  if (!current.startsWith(today)) return today;
  const suffix = current.slice(today.length);        // '' | 'b' | 'c' | …
  if (suffix === '') return today + 'b';
  if (!/^[b-y]$/.test(suffix)) {
    throw new Error('看不懂的版本號後綴：' + JSON.stringify(current) + '，請手動處理');
  }
  return today + String.fromCharCode(suffix.charCodeAt(0) + 1);
}

const js = fs.readFileSync(SITE_JS, 'utf8');
const m = js.match(/var SITE_JS_VERSION = '([^']+)';/);
if (!m) throw new Error('site.js 裡找不到 SITE_JS_VERSION，格式改了嗎？');

const from = m[1];
const to = nextVersion(from);

/* ⚠️ 只掃 website/ 根目錄的 *.html。nav.html / footer.html 是 fetch 進來的片段、
      setup.html 是轉址殼，它們本來就沒有 site.js 的 <script>，不會被算進去。
      這裡刻意不維護排除清單——有沒有引用由檔案自己說了算。 */
const htmls = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const touched = [];
for (const f of htmls) {
  const p = path.join(ROOT, f);
  const t = fs.readFileSync(p, 'utf8');
  const needle = 'site.js?v=' + from;
  if (!t.includes(needle)) continue;
  touched.push(f);
  if (!DRY) fs.writeFileSync(p, t.split(needle).join('site.js?v=' + to));
}

/* 防呆：正規式壞掉、或版本號早就對不上時，會掃到 0 個卻看起來「成功」。
   test-holdings.js 用的門檻是 12，這裡沿用同一個數字。 */
if (touched.length < 12) {
  console.error('\n⚠️ 只掃到 ' + touched.length + ' 個 HTML 引用 site.js?v=' + from + '（預期 ≥ 12）。');
  console.error('   多半是有檔案的版本號早就對不上了。先跑 test-holdings.js 看是哪一個，不要硬改。');
  process.exit(1);
}

if (!DRY) {
  fs.writeFileSync(SITE_JS, js.replace(m[0], "var SITE_JS_VERSION = '" + to + "';"));
}

console.log((DRY ? '[--dry 不會真的改] ' : '') + from + ' → ' + to);
console.log('assets/site.js + ' + touched.length + ' 個 HTML：' + touched.join('、'));
console.log(DRY ? '\n要真的改就拿掉 --dry。' : '\n⚠️ 接著跑：node tools/test-holdings.js');
