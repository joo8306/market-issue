"""
시황 탭 그래프용 시계열
- 당일 흐름(intra): 국내 = 네이버 분봉(5분 간격으로 줄임), 해외 = 야후 spark 5분, 무기한 선물 = 하이퍼리퀴드 5분봉
- 1개월 추이(day): 네이버 일별 시세 우선, 없으면 야후 일별
결과: {키: {"intra": [[유닉스초, 값]...], "prev": 전일 종가, "day": [["YYYY-MM-DD", 종가]...]}}
키는 화면의 행과 같게: 국내 지수 코드(KOSPI), 야후 심볼(^DJI, EWY…), 네이버 선물 코드(EScv1), 하이퍼리퀴드 이름(xyz:SMSN)
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import marketdata as md
import overnight as on

KST = timezone(timedelta(hours=9))
NAVER_CHART = "https://api.stock.naver.com/chart"

KR_INDEX = ["KOSPI", "KOSDAQ"]
FUT_YAHOO = {"EScv1": "ES=F", "NQcv1": "NQ=F", "YMcv1": "YM=F"}
LINKED_YAHOO = {code: code.split(".")[0] for code, _, _ in on.KR_LINKED}   # SKHY.O → SKHY, MU.O → MU
LINKED_YAHOO[on.SAMSUNG_GDR[0]] = on.SAMSUNG_GDR[0]

# 1개월 일별: 네이버 경로 (없으면 야후)
NAVER_DAY = {}
for sym, (kind, code) in md.NAVER_MAP.items():
    if kind == "index":
        NAVER_DAY[sym] = f"foreign/index/{code}"
for code in FUT_YAHOO:
    NAVER_DAY[code] = f"foreign/futures/{code}"
for code, _, _ in on.KR_LINKED:
    NAVER_DAY[code] = f"foreign/item/{code}"
NAVER_DAY["EWY"] = "foreign/item/EWY"
for k in KR_INDEX:
    NAVER_DAY[k] = f"domestic/index/{k}"


def all_keys():
    """화면에 그래프를 붙일 모든 키 → 야후 심볼(해외 당일·일별 예비용)"""
    keys = {k: None for k in KR_INDEX}
    for sym, _, _ in md.OVERSEAS:
        keys[sym] = sym
    for code, ysym in FUT_YAHOO.items():
        keys[code] = ysym
    for code, ysym in LINKED_YAHOO.items():
        keys[code] = ysym
    for name, _, _, _ in on.PERPS:
        keys[name] = None
    return keys


# ===== 공통 =====
def thin(points, step_sec=300):
    """분 단위 → step 간격으로 줄이기 (구간의 마지막 값, 마지막 점은 항상 유지)"""
    out, last_bucket = [], None
    for t, v in points:
        b = t // step_sec
        if b == last_bucket:
            out[-1] = [t, v]
        else:
            out.append([t, v])
            last_bucket = b
    return out


def _r(v):
    return round(v, 4) if isinstance(v, float) else v


# ===== 당일 =====
def parse_naver_minute(rows):
    pts = []
    for r in rows or []:
        s, v = r.get("localDateTime"), r.get("currentPrice")
        if not s or v is None:
            continue
        dt = datetime.strptime(s[:12], "%Y%m%d%H%M").replace(tzinfo=KST)
        pts.append([int(dt.timestamp()), float(v)])
    return thin(pts)


def parse_spark_intraday(payload):
    out = {}
    for r in (payload.get("spark") or {}).get("result") or []:
        try:
            resp = r["response"][0]
            ts = resp.get("timestamp") or []
            closes = resp["indicators"]["quote"][0]["close"]
        except (KeyError, IndexError, TypeError):
            continue
        pts = [[t, float(c)] for t, c in zip(ts, closes) if c is not None]
        if pts:
            out[r["symbol"]] = {"intra": pts, "prev": resp.get("meta", {}).get("chartPreviousClose")}
    return out


def yahoo_spark(symbols, rng, interval):
    out = {}
    for i in range(0, len(symbols), 20):
        chunk = ",".join(symbols[i:i + 20])
        url = "https://{h}.finance.yahoo.com/v7/finance/spark?symbols=" + urllib.parse.quote(chunk) + f"&range={rng}&interval={interval}"
        try:
            payload = md.http_json(url.format(h="query1"), retries=1)
        except Exception:
            payload = md.http_json(url.format(h="query2"), retries=1)
        out[i] = payload
    return list(out.values())


def hl_candles(coin, interval, start_ms, end_ms):
    return on.hl_post({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval,
                                                          "startTime": start_ms, "endTime": end_ms}})


def fetch_intraday():
    out, errors = {}, {}
    for k in KR_INDEX:
        try:
            out[k] = {"intra": parse_naver_minute(md.http_json(f"{NAVER_CHART}/domestic/index/{k}/minute"))}
        except Exception as e:
            errors[k] = str(e)[:60]
    ysyms = sorted({y for y in all_keys().values() if y})
    try:
        got = {}
        for payload in yahoo_spark(ysyms, "1d", "5m"):
            got.update(parse_spark_intraday(payload))
        for key, ysym in all_keys().items():
            if ysym and ysym in got:
                out[key] = got[ysym]
    except Exception as e:
        errors["yahoo"] = str(e)[:60]
    now = int(time.time() * 1000)
    for name, _, _, _ in on.PERPS:
        try:
            c = hl_candles(name, "5m", now - 24 * 3600 * 1000, now)
            out[name] = {"intra": [[int(x["t"]) // 1000, float(x["c"])] for x in c], "prev": float(c[0]["o"]) if c else None}
        except Exception as e:
            errors[name] = str(e)[:60]
    if not out:
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return {"series": {k: {"intra": [[t, _r(v)] for t, v in s["intra"]], "prev": _r(s.get("prev"))}
                       for k, s in out.items()}, "errors": errors}


# ===== 1개월 =====
def parse_naver_day(payload, days=24):
    rows = payload.get("priceInfos") if isinstance(payload, dict) else payload
    pts = []
    for r in rows or []:
        d, v = r.get("localDate"), r.get("closePrice")
        if d and v is not None:
            pts.append([f"{d[:4]}-{d[4:6]}-{d[6:8]}", float(v)])
    return pts[-days:]


def fetch_daily():
    out, errors = {}, {}
    keys = all_keys()
    fallback = []
    for key, ysym in keys.items():
        path = NAVER_DAY.get(key)
        if not path:
            if ysym:
                fallback.append(key)
            continue
        try:
            pts = parse_naver_day(md.http_json(f"{NAVER_CHART}/{path}?periodType=dayCandle", retries=1))
            if pts:
                out[key] = pts
            elif ysym:
                fallback.append(key)
        except Exception:
            if ysym:
                fallback.append(key)
    if fallback:
        try:
            ymap = {keys[k]: k for k in fallback}
            for payload in yahoo_spark(sorted(ymap), "1mo", "1d"):
                for r in (payload.get("spark") or {}).get("result") or []:
                    resp = r["response"][0]
                    pts = md._clean_closes(resp.get("timestamp"), resp["indicators"]["quote"][0]["close"],
                                           resp.get("meta", {}).get("gmtoffset"))
                    if pts and r["symbol"] in ymap:
                        out[ymap[r["symbol"]]] = [[d, c] for d, c in pts]
        except Exception as e:
            errors["yahoo"] = str(e)[:60]
    now = int(time.time() * 1000)
    for name, _, _, _ in on.PERPS:
        try:
            c = hl_candles(name, "1d", now - 35 * 86400 * 1000, now)
            out[name] = [[datetime.fromtimestamp(int(x["t"]) // 1000, timezone.utc).strftime("%Y-%m-%d"), float(x["c"])] for x in c][-24:]
        except Exception as e:
            errors[name] = str(e)[:60]
    if not out:
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return {"series": {k: [[d, _r(v)] for d, v in pts] for k, pts in out.items()}, "errors": errors}


def combine(intraday, daily):
    """두 캐시를 화면용 하나로"""
    out = {}
    for k, s in ((intraday or {}).get("series") or {}).items():
        out.setdefault(k, {}).update(s)
    for k, pts in ((daily or {}).get("series") or {}).items():
        out.setdefault(k, {})["day"] = pts
    # 국내 지수 전일 종가 = 일별 시세에서 오늘 이전 마지막 값
    today = datetime.now(KST).strftime("%Y-%m-%d")
    for k in KR_INDEX:
        s = out.get(k) or {}
        if s.get("intra") and s.get("day") and not s.get("prev"):
            past = [v for d, v in s["day"] if d < today]
            if past:
                s["prev"] = past[-1]
    return out


# ===== 예비: 실행마다 현재가를 쌓아 당일 흐름 만들기 (야후가 막힐 때) =====
SAMPLE_HOURS = 30


def current_values(overseas, overnight):
    """이번 실행에서 받은 현재가 → {키: 값}"""
    vals = {}
    for r in (overseas or {}).get("items") or []:
        if r.get("close") is not None:
            vals[r["symbol"]] = r["close"]
    for r in (overnight or {}).get("us_futures") or []:
        if r.get("price") is not None:
            vals[r["code"]] = r["price"]
    for r in (overnight or {}).get("linked") or []:
        if r.get("price") is not None:
            vals[r["code"]] = (r.get("over") or {}).get("price") or r["price"]
    return vals


def update_samples(path, vals, now_ts):
    try:
        samples = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        samples = {}
    cutoff = now_ts - SAMPLE_HOURS * 3600
    for k, v in vals.items():
        pts = [p for p in samples.get(k, []) if p[0] >= cutoff]
        if not pts or pts[-1][1] != v or now_ts - pts[-1][0] >= 600:
            pts.append([now_ts, _r(float(v))])
        samples[k] = pts
    for k in list(samples):
        samples[k] = [p for p in samples[k] if p[0] >= cutoff]
        if not samples[k]:
            del samples[k]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(samples), encoding="utf-8")
    return samples


def fill_from_samples(series, samples):
    """야후 당일 분봉이 없는 키는 쌓아둔 현재가로 (2개 이상일 때)"""
    for k, pts in samples.items():
        s = series.setdefault(k, {})
        if len(s.get("intra") or []) < 2 and len(pts) >= 2:
            s["intra"] = pts
            s["sampled"] = True
            day = s.get("day") or []
            if not s.get("prev") and len(day) >= 2:
                s["prev"] = day[-2][1]
    return series


# ===== 장중 투자자별 누적 순매수 기록 (네이버는 시간대별 자료가 없어 실행마다 기록) =====
def update_flow_samples(path, kr, now_ts):
    """kr = fetch_kr_market 결과 → {지수: {"date", "points": [[ts, 외국인, 기관, 개인]...]}} (그날 것만)"""
    try:
        flows = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        flows = {}
    for code, ix in ((kr or {}).get("indices") or {}).items():
        inv = ix.get("investors") or {}
        if not inv or ix.get("date") is None:
            continue
        rec = flows.get(code)
        if not rec or rec.get("date") != ix["date"]:
            rec = {"date": ix["date"], "points": []}
        row = [now_ts, inv.get("외국인"), inv.get("기관"), inv.get("개인")]
        if not rec["points"] or rec["points"][-1][1:] != row[1:]:
            rec["points"].append(row)
        flows[code] = rec
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(flows, ensure_ascii=False), encoding="utf-8")
    return flows
