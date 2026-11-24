"""
뉴스 외 추가 데이터 빌드: 시황(국내·해외) · 증권사 전망 · WFE 통계
- 소스별로 캐시(.state/*.json)를 두고 정해진 주기가 지났을 때만 다시 받음
- 수집에 실패하면 마지막 성공 데이터를 그대로 쓰고 오류를 표시 (대시보드는 계속 배포)
결과: dist/market.json, dist/targets.json, dist/wfe.json
"""

import json
import time
from datetime import datetime
from pathlib import Path

import briefing
import charts
import marketdata
import overnight
import targets
import wfe_country

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = ROOT / ".state"


def kr_refresh_sec(now_kst):
    """장중·마감 직후는 5분, 그 외 시간은 3시간"""
    minutes = now_kst.hour * 60 + now_kst.minute
    if now_kst.weekday() < 5 and 8 * 60 + 30 <= minutes <= 18 * 60 + 30:
        return 4 * 60
    return 3 * 3600


def overseas_refresh_sec(now_kst):
    """美 장 마감 직후(05~10시)는 매 실행마다, 그 외에는 15분"""
    return 4 * 60 if 5 <= now_kst.hour < 10 else 15 * 60


SOURCES = {
    # 이름: (수집 함수, 갱신 주기(초) 또는 함수)
    "market_kr": (marketdata.fetch_kr_market, kr_refresh_sec),
    "market_overseas": (marketdata.fetch_overseas, overseas_refresh_sec),
    "overnight": (overnight.fetch_overnight, 4 * 60),   # 야간·주말 지표 (매 실행마다)
    "charts_intraday": (charts.fetch_intraday, 4 * 60),   # 시황 그래프: 당일 흐름
    "charts_daily": (charts.fetch_daily, 6 * 3600),        # 시황 그래프: 1개월 일별
    "kospi_history": (lambda: marketdata.fetch_kospi_history(pages=4), 6 * 3600),
    "wfe_country": (wfe_country.build, 24 * 3600),  # WFE 여러 호 + 유로넥스트 → 국가별
}


def cached(name, fetch, max_age, state_dir, now_ts):
    """(data, info) — info: {fetched_ts, ok, error, from_cache}"""
    path = state_dir / f"{name}.json"
    old = None
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    if old and now_ts - old.get("fetched_ts", 0) < max_age:
        return old["data"], {"fetched_ts": old["fetched_ts"], "ok": True, "from_cache": True}
    try:
        data = fetch()
        state_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"fetched_ts": now_ts, "data": data}, ensure_ascii=False), encoding="utf-8")
        print(f"  {name}: 갱신")
        return data, {"fetched_ts": now_ts, "ok": True, "from_cache": False}
    except Exception as e:
        print(f"  {name}: 실패 ({str(e)[:100]})" + (" → 이전 데이터 사용" if old else ""))
        info = {"ok": False, "error": str(e)[:120], "from_cache": bool(old)}
        if old:
            info["fetched_ts"] = old.get("fetched_ts")
            return old["data"], info
        return None, info


def build_extras(out_dir, state_dir=STATE_DIR, now=None, sources=SOURCES, targets_csv=targets.CSV_PATH,
                 targets_meta=targets.META_PATH):
    now = now or datetime.now(marketdata.KST)
    now_ts = int(now.timestamp())
    got, status = {}, {}
    for name, (fetch, age) in sources.items():
        max_age = age(now) if callable(age) else age
        got[name], status[name] = cached(name, fetch, max_age, state_dir, now_ts)

    # 시황 (+ 문자 초안)
    kr, ov = got.get("market_kr"), got.get("market_overseas")
    market = {
        "generated_ts": now_ts,
        "status": {k: status[k] for k in ("market_kr", "market_overseas", "overnight") if k in status},
        "kr": kr,
        "overseas": ov,
        "overnight": got.get("overnight"),
        "drafts": {
            "closing": briefing.closing_draft(kr) if kr else None,
            "overnight": briefing.overnight_draft(ov) if ov else None,
        },
    }
    _write(out_dir / "market.json", market)

    # 시황 그래프 (당일·1개월). 야후 분봉이 막히면 실행마다 쌓은 현재가로 대신
    try:
        series = charts.combine(got.get("charts_intraday"), got.get("charts_daily"))
        if "charts_intraday" in sources:
            samples = charts.update_samples(state_dir / "intraday_samples.json",
                                            charts.current_values(ov, got.get("overnight")), now_ts)
            charts.fill_from_samples(series, samples)
        _write(out_dir / "charts.json", {"generated_ts": now_ts, "series": series})
    except Exception as e:
        print(f"  charts: 실패 ({str(e)[:100]})")

    # 증권사 전망
    tp = targets.build_payload(targets.load_rows(targets_csv), got.get("kospi_history"), now.date(),
                               targets.load_meta(targets_meta))
    tp["generated_ts"] = now_ts
    tp["status"] = status.get("kospi_history")
    # '현재 대비'는 시황 화면과 같은 코스피 현재가(장중 5분마다 갱신)로 계산
    k = ((kr or {}).get("indices") or {}).get("KOSPI") or {}
    if k.get("close"):
        tp["kospi_now"] = {"close": k["close"], "date": k.get("date"), "status": k.get("status"),
                           "pct": k.get("pct"), "ts": (status.get("market_kr") or {}).get("fetched_ts")}
    _write(out_dir / "targets.json", tp)

    # WFE
    w = dict(got.get("wfe_country") or {})
    w["generated_ts"] = now_ts
    w["status"] = status.get("wfe_country")
    _write(out_dir / "wfe.json", w)

    return market, tp, w


def _write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    t = time.time()
    build_extras(out)
    print(f"완료 ({time.time() - t:.1f}s)")
