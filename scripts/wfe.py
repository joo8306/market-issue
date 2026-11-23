"""
WFE(세계거래소연맹) 월간 시장통계 수집
- 공개 페이지 focus.world-exchanges.org 의 'Market Statistics' 표 4개를 읽음
  (시가총액 · 상장사 수 · 거래대금 · 대표지수)
- 전체 통계 DB(statistics.world-exchanges.org)는 로그인이 필요해서 사용하지 않음
- 결과: 거래소별 월별 값 + 한국거래소 순위 요약
"""

import html
import re
import urllib.request
from html.parser import HTMLParser

BASE = "https://focus.world-exchanges.org"
INSIGHTS_URL = BASE + "/statistics/monthly-insights"
UA = "Mozilla/5.0 (compatible; market-issue-bot)"
KRX_NAME = "Korea Exchange"

# 표 제목(h3) → (키, 한글 이름, 단위)
METRICS = [
    ("market capitalisation", "mcap", "시가총액", "USD 백만"),
    ("number of listed companies", "listed", "상장회사 수", "개사"),
    ("value of share trading", "value", "주식 거래대금", "USD 백만"),
    ("broad stock index", "index", "대표지수", "pt"),
]
MONTH_RE = re.compile(r"^([A-Z][a-z]{2,3})'(\d{2})$")
MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
          "Sep": 9, "Sept": 9, "Oct": 10, "Nov": 11, "Dec": 12}


def http_text(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def latest_issue_url(insights_html):
    m = re.search(r'href="(/issue/[a-z]+-\d{4}/market-statistics)"', insights_html)
    return BASE + m.group(1) if m else None


class _Tables(HTMLParser):
    """h3 제목과 그 뒤에 오는 표(행·셀 텍스트)를 순서대로 수집"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._title, self._in_h3 = [], "", False
        self._table = self._row = self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "h3":
            self._in_h3, self._title = True, ""
        elif tag == "table":
            self._table = {"title": self._title.strip(), "rows": []}
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "h3":
            self._in_h3 = False
        elif tag in ("td", "th") and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self._table["rows"].append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None

    def handle_data(self, data):
        if self._in_h3:
            self._title += data
        if self._cell is not None:
            self._cell.append(data)


def to_num(s):
    s = (s or "").replace(",", "").replace("\xa0", "").strip()
    if s in ("", "-", "n/a", "N/A", "NA"):
        return None
    pct = s.endswith("%")
    try:
        v = float(s.rstrip("%"))
    except ValueError:
        return None
    return v


def month_key(label):
    m = MONTH_RE.match(label)
    if not m:
        return None
    return f"20{m.group(2)}-{MONTHS[m.group(1)]:02d}"


def parse_table(table):
    """표 → {columns, months, rows:[{exchange, region, total, values:{col: num}, text:{col: str}}]}"""
    rows = table["rows"]
    if not rows:
        return None
    header = [html.unescape(c) for c in rows[0]]
    months = [(i, month_key(c)) for i, c in enumerate(header) if month_key(c)]
    out_rows, region = [], None
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        name = r[0]
        if name.lower().startswith("note"):
            continue
        rest = [c for c in r[1:] if c]
        if not rest:  # Americas / APAC / EMEA 구분 행
            region = name
            continue
        values, text = {}, {}
        for i, col in enumerate(header[1:], start=1):
            cell = r[i] if i < len(r) else ""
            v = to_num(cell)
            if v is not None:
                values[col] = v
            elif cell:
                text[col] = cell
        out_rows.append({
            "exchange": name,
            "region": region,
            "total": name.lower().startswith("total"),
            "values": values,
            "text": text,
        })
    return {"columns": header, "months": [m for _, m in months],
            "month_cols": [header[i] for i, _ in months], "rows": out_rows}


def parse_issue(page_html):
    p = _Tables()
    p.feed(page_html)
    result = {}
    for t in p.tables:
        title = t["title"].lower()
        meta = next((m for m in METRICS if m[0] in title), None)
        if not meta:
            continue
        parsed = parse_table(t)
        if parsed:
            parsed.update(key=meta[1], name=meta[2], unit=meta[3], title=t["title"])
            result[meta[1]] = parsed
    return result


def latest_value_col(table):
    """비교에 쓸 최신 값 열: 월 열이 있으면 마지막 월, 없으면 'Total ...' 열"""
    if table["month_cols"]:
        return table["month_cols"][-1]
    return next((c for c in table["columns"] if c.lower().startswith("total")), None)


def change_cols(table):
    """증감률 열 (예: "%change Sept'26/ Sept'25 USD", "Sept'26/Sept'25 LOC")"""
    return [c for c in table["columns"][1:] if "/" in c and c not in table["month_cols"]]


def is_yoy(col):
    """같은 달끼리 1년 차이 비교 열인지"""
    found = re.findall(r"([A-Z][a-z]{2,3})'(\d{2})", col)
    return len(found) == 2 and found[0][0] == found[1][0] and int(found[0][1]) - int(found[1][1]) == 1


def rank_summary(table, who=KRX_NAME, top=15):
    col = latest_value_col(table)
    if not col:
        return None
    ex = [r for r in table["rows"] if not r["total"] and col in r["values"]]
    ranked = sorted(ex, key=lambda r: r["values"][col], reverse=True)
    me = next((r for r in ranked if r["exchange"] == who), None)
    region_rank = None
    if me:
        same = [r for r in ranked if r["region"] == me["region"]]
        region_rank = same.index(me) + 1
    return {
        "col": col,
        "count": len(ranked),
        "rank": ranked.index(me) + 1 if me else None,
        "region": me["region"] if me else None,
        "region_rank": region_rank,
        "region_count": len([r for r in ranked if me and r["region"] == me["region"]]),
        "top": [{"exchange": r["exchange"], "region": r["region"], "value": r["values"][col],
                 "label": r["text"].get("Name of Index")} for r in ranked[:top]],
    }


def summarize(issue, source_url):
    out = {"source": source_url, "metrics": []}
    for _, key, name, unit in METRICS:
        t = issue.get(key)
        if not t:
            continue
        me = next((r for r in t["rows"] if r["exchange"] == KRX_NAME), None)
        rank = rank_summary(t) if key != "index" else None  # 지수 레벨끼리 순위는 의미 없음
        changes = {c: me["values"][c] for c in change_cols(t) if me and c in me["values"]}
        series = [[m, me["values"].get(c)] for m, c in zip(t["months"], t["month_cols"])] if me else []
        totals = [{"name": r["exchange"], "value": r["values"].get(latest_value_col(t))}
                  for r in t["rows"] if r["total"]]
        index_moves = None
        if key == "index":
            # 대표지수는 최근 1년 등락률 순위로 비교
            yoy = next((c for c in change_cols(t) if is_yoy(c)), None)
            if yoy:
                ranked = sorted([r for r in t["rows"] if yoy in r["values"]],
                                key=lambda r: r["values"][yoy], reverse=True)
                idx = next((i for i, r in enumerate(ranked) if r["exchange"] == KRX_NAME), None)
                index_moves = {
                    "col": yoy, "count": len(ranked), "rank": idx + 1 if idx is not None else None,
                    "top": [{"exchange": r["exchange"], "label": r["text"].get("Name of Index"),
                             "value": r["values"][yoy]} for r in ranked[:15]],
                }
        out["metrics"].append({
            "key": key, "name": name, "unit": unit, "title": t["title"],
            "latest_col": latest_value_col(t),
            "krx": {
                "latest": me["values"].get(latest_value_col(t)) if me else None,
                "label": me["text"].get("Name of Index") if me else None,
                "detail": {c: v for c, v in me["values"].items() if c not in t["month_cols"]} if me else {},
                "changes": changes,
                "series": series,
            },
            "rank": rank,
            "index_moves": index_moves,
            "totals": totals,
        })
    return out


def fetch_wfe():
    url = latest_issue_url(http_text(INSIGHTS_URL))
    if not url:
        raise RuntimeError("최신 통계 호 링크를 찾지 못함")
    issue = parse_issue(http_text(url))
    if not issue:
        raise RuntimeError("통계 표를 찾지 못함 (페이지 구조 변경 가능성)")
    data = summarize(issue, url)
    data["issue"] = url.split("/issue/")[1].split("/")[0]  # 예: november-2026
    return data
