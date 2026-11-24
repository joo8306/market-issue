"""
야간·주말 지표: 한국 장이 닫힌 동안 한국 시장 반응을 가늠하는 지표 모음

- 미국 3대 지수 선물 (네이버, 거의 24시간)
- 미국 상장 한국 관련: EWY, SK하이닉스 ADR(SKHY), 한국 ADR(금융·소재·통신), 삼성전자 GDR(런던, 야후)
- 반도체: 마이크론·엔비디아·TSMC (정규장 + 시간외)
- 하이퍼리퀴드 무기한 선물 (24시간·주말 거래, 비공식): 코스피200(KR200), 삼성전자(SMSN), SK하이닉스(SKHX), EWY
  · 삼성전자·하이닉스는 주당 달러 가격 → 원화 환산해 국내 종가와 비교
  · 코스피200은 지수 포인트 그대로 → 코스피200 정규장 종가와 비교
"""

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import marketdata as md

HL_URL = "https://api.hyperliquid.xyz/info"
HL_DEX = "xyz"   # 거래가 가장 많은 운영자(trade.xyz)
NAVER_WORLD = md.NAVER_WORLD
NAVER = md.NAVER

US_FUTURES = [("EScv1", "S&P500 선물"), ("NQcv1", "나스닥100 선물"), ("YMcv1", "다우 선물")]
KR_LINKED = [  # (네이버 코드, 이름, 묶음)
    ("EWY", "MSCI 한국 ETF (EWY)", "kr"),
    ("SKHY.O", "SK하이닉스 ADR", "kr"),
    ("KB", "KB금융 ADR", "adr"),
    ("SHG", "신한지주 ADR", "adr"),
    ("WF", "우리금융 ADR", "adr"),
    ("PKX", "POSCO홀딩스 ADR", "adr"),
    ("KEP", "한국전력 ADR", "adr"),
    ("SKM", "SK텔레콤 ADR", "adr"),
    ("KT", "KT ADR", "adr"),
    ("MU.O", "마이크론", "semi"),
    ("NVDA.O", "엔비디아", "semi"),
    ("TSM", "TSMC ADR", "semi"),
]
SAMSUNG_GDR = ("SMSN.IL", "삼성전자 GDR (런던)", 25)   # 1 GDR = 보통주 25주
PERPS = [  # (하이퍼리퀴드 이름, 표시 이름, 비교 기준 종류, 국내 코드)
    ("xyz:KR200", "코스피200", "index", "KPI200"),
    ("xyz:SMSN", "삼성전자", "stock", "005930"),
    ("xyz:SKHX", "SK하이닉스", "stock", "000660"),
    ("xyz:EWY", "EWY", "usd", "EWY"),
]


def f(x):
    return md.num(x) if isinstance(x, str) else (float(x) if x is not None else None)


# ===== 네이버 =====
def parse_us_futures(rows):
    want = dict(US_FUTURES)
    out = []
    for r in rows or []:
        code = r.get("reutersCode")
        if code in want:
            out.append({"code": code, "name": want[code], "price": f(r.get("closePrice")),
                        "pct": f(r.get("fluctuationsRatio")), "time": r.get("localTradedAt"),
                        "status": r.get("marketStatus")})
    order = [c for c, _ in US_FUTURES]
    return sorted(out, key=lambda x: order.index(x["code"]))


def parse_over_market(info):
    """네이버 시간외(프리·애프터마켓) 정보 → {price, pct, session, time} (없으면 None)"""
    if not isinstance(info, dict):
        return None
    price = f(info.get("overPrice") or info.get("closePrice"))
    if price is None:
        return None
    session = info.get("tradingSessionType")
    if isinstance(session, dict):
        session = session.get("name") or session.get("code")
    label = {"PRE_MARKET": "프리마켓", "AFTER_MARKET": "애프터마켓"}.get(str(session), "시간외")
    return {"price": price, "pct": f(info.get("fluctuationsRatio")), "session": label,
            "time": info.get("localTradedAt")}


def parse_world_stock(code, name, group, d):
    return {"code": code, "name": name, "group": group, "price": f(d.get("closePrice")),
            "pct": f(d.get("fluctuationsRatio")), "status": d.get("marketStatus"),
            "time": d.get("localTradedAt"), "over": parse_over_market(d.get("overMarketPriceInfo"))}


def fetch_kr_linked():
    out = []
    for code, name, group in KR_LINKED:
        try:
            out.append(parse_world_stock(code, name, group, md.http_json(f"{NAVER_WORLD}/stock/{code}/basic")))
        except Exception as e:
            out.append({"code": code, "name": name, "group": group, "error": str(e)[:60]})
    return out


def fetch_samsung_gdr():
    sym, name, ratio = SAMSUNG_GDR
    try:
        d = md.http_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=1d&interval=15m")
        m = d["chart"]["result"][0]["meta"]
        price, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose")
        t = m.get("regularMarketTime")
        return {"code": sym, "name": name, "group": "kr", "price": price, "pct": md.pct(price, prev),
                "time": datetime.fromtimestamp(t, timezone.utc).isoformat() if t else None,
                "per_share_usd": price / ratio if price else None, "ratio": ratio}
    except Exception as e:
        return {"code": sym, "name": name, "group": "kr", "error": str(e)[:60]}


def fetch_kr_closes():
    """국내 정규장 종가 (무기한 선물 비교 기준)"""
    out = {}
    for _, _, kind, code in PERPS:
        try:
            if kind == "index":
                d = md.http_json(f"{NAVER}/index/{code}/basic")
            elif kind == "stock":
                d = md.http_json(f"{NAVER}/stock/{code}/basic")
            else:
                d = md.http_json(f"{NAVER_WORLD}/stock/{code}/basic")
            out[code] = {"close": f(d.get("closePrice")), "time": d.get("localTradedAt"), "status": d.get("marketStatus")}
        except Exception as e:
            out[code] = {"error": str(e)[:60]}
    return out


# ===== 하이퍼리퀴드 =====
def hl_post(body):
    req = urllib.request.Request(HL_URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def parse_perps(meta_ctxs, closes):
    meta, ctxs = meta_ctxs
    ctx = {u["name"]: c for u, c in zip(meta["universe"], ctxs)}
    fx = f((ctx.get(f"{HL_DEX}:KRW") or {}).get("oraclePx"))   # 원/달러 (하이퍼리퀴드 기준가)
    out = []
    for name, label, kind, code in PERPS:
        c = ctx.get(name)
        if not c:
            continue
        mark, prev = f(c.get("markPx")), f(c.get("prevDayPx"))
        ref = (closes.get(code) or {}).get("close")
        krw = mark * fx if kind == "stock" and mark and fx else None
        cmp = krw if kind == "stock" else mark
        out.append({
            "name": label, "symbol": name, "kind": kind, "mark": mark, "oracle": f(c.get("oraclePx")),
            "pct24": md.pct(mark, prev), "krw": krw, "ref_close": ref,
            "ref_time": (closes.get(code) or {}).get("time"),
            "vs_close": md.pct(cmp, ref) if cmp and ref else None,
            "vol24_usd": f(c.get("dayNtlVlm")), "oi": f(c.get("openInterest")),
        })
    return out, fx


def fetch_overnight():
    errors = {}

    def safe(key, fn, default=None):
        try:
            return fn()
        except Exception as e:
            errors[key] = str(e)[:80]
            return default

    futures = safe("us_futures", lambda: parse_us_futures(md.http_json(f"{NAVER_WORLD}/futures/nation/USA")), [])
    linked = safe("kr_linked", fetch_kr_linked, [])
    linked.insert(1, fetch_samsung_gdr())
    closes = safe("kr_closes", fetch_kr_closes, {})
    perps, fx = safe("perps", lambda: parse_perps(hl_post({"type": "metaAndAssetCtxs", "dex": HL_DEX}), closes), ([], None))
    gdr = next((x for x in linked if x.get("code") == SAMSUNG_GDR[0]), None)
    if gdr and gdr.get("per_share_usd") and fx and (closes.get("005930") or {}).get("close"):
        gdr["krw_per_share"] = gdr["per_share_usd"] * fx
        gdr["vs_kr_close"] = md.pct(gdr["krw_per_share"], closes["005930"]["close"])
    if errors and not (futures or linked or perps):
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return {"us_futures": futures, "linked": linked, "perps": perps, "usdkrw": fx,
            "kr_closes": closes, "errors": errors}
