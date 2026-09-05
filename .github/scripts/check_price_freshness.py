"""
抓價還活著嗎——pg_cron 的主動告警（2026-09-05，對應 DECISIONS.md 4.19 的待辦）

⚠️ 這支跟 snapshot_ratio_history.py 一樣住在「公開的網站 repo」。
   理由相同：公開 repo 的 Actions 無限免費，而告警要有意義就得每天跑。

為什麼需要它：
    2026-08-29 起兩支抓價腳本改由 Supabase pg_cron 打 workflow_dispatch 觸發
    （GitHub 的 schedule: 是 best-effort，實測掉到應跑次數的四成，見 4.19）。
    換來準時，代價是 **pg_cron 是單點失效，而且安靜地壞**：
      - PAT 到期（最可能，而且沒有任何東西會在事後通知你排程停了）
      - Supabase 專案被暫停
      - pg_net 的 worker 卡住
    在這支之前，偵測完全是被動的——要等到有人打開網站，看見時間戳變紅。
    流量趨近於零的站，等於沒有人會看見。

    ➡️ 所以把偵測搬到「每天一定會跑一次」的地方：讓 job fail，GitHub 寄信。

⚠️⚠️ 這支**排在快照之後**，不是之前。
    4.19 當初寫的是「跑之前先查，太舊就讓 job fail」，那個順序有個副作用：
    抓價一停，快照就跟著不跑——而三支排程裡只有快照**斷掉補不回來**
    （價格停更下一輪會補上，cases_ratio_history 少的那一天是永久缺口）。
    新加的告警不該害死它要保護的那條序列。

    ⚠️ 那「抓價停擺時，快照寫進去的是重複的舊值」怎麼辦？
       那一天不會被誤讀成「市場沒動」：日彙總的 *_n 是各欄位各自數的樣本數，
       抓價沒跑就沒有 tick，那幾天的 *_n 會是空的——現成的辨識依據，
       analyze_7day_drift.py 本來就要看它（8/23、8/27 已經在這樣處理）。

門檻怎麼定：
    抓價的頻率是 CSFloat 每 3 小時、Steam 每 8 小時（UTC，見 PROJECT_OVERVIEW）。
    ⚠️ 門檻的敵人不是「晚一點才發現」，是**假警報**——一支每週亂響一次的告警
       兩個月後就會被當成背景噪音，那時它等於不存在。所以刻意抓寬：
         CSFloat 12 小時 ＝ 連續漏掉 4 輪
         Steam   30 小時 ＝ 連續漏掉 3 輪以上
       pg_cron 的失效模式是「整個停掉」不是「偶爾漏一輪」，抓寬不會漏掉它，
       只是晚半天知道。而這支自己也會被 GitHub 的 cron 延遲（實測 2～3.5 小時），
       門檻本來就得容納那段。

⚠️ 這支跑在公開 repo 的 Actions，log 任何人都看得到。
   只印時間戳與小時數，不印任何金鑰、不印品項價格以外的東西。
"""

import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# (顯示名稱, cases_data 的欄位, 排程頻率說明, 門檻小時)
SOURCES = [
    ('CSFloat', 'csfloat_updated_at', '每 3 小時，:43', 12),
    ('Steam',   'steam_updated_at',   '每 8 小時，01/09/17:17', 30),
]


def newest(column):
    """
    cases_data 裡那一欄最新的時間戳。整張表沒有值就回 None。

    ⚠️ 刻意用「全撈回來自己取 max」而不是 order + limit 1：
       PostgREST 對 desc 排序預設把 NULL 排在最前面，而且 supabase-py 的
       `.order(nullsfirst=…)` / `.not_.is_()` 在不同版本簽名不一樣——
       workflow 裝的是不鎖版的 `pip install supabase`，所以避開會隨版本漂的 API。
       品項只有幾十個，一次就撈完，成本可以忽略。
    """
    rows = (
        supabase.table("cases_data")
        .select(column)
        .limit(1000)
        .execute()
        .data
    )
    stamps = []
    for r in rows:
        raw = r.get(column)
        if not raw:
            continue
        # PostgREST 回的是 ISO 字串；Python 3.11 之前的 fromisoformat 不吃 'Z'。
        ts = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        stamps.append(ts)
    return max(stamps) if stamps else None


def main():
    now = datetime.now(timezone.utc)
    stale = []

    print(f"檢查抓價新鮮度（現在 {now.isoformat(timespec='seconds')}）")
    for label, column, cadence, limit_h in SOURCES:
        try:
            ts = newest(column)
        except Exception as err:
            # 讀不到就是有問題，不要當成「沒事」放過去。
            print(f"❌ {label}：查詢 {column} 失敗：{err}")
            stale.append(f"{label}（查不到 {column}）")
            continue

        if ts is None:
            print(f"❌ {label}：{column} 整張表都是空的")
            stale.append(f"{label}（{column} 全空）")
            continue

        age_h = (now - ts).total_seconds() / 3600
        mark = "✅" if age_h <= limit_h else "❌"
        print(f"{mark} {label:<8} 最後更新 {ts.isoformat(timespec='seconds')}"
              f"（{age_h:.1f} 小時前）　門檻 {limit_h} 小時　排程 {cadence}")
        if age_h > limit_h:
            stale.append(f"{label}（{age_h:.1f} 小時沒更新，門檻 {limit_h}）")

    if not stale:
        print("\n抓價正常。")
        return 0

    # ⚠️ 訊息要能一個人在手機上看完就知道下一步做什麼——
    #    收到信的時候通常不在電腦前，而 pg_cron 壞掉最可能的原因是最好修的那個。
    print("\n" + "=" * 68)
    print("🚨 抓價停了：" + "；".join(stale))
    print("=" * 68)
    print("""
pg_cron 是單點失效而且安靜地壞。按可能性從高到低查：

  1. PAT 到期 —— 最可能，而且 GitHub 不會因為排程停掉而通知你。
     去 Supabase SQL Editor 看 cron.job 裡那兩個 job 的 headers 帶的是哪把 token，
     過期就換一把，設定在（私有 repo）code/db/scheduler_pg_cron.sql。
  2. 專案被暫停 —— Supabase 後台首頁會直接寫。
  3. pg_net 的 worker 卡住 —— select * from net._http_response order by created desc limit 20;
     看最近的回應碼；整片空白代表請求根本沒送出去。
  4. 排程本身被刪掉或停用 —— select * from cron.job;

⚠️ 每日快照**已經跑完了**（這一步刻意排在它後面），所以歷史序列沒有缺口。
   停擺期間的日彙總 *_n 會是空的，分析時看得出來是哪幾天。
""".rstrip())
    return 1


if __name__ == "__main__":
    sys.exit(main())
