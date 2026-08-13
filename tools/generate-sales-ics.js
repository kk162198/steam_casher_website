/* 產生 sales.ics —— 特賣倒數行事曆
 *
 * 一年跑一次就好：Valve 提前半年公布整年時程（Steamworks 每年兩份公告），
 * 更新 assets/site.js 的 STEAM_SALES 之後，在 website/ 目錄下執行：
 *
 *     node tools/generate-sales-ics.js
 *
 * ⚠️ 只放已經正式公布的檔期，不要推測日期。使用者會拿它決定七天前的
 *    買進時機，一個猜錯的日期會讓他整批卡在冷卻期錯過特賣。
 */
global.document={querySelectorAll:()=>[],addEventListener:()=>{},getElementById:()=>null,body:{getAttribute:()=>null}};
global.setInterval=()=>{};global.localStorage={getItem:()=>null,setItem:()=>{}};
eval(require('fs').readFileSync('assets/site.js','utf8'));

const BASE='https://kk162198.github.io/steam_casher_website/';
const events=[];
STEAM_SALES.forEach(s=>{
  const start=new Date(Date.parse(s.start));
  const end=new Date(Date.parse(s.end));
  // 用 buyByDisplayDate 而不是 buyByDate：特賣是 17:00 UTC 開始，減 7 天之後
  // 換成台灣時間是隔天凌晨，直接寫日期會讓使用者以為多一天可以買。見 site.js。
  const buyBy=buyByDisplayDate(s);
  /* ⚠️ 這支腳本產生的是**給所有人共用**的靜態檔，產生當下不知道讀者的時區，
     所以日期一定會有 ±1 天的誤差。方向要選對：
       提醒事件 → 取 UTC 日期，在 UTC+ 的時區會**早一天**，而早是安全的
                  （本來就是提前 10 天的提醒，變 11 天沒有影響）
       冷卻期提醒 → 完全相反，早一天等於功能壞掉，所以那個是在使用者
                  瀏覽器裡用當地時間產生的，見 sell.html 的 buildCooldownIcs。 */
  const remindOn=new Date(start.getTime()-SALE_LEAD_DAYS*86400000);

  // ① 提醒事件：特賣前 10 天。這一則才是真正有用的那則——
  //    冷卻期 7 天，看到特賣才開始買一定來不及。
  events.push({
    uid:'sale-lead-'+s.key+'@steam-casher',
    start:remindOn, allDayDays:1,
    summary:'該買了：'+s.name+'還有 '+SALE_LEAD_DAYS+' 天',
    description:
      s.name+'開始日期：'+start.toISOString().slice(0,10)+'\n'+
      '最晚買進日：'+buyBy.getFullYear()+'-'+String(buyBy.getMonth()+1).padStart(2,'0')+'-'+String(buyBy.getDate()).padStart(2,'0')+'（當天買都來得及；冷卻期要 7 天）\n\n'+
      '在 CSFloat 買進的箱子要等 7 天才能在 Steam 市場賣掉，'+
      '所以要在特賣開始前就先買，餘額才來得及在特賣期間用。\n\n'+
      '看目前哪些品項划算：\n'+BASE+'marketlist.html',
    url:BASE+'marketlist.html',
    alarmDaysBefore:0
  });

  // ② 特賣期間本身
  events.push({
    uid:'sale-'+s.key+'@steam-casher',
    start:start, allDayDays:null, end:end,
    summary:s.name+'開始',
    description:
      '到 '+end.toISOString().slice(0,10)+' 結束。\n\n'+
      '如果你七天前買了箱子，現在應該已經解鎖，可以賣掉換成餘額了。\n'+
      '看該掛多少：\n'+BASE+'sell.html',
    url:BASE+'sell.html',
    alarmDaysBefore:0
  });
});

const ics=icsCalendar(events,'Steam 加值幫手｜特賣倒數');
require('fs').writeFileSync('sales.ics',ics,'utf8');
console.log('已產生 sales.ics');
console.log('事件數:',events.length,'（'+STEAM_SALES.length+' 檔 × 2）');
console.log('位元組:',Buffer.byteLength(ics,'utf8'));
const lines=ics.split('\r\n');
console.log('超過 75 位元組的行:',lines.filter(l=>Buffer.byteLength(l,'utf8')>75).length);
STEAM_SALES.forEach(s=>{
  const st=Date.parse(s.start);
  console.log(' ',s.name,'｜提醒',new Date(st-SALE_LEAD_DAYS*86400000).toISOString().slice(0,10),
    '｜最晚買進',buyByDisplayDate(s).toLocaleDateString('sv-SE'),'｜開始',s.start.slice(0,10));
});
