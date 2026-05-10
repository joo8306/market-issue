"""
A안: RSS 기반 HOT 시장 이슈 대시보드
- User-Agent 헤더로 403 우회
- 단종 RSS 교체 (Reuters → Yahoo/Investing)
- 한국 휴장일 자동 감지
- DART 공시 옵션 (DART_API_KEY 환경변수 설정 시)
"""

import feedparser
import urllib.request
import json
import html
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ===== User-Agent 설정 (필수) =====
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
feedparser.USER_AGENT = UA

# ===== 뉴스 소스 =====
FEEDS = {
    # 한국
    "한경 증권": ("https://www.hankyung.com/feed/finance", "KR"),
    "한경 경제": ("https://www.hankyung.com/feed/economy", "KR"),
    "한경 국제": ("https://www.hankyung.com/feed/international", "KR"),
    "연합 경제": ("https://www.yna.co.kr/rss/economy.xml", "KR"),
    "연합 증권": ("https://www.yna.co.kr/rss/market.xml", "KR"),
    # 글로벌
    "Yahoo Finance": ("https://finance.yahoo.com/news/rssindex", "GLOBAL"),
    "Investing": ("https://www.investing.com/rss/news.rss", "GLOBAL"),
    "CNBC Top": ("https://www.cnbc.com/id/100003114/device/rss/rss.html", "GLOBAL"),
    "CNBC Markets": ("https://www.cnbc.com/id/10000664/device/rss/rss.html", "GLOBAL"),
    "MarketWatch": ("https://feeds.marketwatch.com/marketwatch/topstories/", "GLOBAL"),
    "WSJ Markets": ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "GLOBAL"),
    "BBC Business": ("http://feeds.bbci.co.uk/news/business/rss.xml", "GLOBAL"),
}

# ===== HOT 키워드 =====
HOT_KEYWORDS_KR = [
    "한국은행", "기준금리", "금통위", "CPI", "물가", "환율", "원달러",
    "공매도", "거래정지", "관리종목", "상장폐지", "공시",
    "감자", "유상증자", "전환사채", "리픽싱", "자사주", "배당",
    "코스피", "코스닥", "외국인",
    "금감원", "금융위", "거래소", "FSC", "FSS",
]

HOT_KEYWORDS_EN = [
    "Fed", "FOMC", "rate cut", "rate hike", "CPI", "PCE", "Powell", "BOJ", "ECB",
    "selloff", "rally", "plunge", "surge", "crash", "halt",
    "risk-off", "VIX", "DXY", "yields",
    "sanctions", "tariff", "ceasefire", "war",
    "guidance", "earnings beat", "earnings miss", "downgrade", "upgrade",
]

LOOKBACK_HOURS = 24


def is_kr_market_open(dt):
    return dt.weekday() < 5


def is_hot(title, summary=""):
    text = (title + " " + summary).lower()
    for kw in HOT_KEYWORDS_KR:
        if kw.lower() in text:
            return kw
    for kw in HOT_KEYWORDS_EN:
        if kw.lower() in text:
            return kw
    return None


def parse_time(entry):
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    return feedparser.parse(data)


def fetch_dart_disclosures():
    api_key = os.getenv("DART_API_KEY")
    if not api_key:
        return []

    today = datetime.now(timezone(timedelta(hours=9))).strftime("%Y%m%d")
    url = f"https://opendart.fss.or.kr/api/list.json?crtfc_key={api_key}&bgn_de={today}&page_count=50"
    
    HOT_DART = ["감자", "유상증자", "전환사채", "자사주", "거래정지", "관리종목"]
    
    items = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        
        for d in data.get("list", []):
            report_nm = d.get("report_nm", "")
            for kw in HOT_DART:
                if kw in report_nm:
                    rcept_dt = d.get("rcept_dt", "")
                    rcept_no = d.get("rcept_no", "")
                    pub = datetime.strptime(rcept_dt, "%Y%m%d").replace(tzinfo=timezone(timedelta(hours=9)))
                    items.append({
                        "source": "DART 공시",
                        "region": "KR",
                        "title": f"[{d.get('corp_name', '')}] {report_nm}",
                        "link": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}",
                        "keyword": kw,
                        "time": pub.isoformat(),
                        "time_ts": pub.timestamp(),
                    })
                    break
    except Exception as e:
        print(f"DART 실패: {e}")
    return items


def fetch_all():
    items = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    
    for source, (url, region) in FEEDS.items():
        try:
            feed = fetch_feed(url)
            for entry in feed.entries[:25]:
                pub = parse_time(entry)
                if pub < cutoff:
                    continue
                title = entry.get("title", "").strip()
                summary = entry.get("summary", "")[:300]
                kw = is_hot(title, summary)
                if not kw:
                    continue
                items.append({
                    "source": source,
                    "region": region,
                    "title": title,
                    "link": entry.get("link", ""),
                    "keyword": kw,
                    "time": pub.isoformat(),
                    "time_ts": pub.timestamp(),
                })
            print(f"  {source}: {len(feed.entries)}건 수집")
        except Exception as e:
            print(f"  {source}: 실패 ({str(e)[:50]})")
    
    dart_items = fetch_dart_disclosures()
    if dart_items:
        items.extend(dart_items)
        print(f"  DART 공시: {len(dart_items)}건")
    
    seen = set()
    unique = []
    for it in sorted(items, key=lambda x: x["time_ts"], reverse=True):
        if it["title"] in seen:
            continue
        seen.add(it["title"])
        unique.append(it)
    return unique


def generate_html(items):
    kst = timezone(timedelta(hours=9))
    now_kst_dt = datetime.now(kst)
    now_kst = now_kst_dt.strftime("%Y-%m-%d %H:%M KST")
    
    market_open = is_kr_market_open(now_kst_dt)
    
    kr_items = [i for i in items if i["region"] == "KR"]
    global_items = [i for i in items if i["region"] == "GLOBAL"]
    
    def render_row(it):
        t = datetime.fromisoformat(it["time"]).astimezone(kst)
        time_str = t.strftime("%m-%d %H:%M")
        return f"""
        <a class="row" href="{html.escape(it['link'])}" target="_blank" rel="noopener">
          <div class="row-time">{time_str}</div>
          <div class="row-content">
            <div class="row-title">{html.escape(it['title'])}</div>
            <div class="row-meta">
              <span class="kw">{html.escape(it['keyword'])}</span>
              <span class="src">{html.escape(it['source'])}</span>
            </div>
          </div>
        </a>"""
    
    kr_html = "\n".join(render_row(i) for i in kr_items) or '<div class="empty">최근 24시간 내 HOT 이슈 없음</div>'
    global_html = "\n".join(render_row(i) for i in global_items) or '<div class="empty">최근 24시간 내 HOT 이슈 없음</div>'
    
    notice_html = ""
    if not market_open:
        notice_html = """
        <div class="notice">
          <strong>NOTICE</strong> 한국 증시 휴장일 — 글로벌 시장 동향 위주로 표시됩니다
        </div>"""
    
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HOT MARKET ISSUES — {now_kst}</title>
<meta property="og:title" content="HOT MARKET ISSUES">
<meta property="og:description" content="한국+글로벌 주요 시장 이슈 ({now_kst})">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {{
  --bg: #0a0a0a; --bg-card: #121212; --border: #1f1f1f;
  --text: #e8e8e8; --text-dim: #888; --text-faint: #555;
  --accent: #ff8c00; --kr: #ff5555; --global: #5599ff;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  background: var(--bg); color: var(--text);
  font-family: 'IBM Plex Sans KR', 'JetBrains Mono', sans-serif;
  font-size: 14px; line-height: 1.5; min-height: 100vh;
  padding: 20px 16px 60px;
}}
.container {{ max-width: 900px; margin: 0 auto; }}
.header {{
  border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px;
  display: flex; justify-content: space-between; align-items: flex-end;
  flex-wrap: wrap; gap: 12px;
}}
.title {{ font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }}
.title .blink {{ color: var(--accent); animation: blink 1.5s infinite; }}
@keyframes blink {{ 0%, 50% {{ opacity: 1; }} 51%, 100% {{ opacity: 0.3; }} }}
.timestamp {{ font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim); }}
.timestamp .label {{ color: var(--text-faint); }}
.notice {{
  background: #1a1a1a; border-left: 3px solid var(--accent);
  padding: 10px 14px; margin-bottom: 16px;
  font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim);
}}
.notice strong {{ color: var(--accent); margin-right: 8px; }}
.stats {{
  display: flex; gap: 24px; font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: var(--text-dim); margin-bottom: 24px;
  padding: 12px 16px; background: var(--bg-card); border: 1px solid var(--border);
}}
.stats .num {{ color: var(--accent); font-weight: 700; }}
.section {{ margin-bottom: 32px; }}
.section-header {{
  display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
  padding-bottom: 8px; border-bottom: 1px dashed var(--border);
}}
.section-tag {{
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
  letter-spacing: 1px; padding: 3px 8px; border: 1px solid;
}}
.tag-kr {{ color: var(--kr); border-color: var(--kr); }}
.tag-global {{ color: var(--global); border-color: var(--global); }}
.section-title {{ font-size: 13px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; }}
.section-count {{ margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-faint); }}
.row {{
  display: flex; gap: 16px; padding: 12px 14px; border-bottom: 1px solid var(--border);
  text-decoration: none; color: inherit; transition: background 0.15s;
}}
.row:hover {{ background: var(--bg-card); }}
.row-time {{
  font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-faint);
  flex-shrink: 0; width: 80px; padding-top: 2px;
}}
.row-content {{ flex: 1; min-width: 0; }}
.row-title {{ font-size: 14px; font-weight: 500; line-height: 1.45; margin-bottom: 4px; }}
.row-meta {{ display: flex; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; }}
.kw {{ color: var(--accent); font-weight: 700; }}
.kw::before {{ content: "● "; }}
.src {{ color: var(--text-faint); }}
.src::before {{ content: "/ "; }}
.empty {{
  padding: 24px; text-align: center; color: var(--text-faint);
  font-family: 'JetBrains Mono', monospace; font-size: 12px; border: 1px dashed var(--border);
}}
.footer {{
  margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-faint);
  text-align: center; line-height: 1.7;
}}
@media (max-width: 600px) {{
  body {{ font-size: 13px; padding: 16px 12px 40px; }}
  .title {{ font-size: 18px; }}
  .row {{ flex-direction: column; gap: 4px; padding: 10px 12px; }}
  .row-time {{ width: auto; font-size: 11px; }}
  .stats {{ gap: 14px; flex-wrap: wrap; }}
}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="title"><span class="blink">●</span> HOT_ISSUES</div>
    <div class="timestamp"><span class="label">UPDATED:</span> {now_kst}</div>
  </div>
  {notice_html}
  <div class="stats">
    <div><span class="label">총 이슈</span> <span class="num">{len(items)}</span></div>
    <div><span class="label">한국</span> <span class="num">{len(kr_items)}</span></div>
    <div><span class="label">글로벌</span> <span class="num">{len(global_items)}</span></div>
    <div><span class="label">조회 범위</span> <span class="num">{LOOKBACK_HOURS}H</span></div>
  </div>
  <div class="section">
    <div class="section-header">
      <span class="section-tag tag-kr">KR</span>
      <span class="section-title">한국 시장</span>
      <span class="section-count">{len(kr_items)} items</span>
    </div>
    {kr_html}
  </div>
  <div class="section">
    <div class="section-header">
      <span class="section-tag tag-global">GLOBAL</span>
      <span class="section-title">해외 시장 / 매크로</span>
      <span class="section-count">{len(global_items)} items</span>
    </div>
    {global_html}
  </div>
  <div class="footer">
    소스: 한경 · 연합 · Yahoo Finance · Investing · CNBC · MarketWatch · WSJ · BBC · DART(옵션)<br>
    HOT 키워드 매칭 / 최근 {LOOKBACK_HOURS}시간 / GitHub Actions 자동 갱신
  </div>
</div>
</body>
</html>"""


def main():
    items = fetch_all()
    print(f"\n총 HOT 이슈: {len(items)}건")
    
    out_dir = Path("dist")
    out_dir.mkdir(exist_ok=True)
    
    (out_dir / "index.html").write_text(generate_html(items), encoding="utf-8")
    (out_dir / "data.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("HTML 생성 완료: dist/index.html")


if __name__ == "__main__":
    main()
