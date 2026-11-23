"""
시황문자 초안 생성 (사내 문체 규칙 반영)
- 숫자로 판단할 수 있는 부분(방향, N%대, 출발/전환, 수급 주체, 낙폭 축소 등)은 자동으로 채움
- 원인(재료)과 업종은 데이터로 알 수 없으므로 [출발 재료] 같은 빈칸으로 남김
- 문체: 개조식 "- " 시작, 명사형 종결, 마침표 없음, 급락·폭락 같은 표현 쓰지 않음
"""

import html
from datetime import datetime

import marketdata as md

WEEKDAY = "월화수목금토일"


# ===== 숫자 표기 =====
def fmt_pct(p, digits=1):
    """+1.2% / -0.0% (음수는 반올림해도 - 부호 유지)"""
    if p is None:
        return "-"
    s = f"{abs(p):.{digits}f}"
    sign = "-" if p < 0 else "+"
    return f"{sign}{s}%"


def fmt_num(v, digits=2):
    if v is None:
        return "-"
    return f"{v:,.{digits}f}"


def fmt_eok(v):
    if v is None:
        return "-"
    return f"{v:+,.0f}"


def mmdd(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{d.month}/{d.day}"


def day_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{d.month}/{d.day}({WEEKDAY[d.weekday()]})"


def sign(p):
    if p is None:
        return None
    return 1 if p > 0 else (-1 if p < 0 else 0)


def dae(p):
    """2% 이상이면 'N%대 ', 아니면 ''"""
    return f"{int(abs(p))}%대 " if p is not None and abs(p) >= 2 else ""


# ===== 방향 판정 =====
def us_close_phrase(pcts):
    s = [sign(p) for p in pcts]
    if all(x == 1 for x in s):
        return "3대지수 모두 상승 마감", "상승"
    if all(x == -1 for x in s):
        return "3대지수 모두 하락 마감", "하락"
    return "혼조 마감", "혼조"


def eu_close_phrase(pcts):
    # -0.0% 도 하락으로 봄 → 원값의 부호로 판정
    s = [sign(p) for p in pcts]
    if all(x == 1 for x in s):
        return "일제히 상승 마감", "상승"
    if all(x == -1 for x in s):
        return "일제히 하락 마감", "하락"
    return "혼조 마감", "혼조"


def open_word(pcts):
    s = [sign(p) for p in pcts if p is not None]
    if not s or len(s) < len(pcts):
        return None
    if all(x == 1 for x in s):
        return "상승"
    if all(x == -1 for x in s):
        return "하락"
    return "혼조"


# ===== 해외시황 =====
def overnight_draft(data):
    items = {r["symbol"]: r for r in data.get("items", [])}
    us = [items.get(s) for s in md.US_MAIN]
    if not all(r and r.get("close") is not None for r in us):
        return None
    us_date = us[0]["date"]
    # 유럽은 美 거래일과 같은 날의 종가로 맞춤 (오후에 열면 유럽 장중 값이 섞이지 않도록)
    eu = [(md.row_on(items[s], us_date) if items.get(s) else None) for s in md.EU_MAIN]

    us_pcts = [r["pct"] for r in us]
    us_close, us_word = us_close_phrase(us_pcts)
    us_open = open_word([r.get("open_pct") for r in us])

    if us_open and us_open in ("상승", "하락") and us_word in ("상승", "하락") and us_open != us_word:
        line1 = f"- [출발 재료] 등 영향으로 {us_open} 출발하였으나,"
        line2 = f"- 장중 [장중·마감 재료] 등으로 {us_word} 전환하며 {us_close}"
    else:
        line1 = f"- [출발 재료] 등 영향으로 {us_open or '[상승/하락/혼조]'} 출발"
        line2 = f"- [장중·마감 재료] 등으로 {us_close}"

    lines = ["○ 美 증시", line1, line2]
    eu_ok = all(r and r.get("close") is not None for r in eu)
    if eu_ok:
        eu_pcts = [r["pct"] for r in eu]
        eu_close, eu_word = eu_close_phrase(eu_pcts)
        lines += ["", "○ 유럽증시", f"- 유럽증시는 [재료] 등 영향으로 {eu_close}"]

    summary = (f"[{mmdd(us_date)}] 美 {us_word}(Dow {fmt_pct(us_pcts[0])}, NASDAQ {fmt_pct(us_pcts[1])}, "
               f"S&P {fmt_pct(us_pcts[2])})")
    if eu_ok:
        summary += (f" / 유럽 {eu_word}(FTSE {fmt_pct(eu_pcts[0])}, CAC {fmt_pct(eu_pcts[1])}, "
                    f"DAX {fmt_pct(eu_pcts[2])})")

    checks = []
    for r in data.get("items", []):
        if r.get("close") is None:
            checks.append((r["name"], "-", r.get("error", "데이터 없음")))
            continue
        digits = 3 if r["symbol"] == "^TNX" else 2
        val = fmt_num(r["close"], digits) + ("%" if r["symbol"] == "^TNX" else "")
        if r["symbol"] == "^TNX" and r.get("prev") is not None:
            chg = f"{(r['close'] - r['prev']) * 100:+.1f}bp"
        else:
            chg = fmt_pct(r.get("pct"), 2)
        if r.get("open_pct") is not None:
            chg += f" (시가 {fmt_pct(r['open_pct'])}"
            if r.get("low_pct") is not None and r.get("high_pct") is not None:
                chg += f", 장중 {fmt_pct(r['low_pct'])}~{fmt_pct(r['high_pct'])}"
            chg += ")"
        if r.get("date") and r["date"] != us_date:
            chg += f" ({mmdd(r['date'])} 기준)"
        checks.append((r["name"], val, chg))

    return {
        "kind": "overnight",
        "date": us_date,
        "title": f"해외시황 초안 · {day_label(us_date)} 美 장",
        "summary": summary,
        "copy": "\n".join(lines),
        "checks": checks,
    }


# ===== 국내 마감시황 =====
def _parties(investors, want_sign):
    """순매수(+) 또는 순매도(-) 주체를 규모 순으로. 가장 큰 주체의 30% 미만은 제외"""
    rows = [(k, v) for k, v in investors.items() if k in ("외국인", "기관", "개인") and v]
    rows = [(k, v) for k, v in rows if (v > 0) == (want_sign > 0)]
    if not rows:
        return None
    rows.sort(key=lambda x: abs(x[1]), reverse=True)
    top = abs(rows[0][1])
    return " 및 ".join(k for k, v in rows if abs(v) >= top * 0.3)


def intraday_change(ix):
    """장중 흐름 변화: 낙폭 축소/확대, 상승폭 축소/확대 (1%p 이상 차이일 때만)"""
    p, lo, hi, op = ix.get("pct"), ix.get("low_pct"), ix.get("high_pct"), ix.get("open_pct")
    if p is None or lo is None or hi is None:
        return None
    if p < 0:
        if p - lo >= 1.0:
            return "낙폭 축소"
        if op is not None and op - p >= 1.0:
            return "낙폭 확대"
    elif p > 0:
        if hi - p >= 1.0:
            return "상승폭 축소"
        if op is not None and p - op >= 1.0:
            return "상승폭 확대"
    return None


def kr_lines(ix, main=True):
    p, op = ix["pct"], ix.get("open_pct")
    close_word = "상승" if p > 0 else ("하락" if p < 0 else "보합")
    open_w = None if op is None else ("상승" if op > 0 else ("하락" if op < 0 else "보합"))
    inv = ix.get("investors") or {}
    buyers, sellers = _parties(inv, +1), _parties(inv, -1)
    change = intraday_change(ix)
    result = f"{dae(p)}{close_word} 마감"

    # 출발과 마감 방향이 다른 날
    if open_w in ("상승", "하락") and close_word in ("상승", "하락") and open_w != close_word:
        who = buyers if close_word == "상승" else sellers
        flow = (f"{who} 매수세 유입되며" if close_word == "상승" else f"{who} 매도세 출회되며") if who else "[수급]"
        return [f"- [출발 재료] 등 영향으로 {open_w} 출발하였으나,",
                f"- [장중 재료] 등으로 [업종] 업종 중심 {flow} {close_word} 전환 마감"]

    first = f"- [출발 재료] 등 영향으로 {open_w or '[상승/하락]'} 출발"
    if change == "낙폭 축소" and sellers and buyers:
        second = (f"- 장중 [업종] 업종 중심 {sellers} 매도세 지속된 가운데, "
                  f"{buyers} 중심 저가매수세 유입으로 낙폭 축소되며 {result}")
    elif change == "상승폭 축소" and sellers and buyers:
        second = (f"- 장중 [업종] 업종 중심 {buyers} 매수세 지속된 가운데, "
                  f"{sellers} 매도세 출회로 상승폭 축소되며 {result}")
    elif p < 0:
        who = sellers or "[수급]"
        flow = f"{who} 매도세 출회로 낙폭 확대되며" if change == "낙폭 확대" else f"{who} 매도세 출회되며"
        second = f"- [장중 재료] 등으로 [업종] 업종 중심 {flow} {result}"
    else:
        who = buyers or "[수급]"
        flow = f"{who} 매수세 유입으로 상승폭 확대되며" if change == "상승폭 확대" else f"{who} 매수세 유입되며"
        second = f"- [장중 재료] 등으로 [업종] 업종 중심 {flow} {result}"

    if main:
        return [first, second]
    # 코스닥은 재료가 뚜렷하지 않으면 1줄
    body = second[2:]
    if body.startswith("장중 "):
        body = body[3:]
    body = body.replace("[장중 재료] 등으로 ", "")
    return [f"- [재료] 등 영향으로 {body}"]


def closing_draft(data):
    idx = data.get("indices") or {}
    kospi, kosdaq = idx.get("KOSPI"), idx.get("KOSDAQ")
    if not kospi or kospi.get("pct") is None:
        return None

    lines = ["○ KOSPI"] + kr_lines(kospi, main=True)
    if kosdaq and kosdaq.get("pct") is not None:
        lines += ["", "○ KOSDAQ :"] + kr_lines(kosdaq, main=False)

    inv = kospi.get("investors") or {}
    summary = f"[{mmdd(kospi['date'])}] KOSPI {fmt_pct(kospi['pct'])}"
    if kosdaq and kosdaq.get("pct") is not None:
        summary += f", KOSDAQ {fmt_pct(kosdaq['pct'])}"
    summary += (f" / 수급 KOSPI 외국인 {fmt_eok(inv.get('외국인'))}, 기관 {fmt_eok(inv.get('기관'))}, "
                f"개인 {fmt_eok(inv.get('개인'))} (억원)")

    checks = []
    for ix in (kospi, kosdaq):
        if not ix or ix.get("close") is None:
            continue
        n = ix["code"]
        checks.append((n, fmt_num(ix["close"]), f"{ix['change']:+,.2f} ({fmt_pct(ix['pct'], 2)})"))
        checks.append((f"{n} 시가·고가·저가",
                       f"{fmt_pct(ix.get('open_pct'))} / {fmt_pct(ix.get('high_pct'))} / {fmt_pct(ix.get('low_pct'))}",
                       "전일 종가 대비"))
        iv = ix.get("investors") or {}
        checks.append((f"{n} 수급(억원)",
                       f"외국인 {fmt_eok(iv.get('외국인'))} · 기관 {fmt_eok(iv.get('기관'))} · 개인 {fmt_eok(iv.get('개인'))}",
                       ""))
        pg = ix.get("program") or {}
        if pg.get("전체") is not None:
            checks.append((f"{n} 프로그램(억원)",
                           f"차익 {fmt_eok(pg.get('차익'))} · 비차익 {fmt_eok(pg.get('비차익'))}", ""))
        b = ix.get("breadth") or {}
        if b.get("상승") is not None:
            checks.append((f"{n} 종목 수",
                           f"상승 {b['상승']:.0f}(상한 {b.get('상한') or 0:.0f}) · 하락 {b['하락']:.0f}"
                           f"(하한 {b.get('하한') or 0:.0f}) · 보합 {b.get('보합') or 0:.0f}", ""))
        if ix.get("value_eok") is not None:
            checks.append((f"{n} 거래대금", f"{ix['value_eok']:,.0f}억원", ""))

    movers = [f"{s['name']} {fmt_pct(s['pct'])}" for s in (data.get("top_mcap") or {}).get("KOSPI", [])[:10]
              if s.get("pct") is not None]

    return {
        "kind": "closing",
        "date": kospi["date"],
        "title": f"국내 마감시황 초안 · {day_label(kospi['date'])}",
        "summary": summary,
        "copy": "\n".join(lines),
        "checks": checks,
        "movers": movers,
    }


# ===== 참고 헤드라인 =====
def pick_headlines(news_items, region, since_ts, limit=6):
    rows = [i for i in news_items if i.get("region") == region and i.get("time_ts", 0) >= since_ts]
    rows.sort(key=lambda i: (not i.get("urgent"), -len(i.get("also") or []), -i["time_ts"]))
    return rows[:limit]


# ===== 텔레그램 메시지 =====
def to_telegram(draft, headlines=(), dashboard_url=None):
    icon = "🌙" if draft["kind"] == "overnight" else "🔔"
    out = [f"{icon} <b>{html.escape(draft['title'])}</b>", html.escape(draft["summary"]), "",
           f"<pre>{html.escape(draft['copy'])}</pre>", "", "<b>확인표</b>"]
    for name, val, note in draft["checks"]:
        out.append(f"• {html.escape(name)}: {html.escape(val)}" + (f" <i>{html.escape(note)}</i>" if note else ""))
    if draft.get("movers"):
        out += ["", "<b>코스피 시총 상위</b>", html.escape(", ".join(draft["movers"]))]
    if headlines:
        out += ["", "<b>참고 헤드라인</b>"]
        for h in headlines:
            out.append(f"• <a href=\"{html.escape(h['link'], quote=True)}\">{html.escape(h['title'])}</a>")
    out += ["", "<i>[ ] 빈칸(재료·업종)은 확인 후 채워 주세요</i>"]
    if dashboard_url:
        out.append(f"📊 <a href=\"{html.escape(dashboard_url, quote=True)}market.html\">시황 화면 열기</a>")
    return "\n".join(out)
