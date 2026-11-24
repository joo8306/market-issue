"""
WFE 국가별 통계 (시가총액 · 거래대금 · 상장사 수 · 대표지수)

출처
- WFE Focus 월간 Market Statistics (공개 표 4종): 거래소별 월 값
  · 시가총액·거래대금·지수: 각 호에 그해 1월~발표월 값이 있음 → 여러 호를 모아 과거 자료 구성
  · 상장사 수: 각 호에 그달 값(국내·외국·합계)만 있음 → 호마다 한 달씩 모음
- 유로넥스트 공식 월간 통계 (live.euronext.com 'Cash YYYYMM.xlsx'):
  유로넥스트 7개 시장(파리·암스테르담·밀라노·브뤼셀·리스본·더블린·오슬로)의 시총·상장사·거래대금
  → WFE 유로넥스트 합계(USD)를 시장별 비중으로 나눠 나라별 값 계산

결정 사항은 docs/wfe_decisions.md, 거래소→국가 매핑은 data/wfe_country_map.csv
"""

import csv
import io
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import wfe

ROOT = Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / "data" / "wfe_country_map.csv"
START_YEAR = 2023                      # 과거 자료 시작 (2~3년치)
ENX_PAGE = "https://live.euronext.com/en/resources/statistics/nextmonth-cash"
ENX_FILE = "https://live.euronext.com/sites/default/files/statistics/cash/monthly/Cash%20{ym}.xlsx"
UA = "Mozilla/5.0 (compatible; market-issue-bot)"

ENX_VENUES = {  # 유로넥스트 시장 → 국가
    "Paris": "프랑스", "Amsterdam": "네덜란드", "Milan": "이탈리아", "Brussels": "벨기에",
    "Lisbon": "포르투갈", "Dublin": "아일랜드", "Oslo": "노르웨이",
}
GENERIC_INDEX = {"Composite", "All Share", "General Index", "Main Index"}  # 이름만으로 구분 안 되는 지수 → 거래소명 붙임
ENX_VALUES_COUNTRIES = set(ENX_VENUES.values())
MAJOR = ["미국", "중국", "일본", "홍콩", "인도", "대만", "한국", "프랑스", "독일", "영국", "캐나다",
         "사우디아라비아", "호주", "스위스", "네덜란드", "이탈리아", "싱가포르"]
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                       "september", "october", "november", "december"], 1)}


# ===== 매핑 =====
def load_map(path=MAP_PATH):
    with path.open(encoding="utf-8-sig") as f:
        return {r["exchange"]: r for r in csv.DictReader(f)}


# ===== WFE 여러 호 수집 =====
def issue_slugs(page_html, start_year=START_YEAR):
    """호 목록 → [(YYYY-MM, slug)] 오래된 순 (발표월 기준)"""
    out = set()
    for m in re.finditer(r"/issue/([a-z]+)-(\d{4})/market-statistics", page_html):
        mon, yr = m.group(1), int(m.group(2))
        if mon in MONTHS and yr >= start_year + 1:  # start_year 1월 자료는 이듬해 초 호에 있음
            out.add((f"{yr}-{MONTHS[mon]:02d}", f"{mon}-{yr}"))
    return sorted(out)


def collect_issues(issues):
    """[(발표월, parse_issue 결과)] (오래된 순) → 거래소별 월 값. 나중 호가 앞 호를 덮어씀(수정치 반영)"""
    series = {"mcap": {}, "value": {}, "index": {}}
    listed = {}
    index_name = {}
    for _, iss in issues:
        for key in ("mcap", "value", "index"):
            t = iss.get(key)
            if not t:
                continue
            for r in t["rows"]:
                if r["total"]:
                    continue
                ex = series[key].setdefault(r["exchange"], {})
                for mon, col in zip(t["months"], t["month_cols"]):
                    if col in r["values"]:
                        ex[mon] = r["values"][col]
                if key == "index" and r["text"].get("Name of Index"):
                    nm = r["text"]["Name of Index"].strip()
                    index_name[r["exchange"]] = f"{r['exchange']} {nm}" if nm in GENERIC_INDEX else nm
        t = iss.get("listed")
        if t:
            tot_col = next((c for c in t["columns"] if c.lower().startswith("total")), "")
            mon = wfe.month_key(tot_col.split()[-1]) if tot_col else None
            if mon:
                for r in t["rows"]:
                    if r["total"]:
                        continue
                    v = r["values"]
                    listed.setdefault(r["exchange"], {})[mon] = {
                        "dom": v.get("Domestic"), "for": v.get("Foreign"), "tot": v.get(tot_col)}
    return series, listed, index_name


def fetch_wfe_history(start_year=START_YEAR):
    latest_url = wfe.latest_issue_url(wfe.http_text(wfe.INSIGHTS_URL))
    latest_html = wfe.http_text(latest_url)
    slugs = issue_slugs(latest_html, start_year)
    issues, failed = [], []
    for ym, slug in slugs:
        try:
            html = latest_html if slug in latest_url else wfe.http_text(f"{wfe.BASE}/issue/{slug}/market-statistics")
            issues.append((ym, wfe.parse_issue(html)))
        except Exception as e:  # 한 호가 실패해도 나머지로 진행
            failed.append(f"{slug}: {str(e)[:60]}")
    return issues, latest_url, failed


# ===== 유로넥스트 시장별 =====
def _rows(ws):
    return [list(r) for r in ws.iter_rows(values_only=True)]


def parse_euronext_xlsx(data):
    """Cash YYYYMM.xlsx → {시장: {YYYY-MM: {"issuers", "mcap_eur", "turnover_eur"}}}"""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = {}
    # 상장사(발행회사) 수·시총: 'NUMBER OF ISSUERS & MARKET CAPITALIZATION - SHARES - LISTINGS' 표
    rows = _rows(wb["PM - Overview"])
    start = next(i for i, r in enumerate(rows) if r and isinstance(r[0], str)
                 and r[0].startswith("NUMBER OF ISSUERS & MARKET CAPITALIZATION - SHARES - LISTINGS"))
    head = rows[start + 2]
    venues = {j: v for j, v in enumerate(head) if isinstance(v, str) and v in ENX_VENUES}
    for r in rows[start + 4:]:
        if not r or not isinstance(r[0], str) or not re.match(r"\d{4}-\d{2}$", r[0]):
            break
        for j, v in venues.items():  # 각 시장 블록: j = 발행회사 수, j+3 = 시총(백만 유로)
            out.setdefault(v, {}).setdefault(r[0], {}).update(issuers=r[j], mcap_eur=r[j + 3])
    # 거래대금: 'SM - 시장' 시트의 전자 호가장 주식 거래대금 (WFE 거래대금 정의와 같은 EOB)
    for v in ENX_VENUES:
        name = f"SM - {v}"
        if name not in wb.sheetnames:
            continue
        rows = _rows(wb[name])
        i = next((k for k, r in enumerate(rows) if r and isinstance(r[0], str)
                  and r[0].startswith("Turnover (M€) - Electronic order book")), None)
        if i is None:
            continue
        col = rows[i + 1].index("Equities*") if "Equities*" in rows[i + 1] else 2
        for r in rows[i + 2:]:
            if not r or not hasattr(r[0], "year"):
                break
            out.setdefault(v, {}).setdefault(f"{r[0].year}-{r[0].month:02d}", {})["turnover_eur"] = r[col]
    return out


def fetch_euronext(start_year=START_YEAR):
    """최신 파일 + 매년 12월 파일(각 파일에 전년·당해 월 값) → 시장별 월 값"""
    page = urllib.request.urlopen(urllib.request.Request(ENX_PAGE, headers={"User-Agent": UA}), timeout=30).read().decode("utf-8", "replace")
    yms = sorted(set(re.findall(r"Cash (\d{6})\.xlsx", page)))
    if not yms:
        raise RuntimeError("유로넥스트 월간 파일 목록을 찾지 못함")
    want = [ym for ym in yms if ym.endswith("12") and int(ym[:4]) >= start_year] + [yms[-1]]
    merged = {}
    for ym in sorted(set(want)):
        data = urllib.request.urlopen(urllib.request.Request(ENX_FILE.format(ym=ym), headers={"User-Agent": UA}), timeout=60).read()
        for v, months in parse_euronext_xlsx(data).items():
            for m, vals in months.items():
                merged.setdefault(v, {}).setdefault(m, {}).update({k: x for k, x in vals.items() if x is not None})
    return merged, yms[-1]


# ===== 국가 합계 =====
def _add(d, k, v):
    if v is None:
        return
    d[k] = d.get(k, 0) + v


def aggregate(series, listed, index_name, cmap, enx=None):
    """거래소별 → 국가별 월 값"""
    out = {"mcap": {}, "value": {}, "value_all": {}, "listed": {}, "index": {}}
    members = {}
    unmapped = set()
    for key in ("mcap", "value"):
        for ex, months in series[key].items():
            m = cmap.get(ex)
            if not m:
                unmapped.add(ex)
                continue
            kind, c = m["kind"], m["country"]
            if kind in ("exclude", "index_only", "alt_multi"):
                continue
            if kind == "multi_euronext" and enx:
                continue  # 아래에서 시장별로 나눔
            targets = ["value_all"] if kind == "alt" else ([key, "value_all"] if key == "value" else [key])
            for t in targets:
                bucket = out[t].setdefault(c, {})
                for mon, v in months.items():
                    _add(bucket, mon, v)
            members.setdefault(c, set()).add(ex + (" (대체)" if kind == "alt" else ""))
    for ex, months in listed.items():
        m = cmap.get(ex)
        if not m or m["kind"] in ("exclude", "index_only", "alt", "alt_multi") or (m["kind"] == "multi_euronext" and enx):
            continue
        bucket = out["listed"].setdefault(m["country"], {})
        for mon, v in months.items():
            b = bucket.setdefault(mon, {"dom": None, "for": None, "tot": None})
            for k in ("dom", "for", "tot"):
                if v.get(k) is not None:
                    b[k] = (b[k] or 0) + v[k]
    # 유로넥스트 → 7개국: WFE 유로넥스트 합계(USD) × 시장별 비중
    if enx:
        wfe_mcap = series["mcap"].get("Euronext", {})
        wfe_val = series["value"].get("Euronext", {})
        for mon in sorted(set(wfe_mcap) | set(wfe_val)):
            tot_m = sum((enx[v].get(mon, {}).get("mcap_eur") or 0) for v in enx)
            tot_t = sum((enx[v].get(mon, {}).get("turnover_eur") or 0) for v in enx)
            for v, c in ENX_VENUES.items():
                row = enx.get(v, {}).get(mon, {})
                if mon in wfe_mcap and tot_m and row.get("mcap_eur") is not None:
                    out["mcap"].setdefault(c, {})[mon] = wfe_mcap[mon] * row["mcap_eur"] / tot_m
                if mon in wfe_val and tot_t and row.get("turnover_eur") is not None:
                    share = wfe_val[mon] * row["turnover_eur"] / tot_t
                    out["value"].setdefault(c, {})[mon] = share
                    out["value_all"].setdefault(c, {})[mon] = share
                if row.get("issuers") is not None:
                    out["listed"].setdefault(c, {})[mon] = {"dom": None, "for": None, "tot": row["issuers"]}
                members.setdefault(c, set()).add(f"Euronext {v} (유로넥스트 통계로 분리)")
    # 대표지수: 나라마다 최대 2개
    for ex, months in series["index"].items():
        m = cmap.get(ex)
        if not m or m["kind"] in ("exclude",):
            continue
        out["index"].setdefault(m["country"], {})[ex] = {"name": index_name.get(ex, ""), "months": months}
    for c, idx in list(out["index"].items()):  # 상장 거래소 → 시총 큰 순으로 정렬, 최대 2개
        mc = {ex: max(series["mcap"].get(ex, {}).values(), default=0) for ex in idx}
        keep = sorted(idx, key=lambda e: (cmap[e]["kind"] == "index_only", -mc[e]))[:2]
        out["index"][c] = {e: idx[e] for e in keep}
    return out, {c: sorted(v) for c, v in members.items()}, sorted(unmapped)


# ===== 증감률 =====
def _pct(a, b):
    return (a / b - 1) * 100 if a is not None and b else None


def prev_month(mon, n=12):
    y, m = int(mon[:4]), int(mon[5:])
    m -= n
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


def summarize(agg, members, latest):
    y = latest[:4]
    dec = f"{int(y) - 1}-12"
    yoy = prev_month(latest)
    world = sum(v.get(latest, 0) for v in agg["mcap"].values())
    rows = {}
    countries = set(agg["mcap"]) | set(agg["value_all"]) | set(agg["listed"]) | set(agg["index"])
    for c in countries:
        mc = agg["mcap"].get(c, {})
        vl = agg["value"].get(c, {})
        va = agg["value_all"].get(c, {})
        ls = agg["listed"].get(c, {})

        def ytd(d, year):
            ms = [m for m in d if m.startswith(year) and m <= latest.replace(y, year)]
            return sum(d[m] for m in ms) if ms else None
        lst = ls.get(latest) or {}
        lst_dec = ls.get(dec) or {}
        idx = []
        for ex, info in agg["index"].get(c, {}).items():
            s = info["months"]
            idx.append({"exchange": ex, "name": info["name"], "level": s.get(latest),
                        "ytd": _pct(s.get(latest), s.get(dec)), "yoy": _pct(s.get(latest), s.get(yoy))})
        rows[c] = {
            "country": c, "major": c in MAJOR, "members": members.get(c, []),
            "mcap": mc.get(latest), "mcap_share": (mc.get(latest) / world * 100) if mc.get(latest) and world else None,
            "mcap_ytd": _pct(mc.get(latest), mc.get(dec)), "mcap_yoy": _pct(mc.get(latest), mc.get(yoy)),
            "value": vl.get(latest), "value_yoy": _pct(vl.get(latest), vl.get(yoy)),
            "value_cum": ytd(vl, y), "value_cum_yoy": _pct(ytd(vl, y), ytd(vl, str(int(y) - 1))),
            "value_all": va.get(latest), "value_all_yoy": _pct(va.get(latest), va.get(yoy)),
            "value_all_cum": ytd(va, y), "value_all_cum_yoy": _pct(ytd(va, y), ytd(va, str(int(y) - 1))),
            "listed_dom": lst.get("dom"), "listed_for": lst.get("for"), "listed_tot": lst.get("tot"),
            "listed_dom_ytd": (lst["dom"] - lst_dec["dom"]) if lst.get("dom") is not None and lst_dec.get("dom") is not None else None,
            "listed_tot_ytd": (lst["tot"] - lst_dec["tot"]) if lst.get("tot") is not None and lst_dec.get("tot") is not None else None,
            "index": idx,
        }
    return rows, world


def build(start_year=START_YEAR):
    issues, latest_url, failed = fetch_wfe_history(start_year)
    series, listed, index_name = collect_issues(issues)
    cmap = load_map()
    enx, enx_file, enx_err = None, None, None
    try:
        enx, enx_file = fetch_euronext(start_year)
    except Exception as e:  # 유로넥스트 실패 시 '유로넥스트(7개국)' 묶음 행으로 대체
        enx_err = str(e)[:120]
    agg, members, unmapped = aggregate(series, listed, index_name, cmap, enx)
    if not enx:  # 묶음 행 보충
        agg["mcap"]["유로넥스트(7개국)"] = series["mcap"].get("Euronext", {})
    months = sorted(set(m for v in agg["mcap"].values() for m in v))
    latest = months[-1]
    rows, world = summarize(agg, members, latest)
    for r in rows.values():  # 매핑 파일의 나라별 메모 (이중계산·묶음 등)
        r["notes"] = sorted({m["note"] for m in cmap.values() if m["country"] == r["country"] and m.get("note")
                             and m["kind"] not in ("index_only", "exclude")})
        if r["country"] in ENX_VALUES_COUNTRIES and enx:
            r["notes"].append("유로넥스트 공식 월간 통계 비중으로 WFE 유로넥스트 합계를 나눈 값 · 상장사 수는 국내·외국 구분 없음")
    # 월별 추이(차트·엑셀용)
    trend = {c: {k: {m: agg[k][c][m] for m in sorted(agg[k].get(c, {}))} for k in ("mcap", "value", "value_all")}
             for c in rows}
    for c in rows:
        if trend[c]["value_all"] == trend[c]["value"]:  # 대체거래소 없는 나라는 같은 값 → 생략
            trend[c].pop("value_all")
        trend[c]["listed"] = {m: v for m, v in sorted(agg["listed"].get(c, {}).items())}
        trend[c]["index"] = {ex: {"name": i["name"], "months": dict(sorted(i["months"].items()))}
                             for ex, i in agg["index"].get(c, {}).items()}
    return _round({
        "latest": latest, "months": months, "world_mcap": world,
        "rows": sorted(rows.values(), key=lambda r: -(r["mcap"] or 0)),
        "trend": trend,
        "sources": {
            "wfe": latest_url, "wfe_issues": len(issues), "wfe_failed": failed,
            "euronext": ENX_PAGE, "euronext_file": enx_file, "euronext_error": enx_err,
        },
        "unmapped": unmapped,
        "issue": latest_url.split("/issue/")[1].split("/")[0],
    })


def _round(x):
    """JSON 크기 줄이기: 큰 값(USD 백만)은 정수, 작은 값(지수·%)은 소수 2자리"""
    if isinstance(x, float):
        return round(x) if abs(x) >= 1000 else round(x, 2)
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_round(v) for v in x]
    return x
