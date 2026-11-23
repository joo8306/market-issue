"""
증권사 코스피 전망 트래커
- 기록: data/kospi_targets.csv (한 줄 = 증권사 하나의 기간별 전망 1건)
- /kospi-targets 결과(마크다운 표)를 그대로 붙여 넣어 쌓을 수 있음:
    python scripts/targets.py import 결과.md            (파일)
    python scripts/targets.py import - < 결과.md        (표준입력)
- build.py 가 이 파일을 읽어 dist/targets.json 을 만듦 (증권사별 최신값·변경 이력)
"""

import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "kospi_targets.csv"

FIELDS = ["기록일", "증권사", "구분", "기간", "목표", "하단", "상단", "내용",
          "제시일", "날짜구분", "변경", "근거", "출처", "링크", "기준"]
# 기준: 그 숫자가 무엇을 뜻하는지 (예: "2027년 연간 예상 밴드", "12개월 목표 · 시나리오 범위")
#       국내 증권사는 다음 해 연간 밴드, 외국계는 발표일부터 12개월 목표가 많아 같은 '목표'라도 뜻이 다름
META_PATH = ROOT / "data" / "kospi_targets_meta.json"

# 기간 표기 순서 (짧은 순)
PERIODS = ["단기", "월간", "분기", "3개월", "6개월", "12개월", "연말", "내년", "기간 미상"]

FOREIGN = ["Goldman", "골드만", "Morgan Stanley", "모건스탠리", "JPMorgan", "JP모건", "제이피모건",
           "Citi", "씨티", "UBS", "Nomura", "노무라", "Macquarie", "맥쿼리", "CLSA", "HSBC",
           "BofA", "뱅크오브아메리카", "메릴린치", "Jefferies", "제프리스", "Bernstein", "번스타인"]


# ===== 값 해석 =====
def normalize_period(text):
    t = (text or "").replace(" ", "")
    rules = [
        (("12개월", "12M", "1년"), "12개월"),
        (("6개월", "6M"), "6개월"),
        (("3개월", "3M"), "3개월"),
        (("연말",), "연말"),
        (("내년", "연간", "2027", "2028"), "내년"),
        (("분기", "Q"), "분기"),
        (("월간", "월"), "월간"),
        (("단기", "주간", "지지", "하단", "레벨"), "단기"),
    ]
    for keys, name in rules:
        if any(k in t for k in keys):
            return name
    return "기간 미상"


def _n(s):
    return float(s.replace(",", ""))


def parse_levels(text):
    """'9,000 (밴드 6,000~10,500)' → (9000, 6000, 10500), '5,800~6,500' → (None, 5800, 6500)
    1,000 미만 숫자(1배, 12개월 등)는 지수 값으로 보지 않음"""
    t = text or ""
    low = high = target = None
    m = re.search(r"(\d[\d,]{3,})\s*(?:pt|p)?\s*[~～\-–]\s*(\d[\d,]{3,})", t)
    if m:
        low, high = sorted([_n(m.group(1)), _n(m.group(2))])
        t = t[:m.start()] + " " + t[m.end():]
    nums = [_n(x) for x in re.findall(r"\d[\d,]{3,}(?:\.\d+)?", t)]
    nums = [x for x in nums if x >= 1000]
    if nums:
        target = nums[0]
    return target, low, high


def parse_given_date(text, base):
    """'10.25' / '10.25 (오래됨)' / '10.25 보도일' → ('2026-10-25', '보고서'|'보도일')"""
    t = text or ""
    kind = "보도일" if "보도" in t else "보고서"
    m = re.search(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", t)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat(), kind
    m = re.search(r"(\d{1,2})[./](\d{1,2})", t)
    if not m:
        return "", kind
    mo, d = int(m.group(1)), int(m.group(2))
    year = base.year if (mo, d) <= (base.month, base.day) else base.year - 1
    return date(year, mo, d).isoformat(), kind


def parse_source(text):
    m = re.search(r"\[([^\]]+)\]\(([^)]+)\)", text or "")
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return (text or "").strip(), ""


def broker_group(name, hint=None):
    if hint:
        return hint
    return "외국계" if any(k.lower() in name.lower() for k in FOREIGN) else "국내"


# ===== /kospi-targets 결과 가져오기 =====
def parse_markdown(md, today=None):
    """/kospi-targets 채팅 결과(표) → CSV 행 목록"""
    today = today or date.today()
    base = today
    m = re.search(r"기준일\s*[:：]\s*(20\d{2})-(\d{2})-(\d{2})", md)
    if m:
        base = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    rows, header, group = [], None, None
    for line in md.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            if "외국계" in s:
                group = "외국계"
            elif "국내" in s:
                group = "국내"
            if not s:
                header = header  # 빈 줄은 표 구분만
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        if "증권사" in cells[0]:
            header = cells
            continue
        if not header:
            continue
        rec = dict(zip(header, cells + [""] * (len(header) - len(cells))))
        broker = rec.get("증권사", "").replace("★", "").replace("*", "").strip()
        if not broker:
            continue
        content = next((v for k, v in rec.items() if "목표" in k or "밴드" in k), "")
        target, low, high = parse_levels(content)
        if target is None and low is None:
            continue  # 숫자가 없는 행은 건너뜀
        given, kind = parse_given_date(rec.get("제시일", ""), base)
        src, link = parse_source(rec.get("출처", ""))
        reason = next((v for k, v in rec.items() if "근거" in k), "")
        period = normalize_period(rec.get("기간", ""))
        basis = rec.get("기준") or rec.get("기간", "")
        row = {
            "기록일": base.isoformat(),
            "증권사": broker,
            "구분": broker_group(broker, group),
            "기간": period,
            "목표": "" if target is None else f"{target:g}",
            "하단": "" if low is None else f"{low:g}",
            "상단": "" if high is None else f"{high:g}",
            "내용": content,
            "제시일": given,
            "날짜구분": kind,
            "변경": rec.get("변경", ""),
            "근거": reason,
            "출처": src,
            "링크": link,
            "기준": basis,
        }
        rows.append(row)
        prev = parse_prev(rec.get("직전 전망", ""), base)
        if prev:  # 직전 전망도 이력 한 줄로 남김 (같은 기간·기준)
            p_target, p_low, p_high, p_text, p_date = prev
            rows.append(dict(row, **{
                "목표": "" if p_target is None else f"{p_target:g}",
                "하단": "" if p_low is None else f"{p_low:g}",
                "상단": "" if p_high is None else f"{p_high:g}",
                "내용": p_text, "제시일": p_date, "날짜구분": "보도일", "변경": "",
                "근거": "", "출처": f"직전 전망 ({src})" if src else "직전 전망", "링크": link,
            }))
    return rows


def parse_prev(text, base):
    """'9,000 (10.26)' / '5,200~6,700 (2026.11.09)' → (목표, 하단, 상단, 내용, 날짜). 날짜가 없으면 None"""
    t = (text or "").strip()
    if not t or t in ("-", "신규", "없음"):
        return None
    m = re.search(r"\(([^)]*\d{1,2}[./]\d{1,2}[^)]*)\)\s*$", t)
    if not m:
        return None
    d, _ = parse_given_date(m.group(1), base)
    value_text = t[:m.start()].strip()
    target, low, high = parse_levels(value_text)
    if not d or (target is None and low is None):
        return None
    return target, low, high, value_text, d


# ===== CSV =====
def load_rows(path=CSV_PATH):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [{k: (r.get(k) or "").strip() for k in FIELDS} for r in csv.DictReader(f)]


def row_key(r):
    return (r["증권사"], r["기간"], r["제시일"], r["목표"], r["하단"], r["상단"])


def append_rows(new_rows, path=CSV_PATH):
    existing = load_rows(path)
    keys = {row_key(r) for r in existing}
    added = [r for r in new_rows if row_key(r) not in keys]
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            w.writeheader()
        w.writerows(added)
    return added, len(new_rows) - len(added)


# ===== 화면용 데이터 =====
def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def level(r):
    """대표값: 목표치, 없으면 밴드 중간값"""
    if r["target"] is not None:
        return r["target"]
    if r["low"] is not None and r["high"] is not None:
        return (r["low"] + r["high"]) / 2
    return r["low"] or r["high"]


def load_meta(path=META_PATH):
    """수집 메모 (기준일, 수집 방법, 확인 필요·찾지 못한 증권사)"""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def change_of(rec):
    p = rec.get("prev")
    if p is None:
        note = rec.get("change_note") or ""
        return ("상향" if "↑" in note or "상향" in note else
                "하향" if "↓" in note or "하향" in note else
                "유지" if "→" in note or "유지" in note else "신규")
    if rec["level"] > p["level"]:
        return "상향"
    if rec["level"] < p["level"]:
        return "하향"
    return "유지"


def broker_timelines(recs, today):
    """증권사별 전망 이력 (최신순). 국내 먼저, 최근 전망이 있는 증권사 먼저"""
    by = {}
    for rec in recs:
        by.setdefault(rec["broker"], []).append(rec)
    out = []
    for broker, items in by.items():
        items = sorted(items, key=lambda x: x["date"], reverse=True)
        ups = sum(1 for i in items if i["change"] == "상향")
        downs = sum(1 for i in items if i["change"] == "하향")
        out.append({
            "broker": broker, "group": items[0]["group"], "latest_date": items[0]["date"],
            "count": len(items), "ups": ups, "downs": downs,
            "items": [{k: i[k] for k in ("date", "date_kind", "period", "basis", "text", "level", "target", "low",
                                         "high", "change", "change_note", "prev", "reason", "source", "link")}
                      for i in items],
        })
    out.sort(key=lambda b: b["latest_date"], reverse=True)
    out.sort(key=lambda b: b["group"] != "국내")
    return out


def build_payload(rows, kospi_history=None, today=None, meta=None):
    today = today or date.today()
    recs = []
    for r in rows:
        if not r.get("증권사") or not r.get("제시일"):
            continue
        rec = {
            "broker": r["증권사"], "group": r["구분"] or broker_group(r["증권사"]),
            "period": r["기간"] or "기간 미상",
            "target": _f(r["목표"]), "low": _f(r["하단"]), "high": _f(r["상단"]),
            "text": r["내용"], "date": r["제시일"], "date_kind": r["날짜구분"],
            "reason": r["근거"], "source": r["출처"], "link": r["링크"],
            "change_note": r["변경"],
            "basis": r.get("기준", ""),
        }
        rec["level"] = level(rec)
        if rec["level"] is None:
            continue
        recs.append(rec)

    # 기록마다 같은 증권사·같은 기간의 직전 전망과 비교해 상향/하향 판정
    # (기간이 다르면 기준이 달라 비교하지 않음 → 직전값이 없으면 기록된 '변경' 메모를 사용)
    last = {}
    for rec in sorted(recs, key=lambda x: x["date"]):
        key = (rec["broker"], rec["period"])
        prev = last.get(key) if rec["period"] != "기간 미상" else None  # 기간을 모르면 비교할 수 없음
        if prev and prev["date"] == rec["date"]:
            prev = prev.get("prev_rec")
        rec["prev_rec"] = prev
        rec["prev"] = ({"level": prev["level"], "date": prev["date"], "text": prev["text"]} if prev else None)
        rec["change"] = change_of(rec)
        last[key] = rec
    for rec in recs:
        rec.pop("prev_rec", None)

    snapshot = []
    for rec in last.values():
        age = (today - datetime.strptime(rec["date"], "%Y-%m-%d").date()).days
        if age > 183:  # 6개월 넘은 전망은 제외
            continue
        change = rec["change"]
        snapshot.append(dict(rec, change=change, age_days=age,
                             recent=age <= 31 and change in ("상향", "하향", "신규"),
                             stale=age > 92))
    order = {p: i for i, p in enumerate(PERIODS)}
    snapshot.sort(key=lambda r: r["date"], reverse=True)  # 같은 기간 안에서는 최신순
    snapshot.sort(key=lambda r: (r["group"] != "국내", order.get(r["period"], 99)))

    ranges = []
    for p in PERIODS:
        # 3개월 넘은 전망은 중간값에서 제외 (표에는 '오래됨'으로 남김)
        vals = sorted(r["level"] for r in snapshot if r["period"] == p and not r["stale"])
        if not vals:
            continue
        mid = len(vals) // 2
        median = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
        ranges.append({"period": p, "count": len(vals), "min": vals[0], "max": vals[-1], "median": median})

    return {
        "generated": today.isoformat(),
        "count": len(recs),
        "snapshot": snapshot,
        "ranges": ranges,
        "history": sorted(recs, key=lambda x: x["date"], reverse=True),
        "brokers": broker_timelines(recs, today),
        "kospi": kospi_history or [],
        "meta": meta or {},
    }


def main(argv):
    if len(argv) >= 2 and argv[0] == "import":
        src = sys.stdin.read() if argv[1] == "-" else Path(argv[1]).read_text(encoding="utf-8")
        rows = parse_markdown(src)
        added, dup = append_rows(rows)
        print(f"표에서 {len(rows)}건 읽음 → 새로 추가 {len(added)}건, 중복 {dup}건 건너뜀 ({CSV_PATH})")
        for r in added:
            print(f"  + {r['증권사']} {r['기간']} {r['내용']} ({r['제시일']})")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
