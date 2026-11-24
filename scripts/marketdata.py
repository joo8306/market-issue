"""
시세 데이터 수집 (마감시황 · 해외시장)
- 국내: 네이버 증권 모바일 API (KRX 정보데이터시스템은 로그인이 필요해 사용하지 않음)
- 해외: 야후 파이낸스 (spark = 여러 종목 종가 한 번에, chart = 시가 확인용)
수집 함수(fetch_*)와 파싱 함수(parse_*)를 나눠서 파싱은 오프라인 테스트가 가능하게 함
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

NAVER = "https://m.stock.naver.com/api"
NAVER_FRONT = "https://m.stock.naver.com/front-api"
YAHOO = "https://query1.finance.yahoo.com"

# 해외시장 브리핑 대상 (야후 심볼 → 표시 이름, 그룹)
OVERSEAS = [
    ("^DJI", "Dow", "us"),
    ("^IXIC", "NASDAQ", "us"),
    ("^GSPC", "S&P500", "us"),
    ("^SOX", "필라델피아 반도체", "us_extra"),
    ("^VIX", "VIX", "us_extra"),
    ("^FTSE", "英 FTSE100", "eu"),
    ("^FCHI", "佛 CAC40", "eu"),
    ("^GDAXI", "獨 DAX40", "eu"),
    ("^N225", "日 닛케이225", "asia"),
    ("000001.SS", "中 상해종합", "asia"),
    ("EWY", "MSCI 한국 ETF(EWY)", "kr_link"),
    ("NQ=F", "나스닥100 선물", "kr_link"),
    ("^TNX", "美 10년물 금리", "macro"),
    ("DX-Y.NYB", "달러인덱스", "macro"),
    ("KRW=X", "달러/원", "macro"),
    ("CL=F", "WTI", "macro"),
    ("GC=F", "금", "macro"),
]
US_MAIN = ["^DJI", "^IXIC", "^GSPC"]
EU_MAIN = ["^FTSE", "^FCHI", "^GDAXI"]

# 야후가 막힐 때 쓰는 네이버 대체 경로 (야후 심볼 → (종류, 코드))
NAVER_WORLD = "https://api.stock.naver.com"
NAVER_MAP = {
    "^DJI": ("index", ".DJI"), "^IXIC": ("index", ".IXIC"), "^GSPC": ("index", ".INX"),
    "^SOX": ("index", ".SOX"), "^VIX": ("index", ".VIX"),
    "^FTSE": ("index", ".FTSE"), "^FCHI": ("index", ".FCHI"), "^GDAXI": ("index", ".GDAXI"),
    "^N225": ("index", ".N225"), "000001.SS": ("index", ".SSEC"),
    "^TNX": ("bond", "US10YT=RR"), "KRW=X": ("exchange", "FX_USDKRW"),
    "CL=F": ("energy", "CLcv1"), "GC=F": ("metals", "GCcv1"),
}


# ===== 공통 =====
def http_json(url, timeout=15, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:  # 네트워크 오류·429 등은 잠깐 쉬고 재시도
            last = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise last


def num(s):
    """'4,708.54' / '-3,708' / '+1,799' / '15,321,574백만' → float. 값이 없으면 None"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = "".join(ch for ch in str(s) if ch.isdigit() or ch in ".-")
    if t in ("", "-", ".", "-."):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def pct(a, b):
    if a is None or not b:
        return None
    return (a / b - 1) * 100


# ===== 국내 (네이버) =====
def parse_kr_index(basic, integration):
    """지수 basic + integration 응답 → 마감시황에 필요한 값"""
    info = {x.get("code"): x.get("value") for x in integration.get("totalInfos", [])}
    close = num(basic.get("closePrice"))
    prev = num(info.get("lastClosePrice"))
    if prev is None and close is not None:
        prev = close - (num(basic.get("compareToPreviousClosePrice")) or 0)
    deal = integration.get("dealTrendInfo") or {}
    prog = integration.get("programTrendInfo") or {}
    updown = integration.get("upDownStockInfo") or {}
    value_mil = num(info.get("accumulatedTradingValue"))  # 백만원
    traded_at = basic.get("localTradedAt") or ""
    return {
        "name": basic.get("stockName") or basic.get("itemCode"),
        "code": basic.get("itemCode"),
        "date": traded_at[:10],
        "status": basic.get("marketStatus"),           # OPEN / CLOSE
        "close": close,
        "prev": prev,
        "change": close - prev if close is not None and prev is not None else None,
        "pct": num(basic.get("fluctuationsRatio")),
        "open": num(info.get("openPrice")),
        "high": num(info.get("highPrice")),
        "low": num(info.get("lowPrice")),
        "open_pct": pct(num(info.get("openPrice")), prev),
        "high_pct": pct(num(info.get("highPrice")), prev),
        "low_pct": pct(num(info.get("lowPrice")), prev),
        "value_eok": round(value_mil / 100) if value_mil is not None else None,  # 억원
        "investors": {                                   # 순매수, 억원
            "bizdate": deal.get("bizdate"),
            "개인": num(deal.get("personalValue")),
            "외국인": num(deal.get("foreignValue")),
            "기관": num(deal.get("institutionalValue")),
        },
        "program": {                                     # 프로그램 순매수, 억원
            "차익": num(prog.get("indexDifferenceReal")),
            "비차익": num(prog.get("indexBiDifferenceReal")),
            "전체": num(prog.get("indexTotalReal")),
        },
        "breadth": {
            "상한": num(updown.get("upperCount")),
            "상승": num(updown.get("riseCount")),
            "보합": num(updown.get("steadyCount")),
            "하락": num(updown.get("fallCount")),
            "하한": num(updown.get("lowerCount")),
        },
    }


def parse_stock_list(payload, limit=10):
    out = []
    for s in (payload.get("stocks") or [])[:limit]:
        out.append({
            "code": s.get("itemCode"),
            "name": s.get("stockName"),
            "close": num(s.get("closePrice")),
            "pct": num(s.get("fluctuationsRatio")),
            "value_eok": round((num(s.get("accumulatedTradingValue")) or 0) / 100),  # 백만원 → 억원
            "mcap": s.get("marketValueHangeul"),
        })
    return out


def fetch_kr_market():
    out = {"fetched_at": datetime.now(KST).isoformat(), "indices": {}, "top_mcap": {}}
    for code in ("KOSPI", "KOSDAQ"):
        basic = http_json(f"{NAVER}/index/{code}/basic")
        integ = http_json(f"{NAVER}/index/{code}/integration")
        out["indices"][code] = parse_kr_index(basic, integ)
        try:
            mv = http_json(f"{NAVER}/stocks/marketValue/{code}?page=1&pageSize=10")
            out["top_mcap"][code] = parse_stock_list(mv, 10)
        except Exception as e:
            print(f"  시총 상위 실패 {code}: {e}")
            out["top_mcap"][code] = []
    return out



def parse_index_history(rows):
    """네이버 지수 일별 시세(/index/KOSPI/price) → [(YYYY-MM-DD, 종가)] 오래된 순"""
    pts = [(r.get("localTradedAt", "")[:10], num(r.get("closePrice"))) for r in rows]
    return sorted((d, c) for d, c in pts if d and c is not None)


def fetch_kospi_history(pages=4, page_size=60):
    rows = []
    for p in range(1, pages + 1):
        batch = http_json(f"{NAVER}/index/KOSPI/price?pageSize={page_size}&page={p}")
        if not batch:
            break
        rows.extend(batch)
    return parse_index_history(rows)


# ===== 해외 (야후) =====
def _clean_closes(timestamps, closes, tz_offset):
    pts = []
    for ts, c in zip(timestamps or [], closes or []):
        if c is None:
            continue
        d = datetime.fromtimestamp(ts + (tz_offset or 0), tz=timezone.utc).strftime("%Y-%m-%d")
        if pts and pts[-1][0] == d:
            pts[-1] = (d, c)
        else:
            pts.append((d, c))
    return pts


def parse_spark(payload):
    """spark 응답 → {심볼: {date, close, prev, pct, market_time}}"""
    out = {}
    for r in (payload.get("spark") or {}).get("result") or []:
        try:
            resp = r["response"][0]
            meta = resp.get("meta", {})
            closes = resp["indicators"]["quote"][0]["close"]
            pts = _clean_closes(resp.get("timestamp"), closes, meta.get("gmtoffset"))
        except (KeyError, IndexError, TypeError):
            continue
        if len(pts) < 2:
            continue
        (d0, prev), (d1, close) = pts[-2], pts[-1]
        out[r["symbol"]] = {
            "date": d1, "close": close, "prev": prev, "prev_date": d0,
            "pct": pct(close, prev),
            "market_time": meta.get("regularMarketTime"),
            "currency": meta.get("currency"),
            "series": [[d, c] for d, c in pts[-6:]],
        }
    return out


def row_on(row, date):
    """해당 날짜 종가 기준으로 다시 계산한 행 (없으면 None). 유럽·지표를 美 거래일에 맞출 때 사용"""
    series = row.get("series") or []
    for i, (d, c) in enumerate(series):
        if d == date and i > 0:
            out = dict(row)
            if date != row.get("date"):  # 시가·고가·저가·장중 여부는 마지막 날 것이라 버림
                for k in ("open", "high", "low", "open_pct", "high_pct", "low_pct", "live"):
                    out.pop(k, None)
            out.update(date=d, close=c, prev=series[i - 1][1], prev_date=series[i - 1][0],
                       pct=pct(c, series[i - 1][1]))
            return out
    return None


def parse_chart_open(payload):
    """chart 응답 → 마지막 거래일의 (날짜, 시가, 고가, 저가)"""
    try:
        res = payload["chart"]["result"][0]
        q = res["indicators"]["quote"][0]
        off = res["meta"].get("gmtoffset", 0)
    except (KeyError, IndexError, TypeError):
        return None
    rows = [(ts, o, h, l, c) for ts, o, h, l, c in
            zip(res.get("timestamp") or [], q.get("open", []), q.get("high", []), q.get("low", []), q.get("close", []))
            if c is not None]
    if not rows:
        return None
    ts, o, h, l, _ = rows[-1]
    d = datetime.fromtimestamp(ts + off, tz=timezone.utc).strftime("%Y-%m-%d")
    return {"date": d, "open": o, "high": h, "low": l}


def parse_naver_daily(rows):
    """네이버 일별 시세(해외지수·금리·원자재·환율) → 날짜 오름차순 [(날짜, 종가, 시가, 고가, 저가)]
    날짜는 각 시장 현지 날짜 (localTradedAt 앞 10자리)"""
    pts = {}
    for r in rows or []:
        d = (r.get("localTradedAt") or "")[:10]
        c = num(r.get("closePrice"))
        if d and c is not None:
            pts[d] = (d, c, num(r.get("openPrice")), num(r.get("highPrice")), num(r.get("lowPrice")))
    return [pts[d] for d in sorted(pts)]


def row_from_daily(pts):
    """일별 시세 → spark 와 같은 모양의 행 (+ 마지막 날 시가·고가·저가)"""
    if len(pts) < 2:
        return None
    (d0, prev, *_), (d1, close, o, h, lo) = pts[-2], pts[-1]
    row = {"date": d1, "close": close, "prev": prev, "prev_date": d0, "pct": pct(close, prev),
           "series": [[d, c] for d, c, *_ in pts[-6:]]}
    if o:  # 금리·환율 등은 시가가 없음
        row.update(open=o, high=h, low=lo, open_pct=pct(o, prev), high_pct=pct(h, prev), low_pct=pct(lo, prev))
    return row


def merge_latest_quote(pts, basic):
    """일별 시세에 아직 안 들어간 최신 거래일을 현재가(basic)로 채움.
    네이버 일별 시세는 나스닥 계열 지수(나스닥·SOX)의 당일 행이 몇 시간씩 늦게 붙어서,
    다우·S&P는 월요일인데 나스닥만 금요일로 남는 일이 생김 → basic 의 종가·시가·고가·저가로 보충"""
    if not basic:
        return pts, None
    d = (basic.get("localTradedAt") or "")[:10]
    close = num(basic.get("closePriceRaw") or basic.get("closePrice"))
    if not d or close is None:
        return pts, None
    status = basic.get("marketStatus")
    row = (d, close, num(basic.get("openPriceRaw")), num(basic.get("highPriceRaw")), num(basic.get("lowPriceRaw")))
    pts = [p for p in pts if p[0] != d] + [row] if (not pts or d >= pts[-1][0]) else pts
    return sorted(pts), status


def fetch_naver_daily(kind, code):
    if kind == "index":
        q = urllib.parse.quote(code)
        rows = http_json(f"{NAVER_WORLD}/index/{q}/price?page=1&pageSize=10", retries=1)
        try:
            basic = http_json(f"{NAVER_WORLD}/index/{q}/basic", retries=1)
        except Exception:
            basic = None
        pts, status = merge_latest_quote(parse_naver_daily(rows), basic)
        row = row_from_daily(pts)
        if row and status and status != "CLOSE":
            row["live"] = True  # 장중 값 (해외시황 초안은 직전 마감일 기준으로 씀)
        return row
    else:
        url = (f"{NAVER_FRONT}/marketIndex/prices?category={kind}"
               f"&reutersCode={urllib.parse.quote(code)}&page=1&pageSize=10")
        rows = (http_json(url, retries=1) or {}).get("result")
    return row_from_daily(parse_naver_daily(rows))


def fetch_overseas():
    symbols = [s for s, _, _ in OVERSEAS]
    q = urllib.parse.quote(",".join(symbols), safe=",")
    try:
        spark = parse_spark(http_json(f"{YAHOO}/v7/finance/spark?symbols={q}&range=5d&interval=1d"))
    except Exception as e:
        print(f"  야후 실패 → 네이버로 대체 ({str(e)[:60]})")
        spark = {}

    items = []
    for sym, name, group in OVERSEAS:
        row = {"symbol": sym, "name": name, "group": group}
        if sym in spark:
            row.update(spark[sym], source="Yahoo")
        items.append(row)

    for row in items:
        sym = row["symbol"]
        # 야후에 없는 종목은 네이버로, 美 3대지수는 출발 방향 판단용 시가도 네이버에서
        need_close = "close" not in row
        need_open = sym in US_MAIN
        if (need_close or need_open) and sym in NAVER_MAP:
            try:
                nv = fetch_naver_daily(*NAVER_MAP[sym])
            except Exception as e:
                nv = None
                print(f"  네이버 실패 {sym}: {str(e)[:60]}")
            if nv and need_close:
                row.update(nv, source="네이버")
            elif nv and nv["date"] == row.get("date") and nv.get("open"):
                row.update({k: nv[k] for k in ("open", "high", "low")})
                row.update(open_pct=pct(nv["open"], row["prev"]), high_pct=pct(nv["high"], row["prev"]),
                           low_pct=pct(nv["low"], row["prev"]))
        if need_open and "open_pct" not in row and "close" in row:
            try:  # 네이버로 시가를 못 받았을 때만 야후 chart 호출
                o = parse_chart_open(http_json(
                    f"{YAHOO}/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d", retries=0))
                if o and o["date"] == row["date"]:
                    row.update(open=o["open"], high=o["high"], low=o["low"], open_pct=pct(o["open"], row["prev"]),
                               high_pct=pct(o["high"], row["prev"]), low_pct=pct(o["low"], row["prev"]))
            except Exception as e:
                print(f"  시가 조회 실패 {sym}: {str(e)[:60]}")
        if "close" not in row:
            row["error"] = "데이터 없음"

    if not any("close" in r for r in items if r["symbol"] in US_MAIN):
        raise RuntimeError("美 지수를 야후·네이버 모두에서 받지 못함")
    return {"fetched_at": datetime.now(KST).isoformat(), "items": items}
