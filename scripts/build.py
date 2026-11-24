"""
HOT 시장 이슈 수집 → PWA 대시보드 빌드
- 한국/글로벌 RSS 병렬 수집 (구글뉴스 경유 Reuters·Bloomberg·AP 포함)
- 카테고리별 키워드 매칭 + 긴급 이슈 분류
- 유료 기사 필터링, 매체 간 중복 기사 제거
- DART 공시 옵션 (DART_API_KEY 환경변수 설정 시)
- 결과: dist/ (index.html, data.json, PWA 파일)
"""

import hashlib
import html
import json
import os
import re
import shutil
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

import feedparser

import config

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
feedparser.USER_AGENT = UA

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
OUT_DIR = ROOT / "dist"


# ===== 키워드 매칭 =====
def _en_pattern(kw):
    # 단어 단위 매칭: "war" 가 "software"/"warn" 에 걸리지 않도록.
    # 짧은 약어(AI, Fed 등)는 복수형만 허용 ("AI"+"d" = "aid" 방지)
    suffix = "(?:s)?" if len(kw) <= 3 else "(?:s|es|ed|d|ing)?"
    return re.compile(r"\b" + re.escape(kw) + suffix + r"\b", re.IGNORECASE)


EN_MATCHERS = [(cat, kw, _en_pattern(kw)) for cat, kws in config.KEYWORDS_EN.items() for kw in kws]
KR_MATCHERS = [(cat, kw) for cat, kws in config.KEYWORDS_KR.items() for kw in kws]
URGENT_EN = [_en_pattern(kw) for kw in config.URGENT_EN]


def classify(title, summary="", region="GLOBAL"):
    """(category, keyword) 반환. HOT 아니면 None"""
    text = f"{title} {summary}"
    lower = text.lower()
    kr_hit = next(((c, k) for c, k in KR_MATCHERS if k.lower() in lower), None)
    en_hit = next(((c, k) for c, k, p in EN_MATCHERS if p.search(text)), None)
    # 소스 지역 언어의 매칭을 우선
    if region == "KR":
        return kr_hit or en_hit
    return en_hit or kr_hit


def is_urgent(title):
    if any(k in title for k in config.URGENT_KR):
        return True
    return any(p.search(title) for p in URGENT_EN)


def is_paid_article(link, title):
    """유료/구독 전용 기사 필터링"""
    # 한경 프리미엄 (URL 끝에 알파벳)
    if "hankyung.com/article/" in link:
        article_id = link.rstrip("/").split("/")[-1]
        if article_id and not article_id.isdigit():
            return True
    # 한경 마켓PRO 시리즈 (제목 기반)
    paid_markers = ["[마켓PRO]", "[프리미엄]", "[한경 코리아마켓]"]
    return any(m in title for m in paid_markers)


# ===== 중복 제거용 정규화 =====
def split_publisher(title):
    """구글뉴스 제목 'Headline - Reuters' → ('Headline', 'Reuters')"""
    m = re.match(r"^(.*\S)\s+[-–—|]\s+([^-–—|]{2,40})$", title)
    if m:
        return m.group(1), m.group(2).strip()
    return title, None


def normalize_title(title):
    t = split_publisher(title)[0].lower()
    t = re.sub(r"[\[\(【<].*?[\]\)】>]", " ", t)  # [속보], (종합) 등 말머리 제거
    t = re.sub(r"[^0-9a-z가-힣]+", "", t)
    return t[:60]


def item_id(title):
    return hashlib.sha1(normalize_title(title).encode("utf-8")).hexdigest()[:12]


# ===== 수집 =====
TZ_RE = re.compile(r"(?:[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|Z|EST|EDT|CST|CDT|PST|PDT|KST)\b|\dZ)\s*$", re.IGNORECASE)


def parse_time(entry, region="GLOBAL", now=None):
    """기사 시각(UTC). 한국 매체가 시간대 없이 '2026-11-24 06:30:00'처럼 주면 KST로 봄
    (feedparser 는 시간대가 없으면 UTC로 읽어서 9시간 미래로 밀림)"""
    for key in ("published", "updated"):
        t = entry.get(key + "_parsed")
        if not t:
            continue
        pub = datetime(*t[:6], tzinfo=timezone.utc)
        raw = (entry.get(key) or "").strip()
        if region == "KR" and raw and not TZ_RE.search(raw):
            pub -= timedelta(hours=9)
        # 그래도 미래면(매체가 KST를 UTC로 잘못 표기) 한국 매체는 9시간 당기고, 아니면 수집 시각으로
        now = now or datetime.now(timezone.utc)
        if pub > now + timedelta(minutes=10):
            if region == "KR" and pub - timedelta(hours=9) <= now + timedelta(minutes=10):
                pub -= timedelta(hours=9)
            else:
                pub = now
        return pub
    return None


def safe_url(url):
    """한글 검색어 등 ASCII 가 아닌 글자를 %인코딩 (그대로 두면 'ascii' codec 오류로 수집 실패)"""
    return urllib.parse.quote(url, safe="%/:=&?~#+!$,;'@()*[]")


def fetch_feed(url):
    req = urllib.request.Request(safe_url(url), headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    return feedparser.parse(data)


def collect_source(source, url, region, opts, cutoff, now):
    """한 소스 수집 → (items, health)"""
    items = []
    try:
        feed = fetch_feed(url)
        entries = feed.entries[: opts.get("limit", config.DEFAULT_FEED_LIMIT)]
        for entry in entries:
            pub = parse_time(entry, region, now)
            if pub is None:
                pub = now  # 날짜 없는 기사는 수집 시각으로
            if pub < cutoff:
                continue
            title = html.unescape(entry.get("title", "")).strip()
            if not title:
                continue
            link = entry.get("link", "")
            if is_paid_article(link, title):
                continue
            summary = re.sub(r"<[^>]+>", " ", entry.get("summary", ""))[:300]

            if opts.get("take_all"):
                hit = (opts.get("category", "기타"), source)
            else:
                hit = classify(title, summary, region)
            if not hit:
                continue

            headline, publisher = split_publisher(title) if "news.google.com" in url else (title, None)
            src_meta = entry.get("source") or {}
            publisher = src_meta.get("title") or publisher
            items.append({
                "id": item_id(title),
                "source": source,
                "publisher": publisher,
                "region": region,
                "category": hit[0],
                "keyword": hit[1],
                "urgent": bool(opts.get("urgent")) or is_urgent(headline),
                "title": headline,
                "link": link,
                "time": pub.isoformat(),
                "time_ts": int(pub.timestamp()),
            })
        health = {"name": source, "region": region, "ok": True,
                  "entries": len(feed.entries), "hot": len(items)}
        if not feed.entries:
            health["ok"] = False
            health["error"] = "빈 피드"
        print(f"  {source}: {len(feed.entries)}건 중 {len(items)}건 HOT")
    except Exception as e:
        health = {"name": source, "region": region, "ok": False, "entries": 0, "hot": 0,
                  "error": str(e)[:80]}
        print(f"  {source}: 실패 ({str(e)[:80]})")
    return items, health


def fetch_dart_disclosures():
    api_key = os.getenv("DART_API_KEY")
    if not api_key:
        return [], None

    today = datetime.now(KST).strftime("%Y%m%d")
    url = f"https://opendart.fss.or.kr/api/list.json?crtfc_key={api_key}&bgn_de={today}&page_count=100"

    items = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        for d in data.get("list", []):
            report_nm = d.get("report_nm", "")
            kw = next((k for k in config.DART_KEYWORDS if k in report_nm), None)
            if not kw:
                continue
            rcept_no = d.get("rcept_no", "")
            pub = datetime.strptime(d.get("rcept_dt", today), "%Y%m%d").replace(tzinfo=KST)
            title = f"[{d.get('corp_name', '')}] {report_nm}"
            items.append({
                "id": item_id(title + rcept_no),
                "source": "DART 공시",
                "publisher": None,
                "region": "KR",
                "category": "기업이벤트",
                "keyword": kw,
                "urgent": kw in ("거래정지", "상장폐지"),
                "title": title,
                "link": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}",
                "time": pub.isoformat(),
                "time_ts": int(pub.timestamp()),
            })
        print(f"  DART 공시: {len(items)}건")
        return items, {"name": "DART 공시", "region": "KR", "ok": True,
                       "entries": len(data.get("list", [])), "hot": len(items)}
    except Exception as e:
        print(f"  DART 실패: {e}")
        return [], {"name": "DART 공시", "region": "KR", "ok": False, "entries": 0, "hot": 0,
                    "error": str(e)[:80]}


def dedupe(items):
    """같은 기사(정규화 제목 기준)는 가장 먼저 보도된 것 하나만 남기고, 보도 매체 수를 기록"""
    by_id = {}
    for it in sorted(items, key=lambda x: x["time_ts"]):
        if it["id"] in by_id:
            kept = by_id[it["id"]]
            kept["also"] = sorted(set(kept.get("also", [])) | {it["source"]})
            kept["urgent"] = kept["urgent"] or it["urgent"]
        else:
            by_id[it["id"]] = it
    return sorted(by_id.values(), key=lambda x: x["time_ts"], reverse=True)


def fetch_all():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=config.LOOKBACK_HOURS)

    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(collect_source, name, url, region, opts, cutoff, now)
                   for name, (url, region, opts) in config.FEEDS.items()]
        results = [f.result() for f in futures]

    items, health = [], []
    for its, h in results:
        items.extend(its)
        health.append(h)

    dart_items, dart_health = fetch_dart_disclosures()
    items.extend(dart_items)
    if dart_health:
        health.append(dart_health)

    return dedupe(items), health


# ===== 사이트 생성 =====
def asset_version():
    """웹 자산이 바뀔 때만 서비스워커 캐시를 갱신하도록 내용 해시 사용"""
    h = hashlib.sha1()
    for p in sorted(WEB_DIR.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(WEB_DIR).as_posix().encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:10]


def build_site(payload, out_dir=OUT_DIR):
    if out_dir.exists():
        shutil.rmtree(out_dir)
    shutil.copytree(WEB_DIR, out_dir)

    data_json = json.dumps(payload, ensure_ascii=False)
    (out_dir / "data.json").write_text(data_json, encoding="utf-8")

    # 첫 화면을 바로 그리기 위해 index.html 에 데이터를 인라인으로 삽입
    index = out_dir / "index.html"
    inline = data_json.replace("</", "<\\/")
    index.write_text(
        index.read_text(encoding="utf-8").replace("/*__INITIAL_DATA__*/null", inline),
        encoding="utf-8",
    )

    sw = out_dir / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__VERSION__", asset_version()),
                  encoding="utf-8")


def main():
    print("수집 시작")
    items, health = fetch_all()
    # 해외 뉴스 영문 제목 → 한글 번역 (실패해도 영문 그대로 진행)
    try:
        import translate
        n, engine, err = translate.apply_translations(items)
        print(f"  제목 번역({engine}): 새로 {n}건" + (f" · 오류: {err}" if err else ""))
    except Exception as e:
        print(f"  제목 번역 건너뜀: {str(e)[:100]}")
    now = datetime.now(timezone.utc)
    payload = {
        "generated_at": now.isoformat(),
        "generated_ts": int(now.timestamp()),
        "lookback_hours": config.LOOKBACK_HOURS,
        "kr_holidays": config.KR_HOLIDAYS,
        "sources": health,
        "items": items,
    }
    build_site(payload)

    # 시황 · 증권사 전망 · WFE 통계 (실패해도 뉴스 대시보드 배포는 계속)
    print("\n추가 데이터")
    try:
        import extras
        extras.build_extras(OUT_DIR)
    except Exception as e:
        print(f"  추가 데이터 빌드 실패: {e}")

    ok = sum(1 for h in health if h["ok"])
    kr = sum(1 for i in items if i["region"] == "KR")
    print(f"\n총 HOT 이슈 {len(items)}건 (한국 {kr} / 글로벌 {len(items) - kr}), "
          f"긴급 {sum(1 for i in items if i['urgent'])}건, 소스 {ok}/{len(health)} 정상")
    print(f"빌드 완료: {OUT_DIR}")


if __name__ == "__main__":
    main()
