"""
每日 ratio 快照（對應 PROJECT_OVERVIEW.md 待辦事項 Tier 2 #6）

⚠️ 這個檔案住在「公開的網站 repo」（steam_casher_website），不在 code repo。
   2026-08-23 從 code/common/ 搬過來，理由見 DECISIONS.md 4.16：
   公開 repo 的 Actions 無限免費，而這支是三支排程裡唯一「斷掉就補不回來」的
   （價格停更下一輪會補上，快照缺的那一天是永久缺口）。
   它讀寫的仍是同一個 Supabase 專案，跟 code repo 的抓價腳本是同一條管線。

背景：
    cases_data 目前只存「最新一筆」的 ratio，舊資料一旦被 upsert 覆蓋就永久消失，
    沒有辦法回頭看歷史走勢、也算不出倍率的百分位分布。
    本腳本只把 cases_data 目前的 ratio 複製一份，存進獨立的歷史表
    cases_ratio_history，每天累積一筆快照。

    存什麼、不存什麼（2026-08-12 修訂——舊註解寫「只存 ratio」，與實際不符）：

    存「原始輸入」：steam_price／steam_lowest_price／steam_volume／
    csfloat_price／csfloat_inventory。這些值一旦被 cases_data 的 upsert 覆蓋
    就永久消失、無法重建，而未來任何回溯分析都要靠它們。

    存「兩個 ratio」：ratio（median 基準）與 ratio_lowest（lowest 基準）。
    費率常數未來可能調整，屆時必須用「當時的原始價格 × 當時的費率」才能正確
    回溯，所以當下的判斷值也要留一份。兩者並存的目的是可比較性——若之後把
    顯示基準從 median 換成 lowest，兩條序列可以直接對照，不會斷代。

    不存 diff：它是絕對金額，跨時間比較的意義低於 ratio，且可由原始價格重算。

    csfloat_inventory 為什麼要存：深度會隨時間變化，而深度不足會讓實際成交
    均價高於最低掛牌價。沒有這條時間序列，就無法區分「倍率下降」是價格變了
    還是深度變了。

執行時機／頻率：
    由網站 repo 的 .github/workflows/ratio_snapshot.yml 每天跑一次（03:37 UTC），
    不掛在既有的 CSFloat／Steam 排程尾巴，避免同一份快照被重複觸發、
    白白多打幾次 Supabase 寫入請求。
    03:37 是刻意排在上游（Steam 01:17、CSFloat 01:43）之後、
    下一次 CSFloat（04:43）之前，且避開整點壅塞——原本的 00:30 因為
    自己與上游都被 cron 延遲，實際上沒有達到「抓新鮮資料」的目的。
    保險起見仍用 (name, snapshot_date) 當 upsert 的衝突判斷欄位，
    就算手動重跑或未來排程頻率調整，同一天內重複執行也只會覆蓋成當天最新的值，
    不會產生重複快照。

前置需求：
    Supabase 需要先建立 cases_ratio_history 這張表（含 RLS），
    DDL 請見（私有 repo steam_casher）code/db/schema.sql；這張表目前無法在本機/CI 環境直接建立
    （見 PROJECT_OVERVIEW.md 待辦事項 Tier 1 #5 的網路白名單限制說明），
    需自行到 Supabase 後台 SQL Editor 貼上 schema.sql 對應段落執行一次。
"""

import os
import statistics
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


SNAPSHOT_COLUMNS = (
    "name, ratio, ratio_lowest, "
    "steam_price, steam_lowest_price, steam_volume, "
    "csfloat_price, csfloat_inventory"
)


def fetch_all_ratio_rows():
    """讀取 cases_data 要快照的欄位（分頁讀取，避免筆數超過 Supabase 單次上限）。"""
    rows = []
    page_size = 1000
    start = 0
    while True:
        page = (
            supabase.table("cases_data")
            .select(SNAPSHOT_COLUMNS)
            .range(start, start + page_size - 1)
            .execute()
            .data
        )
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return rows


# ── 前一日的 tick 彙總（2026-08-14 新增）─────────────────────────────
#
# 為什麼要彙總：見（私有 repo）code/common/price_ticks.py 的 docstring。
# 單點取樣的噪音已經量到 Steam 25%、CSFloat 30%（跳一下隔天又彈回去），
# 而且快照時刻因為 cron 延遲而不固定（原本排 00:30，實測落在 02:28–04:06）。
#
# ⚠️⚠️ 彙總的是「前一日」，不是今天。
#    這支腳本排在 03:37 UTC，而 GitHub Actions 的 cron 還會再延遲（實測 2～3.5 小時）。
#    不管是 03:37 還是更晚，「今天」都只累積了幾個小時的 tick——
#    拿它算日彙總會得到一個只涵蓋凌晨時段的數字，比單點取樣更糟，
#    因為它看起來像彙總值，實際上只是換個方式取樣。
#    所以彙總完整的前一日，寫回前一日那一列。
#
# ⚠️ 三種都存（中位數 / 平均 / 樣本數）是刻意的：
#    顯示與分析用中位數（離群值擋得掉），平均留著當診斷——
#    兩者差很多就代表那一天有離群值，不用重抓就看得出來。
#    樣本數要存，因為「中位數由 8 個樣本算出」和「由 1 個樣本算出」
#    是完全不同的東西，沒有樣本數就分不出來。
#
# ⚠️ 不覆蓋既有的單點欄位（steam_price / csfloat_price 等）。
#    那 15 天的序列已經公開讓人下載了，改掉會讓已下載的版本對不上，
#    而且兩種取法並存才比較得出「彙總到底修正了多少」。

TICK_AGG_SPECS = [
    # (tick 來源, tick 欄位, 寫進 cases_ratio_history 的前綴)
    ('steam',   'steam_price',         'steam_price'),
    ('steam',   'steam_lowest_price',  'steam_lowest_price'),
    ('steam',   'steam_volume',        'steam_volume'),
    ('csfloat', 'csfloat_price',       'csfloat_price'),
    ('csfloat', 'csfloat_price_depth', 'csfloat_price_depth'),
]


def fetch_ticks_for(day_iso):
    """讀某一個 UTC 日期的所有 tick。回傳 list，讀不到就回空 list。"""
    start = f"{day_iso}T00:00:00+00:00"
    end = f"{day_iso}T23:59:59.999999+00:00"
    rows, page_size, offset = [], 1000, 0
    while True:
        try:
            page = (
                supabase.table("cases_price_ticks")
                .select("*")
                .gte("captured_at", start)
                .lte("captured_at", end)
                .range(offset, offset + page_size - 1)
                .execute()
                .data
            )
        except Exception as err:
            print(f"⚠️ 讀取 cases_price_ticks 失敗，本次略過日彙總：{err}")
            print("   （若尚未建立這張表，請執行 db/schema.sql 的 ⑤ 段）")
            return []
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def aggregate_ticks(ticks):
    """
    把一天的 tick 彙總成 {name: {欄位: 值}}。

    ⚠️ 每個欄位各自算樣本數。同一次抓價可能某個欄位有值、某個沒有
       （例如 priceoverview 偶爾不回 volume），用整列的筆數當樣本數會高估。
    """
    by_name = {}
    for t in ticks:
        by_name.setdefault(t.get("name"), []).append(t)

    result = {}
    for name, items in by_name.items():
        agg = {}
        for source, field, prefix in TICK_AGG_SPECS:
            values = [
                t[field] for t in items
                if t.get("source") == source and t.get(field) is not None
            ]
            if not values:
                continue
            agg[f"{prefix}_median"] = round(statistics.median(values), 4)
            agg[f"{prefix}_mean"] = round(statistics.fmean(values), 4)
            agg[f"{prefix}_n"] = len(values)
        if agg:
            result[name] = agg
    return result


def write_daily_aggregates(day_iso):
    """把前一日的 tick 彙總寫回 cases_ratio_history 的那一列。"""
    ticks = fetch_ticks_for(day_iso)
    if not ticks:
        print(f"{day_iso} 沒有任何 tick，略過日彙總"
              f"（第一次啟用時這是正常的，要等抓價腳本跑過一整天）。")
        return 0

    aggregates = aggregate_ticks(ticks)
    written, failed = 0, 0
    for name, agg in aggregates.items():
        payload = {"name": name, "snapshot_date": day_iso}
        payload.update(agg)
        try:
            supabase.table("cases_ratio_history").upsert(
                payload, on_conflict="name,snapshot_date"
            ).execute()
            written += 1
        except Exception as err:
            if failed == 0:   # 只印第一筆，不要洗掉 45 行
                print(f"⚠️ 寫入日彙總失敗（{name}）：{err}")
                print("   （若欄位還沒建立，請執行 db/schema.sql 的 ⑤ 段）")
            failed += 1

    counts = [a.get("csfloat_price_n", 0) for a in aggregates.values()]
    avg_n = (sum(counts) / len(counts)) if counts else 0
    print(f"{day_iso} 日彙總完成：{written} 筆成功、{failed} 筆失敗，"
          f"共 {len(ticks)} 筆 tick，CSFloat 平均每品項 {avg_n:.1f} 個樣本。")
    return written


def main():
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"正在讀取 cases_data，準備寫入 {today} 的 ratio 快照...")
    rows = fetch_all_ratio_rows()

    if not rows:
        print("cases_data 目前沒有任何資料，結束。")
        return

    updated, skipped = 0, 0

    for row in rows:
        name = row.get("name")
        ratio = row.get("ratio")

        if ratio is None:
            print(f"略過 {name}：ratio 尚未計算（需先跑過 update_derived_fields.py）")
            skipped += 1
            continue

        # 逐欄複製當下的值。ratio 以外的欄位允許 None——
        # 快照的意義就是「當天的實際狀態」，某欄當天真的沒有值，
        # 那個 None 本身就是有意義的紀錄，不該用舊值填補。
        payload = {
            "name": name,
            "snapshot_date": today,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "ratio": ratio,
            "ratio_lowest": row.get("ratio_lowest"),
            "steam_price": row.get("steam_price"),
            "steam_lowest_price": row.get("steam_lowest_price"),
            "steam_volume": row.get("steam_volume"),
            "csfloat_price": row.get("csfloat_price"),
            "csfloat_inventory": row.get("csfloat_inventory"),
        }

        try:
            supabase.table("cases_ratio_history").upsert(
                payload,
                on_conflict="name,snapshot_date",
            ).execute()
            updated += 1
        except Exception as db_err:
            print(f"寫入快照失敗 ({name})：{db_err}")
            skipped += 1

    print(f"每日 ratio 快照完成！成功 {updated} 筆，略過 {skipped} 筆（快照日期：{today}）。")

    # 前一日的 tick 日彙總。放在單點快照之後，兩者互不影響：
    # 彙總失敗不會害得快照沒寫，快照失敗也不會讓彙總跳過。
    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    print(f"\n正在彙總 {yesterday} 的原始價格記錄...")
    write_daily_aggregates(yesterday)


if __name__ == "__main__":
    main()
