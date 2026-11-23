"""오프라인 테스트: 시황 초안 · WFE 통계 · 증권사 전망 트래커 · 시황 초안 발송 시점
fixtures/ 의 응답은 실제 네이버·야후·WFE 응답을 줄여서 저장한 것
실행: python -m unittest discover tests
"""

import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import briefing  # noqa: E402
import extras  # noqa: E402
import marketdata as md  # noqa: E402
import notify  # noqa: E402
import targets  # noqa: E402
import wfe  # noqa: E402

FX = Path(__file__).resolve().parent / "fixtures"


def fixture_json(name):
    return json.loads((FX / name).read_text(encoding="utf-8"))


def kr_index(pct, open_pct, high_pct, low_pct, inv, code="KOSPI", d="2026-11-23"):
    prev = 1000.0
    return {
        "code": code, "date": d, "status": "CLOSE", "close": prev * (1 + pct / 100), "prev": prev,
        "change": prev * pct / 100, "pct": pct, "open_pct": open_pct, "high_pct": high_pct, "low_pct": low_pct,
        "investors": dict(zip(("외국인", "기관", "개인"), inv)), "program": {}, "breadth": {},
    }


class NaverParseTest(unittest.TestCase):
    def test_parse_index(self):
        ix = md.parse_kr_index(fixture_json("naver_kospi_basic.json"),
                               fixture_json("naver_kospi_integration.json"))
        self.assertEqual(ix["code"], "KOSPI")
        self.assertAlmostEqual(ix["prev"], 4869.96)
        self.assertLess(ix["pct"], 0)
        self.assertLess(ix["low_pct"], ix["pct"])
        self.assertEqual(set(ix["investors"]) >= {"외국인", "기관", "개인"}, True)
        self.assertGreater(ix["breadth"]["하락"], ix["breadth"]["상승"])
        self.assertGreater(ix["value_eok"], 0)

    def test_num(self):
        self.assertEqual(md.num("+1,799"), 1799)
        self.assertEqual(md.num("-3,708"), -3708)
        self.assertEqual(md.num("15,321,574백만"), 15321574)
        self.assertIsNone(md.num("N/A"))


class YahooParseTest(unittest.TestCase):
    def setUp(self):
        self.spark = md.parse_spark(fixture_json("yahoo_spark.json"))

    def test_spark(self):
        sp = self.spark["^GSPC"]
        self.assertEqual(sp["date"], "2026-11-20")
        self.assertAlmostEqual(sp["pct"], (sp["close"] / sp["prev"] - 1) * 100)

    def test_row_on_aligns_europe_to_us_date(self):
        ftse = self.spark["^FTSE"]
        self.assertEqual(ftse["date"], "2026-11-23")  # 월요일 장중 값이 마지막
        aligned = md.row_on(ftse, "2026-11-20")
        self.assertEqual(aligned["date"], "2026-11-20")
        self.assertIsNone(md.row_on(ftse, "2020-01-01"))


class NaverWorldTest(unittest.TestCase):
    def test_index_daily(self):
        row = md.row_from_daily(md.parse_naver_daily(fixture_json("naver_world_dji_price.json")))
        self.assertEqual((row["date"], row["close"], row["prev"]), ("2026-11-20", 48147.33, 49097.06))
        self.assertAlmostEqual(row["pct"], -1.934, places=2)
        self.assertLess(row["open_pct"], 0)  # 시가도 있어 출발 방향 판단 가능
        self.assertEqual(row["series"][-1], ["2026-11-20", 48147.33])

    def test_bond_daily(self):
        rows = fixture_json("naver_bond_us10y.json")["result"]
        row = md.row_from_daily(md.parse_naver_daily(rows))
        self.assertEqual(row["close"], 4.912)

    def test_fallback_when_yahoo_blocked(self):
        from unittest import mock
        dji = md.row_from_daily(md.parse_naver_daily(fixture_json("naver_world_dji_price.json")))

        def fake_http(url, **kw):
            raise RuntimeError("HTTP Error 429")

        with mock.patch.object(md, "http_json", fake_http), \
                mock.patch.object(md, "fetch_naver_daily", lambda kind, code: dict(dji)):
            out = md.fetch_overseas()
        us = [r for r in out["items"] if r["symbol"] in md.US_MAIN]
        self.assertTrue(all(r["source"] == "네이버" and r["close"] == 48147.33 for r in us))
        ewy = next(r for r in out["items"] if r["symbol"] == "EWY")
        self.assertEqual(ewy["error"], "데이터 없음")


class NaverLagTest(unittest.TestCase):
    def test_latest_quote_fills_lagging_daily_history(self):
        rows = fixture_json("naver_world_ixic_price_lagging.json")
        basic = fixture_json("naver_world_ixic_basic.json")
        pts = md.parse_naver_daily(rows)
        self.assertEqual(pts[-1][0], "2026-11-20")  # 일별 시세에는 월요일 행이 아직 없음
        merged, status = md.merge_latest_quote(pts, basic)
        row = md.row_from_daily(merged)
        self.assertEqual((row["date"], row["close"], row["prev"]), ("2026-11-23", 24089.56, 22617.73))
        self.assertEqual(status, "CLOSE")
        self.assertIsNotNone(row["open_pct"])

    def test_draft_aligns_us_indices_to_common_date(self):
        def r(sym, series, live=False):
            row = {"symbol": sym, "name": sym, "group": "us", "series": series, "date": series[-1][0],
                   "close": series[-1][1], "prev": series[-2][1], "pct": (series[-1][1] / series[-2][1] - 1) * 100,
                   "open_pct": 0.5}
            if live:
                row["live"] = True
            return row
        a = [["2026-11-19", 100], ["2026-11-20", 98], ["2026-11-23", 101]]
        lag = [["2026-11-19", 100], ["2026-11-20", 95]]
        d = briefing.overnight_draft({"items": [r("^DJI", a), r("^IXIC", lag), r("^GSPC", a)]})
        self.assertEqual(d["date"], "2026-11-20")  # 나스닥이 늦으면 셋 다 금요일로 맞춤
        self.assertIn("3대지수 모두 하락 마감", d["copy"])
        self.assertTrue(d["checks"][0][0].startswith("⚠"))
        d = briefing.overnight_draft({"items": [r("^DJI", a, live=True), r("^IXIC", a), r("^GSPC", a)]})
        self.assertEqual(d["date"], "2026-11-20")  # 장중 값은 마감으로 쓰지 않음


class OvernightDraftTest(unittest.TestCase):
    def test_from_fixture(self):
        sp = md.parse_spark(fixture_json("yahoo_spark.json"))
        items = [dict(symbol=s, name=n, group=g, **(sp.get(s) or {"error": "x"})) for s, n, g in md.OVERSEAS]
        d = briefing.overnight_draft({"items": items})
        self.assertTrue(d["summary"].startswith("[11/20] 美 하락(Dow -1.9%"))
        self.assertIn("/ 유럽 하락(FTSE -1.0%", d["summary"])  # 11/20 종가 기준
        self.assertIn("3대지수 모두 하락 마감", d["copy"])
        self.assertIn("일제히 하락 마감", d["copy"])
        self.assertNotIn("리스크", d["copy"])

    def test_reversal_and_mixed(self):
        def row(sym, p, op):
            return {"symbol": sym, "name": sym, "group": "us", "date": "2026-11-20", "close": 100, "prev": 99,
                    "pct": p, "open_pct": op, "series": [["2026-11-19", 99], ["2026-11-20", 100]]}
        items = [row("^DJI", 0.5, -0.3), row("^IXIC", 1.0, -0.2), row("^GSPC", 0.7, -0.1)]
        d = briefing.overnight_draft({"items": items})
        self.assertIn("하락 출발하였으나,", d["copy"])
        self.assertIn("상승 전환하며 3대지수 모두 상승 마감", d["copy"])
        items[0]["pct"] = -0.2
        self.assertIn("혼조 마감", briefing.overnight_draft({"items": items})["copy"])

    def test_europe_minus_zero_is_down(self):
        self.assertEqual(briefing.eu_close_phrase([-0.01, -0.3, -0.2])[1], "하락")
        self.assertEqual(briefing.fmt_pct(-0.01), "-0.0%")


class ClosingDraftTest(unittest.TestCase):
    def test_big_drop_with_recovery(self):
        k = kr_index(-5.3, -2.0, -1.5, -8.2, (-34243, 8446, 22732))
        q = kr_index(-1.2, -0.5, 0.1, -1.4, (-500, -300, 800), code="KOSDAQ")
        d = briefing.closing_draft({"indices": {"KOSPI": k, "KOSDAQ": q}})
        self.assertIn("○ KOSPI", d["copy"])
        self.assertIn("외국인 매도세 지속된 가운데, 개인 및 기관 중심 저가매수세 유입으로 낙폭 축소되며 5%대 하락 마감",
                      d["copy"])
        self.assertIn("○ KOSDAQ :", d["copy"])
        self.assertIn("외국인 -34,243, 기관 +8,446, 개인 +22,732 (억원)", d["summary"])
        for banned in ("급락", "폭락", "리스크", "서킷"):
            self.assertNotIn(banned, d["copy"])

    def test_reversal(self):
        k = kr_index(2.2, -0.8, 2.4, -1.0, (-100, 3000, -2900))
        d = briefing.closing_draft({"indices": {"KOSPI": k}})
        self.assertIn("하락 출발하였으나,", d["copy"])
        self.assertIn("기관 매수세 유입되며 상승 전환 마감", d["copy"])

    def test_small_move_has_no_percent_band(self):
        k = kr_index(1.4, 0.8, 1.6, 0.2, (500, 200, -700))
        d = briefing.closing_draft({"indices": {"KOSPI": k}})
        self.assertIn("외국인 및 기관 매수세 유입되며 상승 마감", d["copy"])
        self.assertNotIn("%대", d["copy"])

    def test_widening_gain(self):
        k = kr_index(2.6, 0.3, 2.7, 0.2, (900, 100, -1000))
        d = briefing.closing_draft({"indices": {"KOSPI": k}})
        self.assertIn("외국인 매수세 유입으로 상승폭 확대되며 2%대 상승 마감", d["copy"])


class BriefingScheduleTest(unittest.TestCase):
    def market(self, kr_date="2026-11-23", us_date="2026-11-20"):
        return {
            "kr": {"indices": {"KOSPI": {"status": "CLOSE"}}},
            "drafts": {"closing": {"date": kr_date}, "overnight": {"date": us_date}},
        }

    def at(self, s):
        return datetime.fromisoformat(s).replace(tzinfo=notify.KST)

    def test_windows(self):
        kinds = ["overnight", "closing"]
        due = notify.due_briefings(self.market(), self.at("2026-11-23T07:10"), [], {}, kinds)
        self.assertEqual([k for k, _ in due], ["overnight"])
        due = notify.due_briefings(self.market(), self.at("2026-11-23T16:20"), [], {}, kinds)
        self.assertEqual([k for k, _ in due], ["closing"])
        self.assertEqual(notify.due_briefings(self.market(), self.at("2026-11-23T12:00"), [], {}, kinds), [])

    def test_once_per_day_holiday_and_weekend(self):
        kinds = ["closing"]
        sent = {"closing": "2026-11-23"}
        self.assertEqual(notify.due_briefings(self.market(), self.at("2026-11-23T16:20"), [], sent, kinds), [])
        self.assertEqual(notify.due_briefings(self.market(), self.at("2026-11-23T16:20"), ["2026-11-23"], {}, kinds), [])
        self.assertEqual(notify.due_briefings(self.market(), self.at("2026-11-22T16:20"), [], {}, kinds), [])

    def test_closing_requires_today_data(self):
        m = self.market(kr_date="2026-11-20")
        self.assertEqual(notify.due_briefings(m, self.at("2026-11-23T16:20"), [], {}, ["closing"]), [])

    def test_telegram_text(self):
        k = kr_index(-1.5, -0.5, 0.2, -1.8, (-100, 50, 50))
        d = briefing.closing_draft({"indices": {"KOSPI": k}})
        text = briefing.to_telegram(d, [{"title": "<코스피> 하락", "link": "https://x?a=1&b=2"}], "https://u/")
        self.assertIn("<pre>", text)
        self.assertIn("&lt;코스피&gt;", text)
        self.assertIn("https://u/market.html", text)


class WfeTest(unittest.TestCase):
    def setUp(self):
        self.issue = wfe.parse_issue((FX / "wfe_issue.html").read_text(encoding="utf-8"))

    def test_latest_issue_link(self):
        url = wfe.latest_issue_url((FX / "wfe_insights.html").read_text(encoding="utf-8"))
        self.assertTrue(url.endswith("/market-statistics"))

    def test_tables(self):
        self.assertEqual(set(self.issue), {"mcap", "listed", "value", "index"})
        mcap = self.issue["mcap"]
        self.assertEqual(mcap["month_cols"][-1], "Sept'26")
        self.assertEqual(mcap["months"][0], "2026-01")
        krx = next(r for r in mcap["rows"] if r["exchange"] == "Korea Exchange")
        self.assertEqual(krx["region"], "APAC")
        self.assertAlmostEqual(krx["values"]["Sept'26"], 4501110.15)

    def test_summary(self):
        s = wfe.summarize(self.issue, "src")
        by = {m["key"]: m for m in s["metrics"]}
        self.assertEqual(by["mcap"]["rank"]["top"][0]["exchange"], "Nasdaq - US")
        self.assertEqual(by["mcap"]["rank"]["rank"], 4)  # 줄인 표 안에서의 순위
        self.assertEqual(by["listed"]["krx"]["latest"], 2662)
        self.assertEqual(by["index"]["krx"]["label"], "KOSPI")
        self.assertEqual(by["index"]["index_moves"]["col"], "%change Sept'26/ Sept'25")
        self.assertFalse(any(t["exchange"].startswith("Total") for t in by["mcap"]["rank"]["top"]))


MD_SAMPLE = """기준일: 2026-11-06 (금) 코스피 목표 지수 · 증권사 3곳

국내
| 증권사 | 기간 | 목표·밴드 | 제시일 | 변경 | 핵심 근거 | 출처 |
|---|---|---|---|---|---|---|
| ★가나증권 | 단기 레벨 | 하단 5,330 하회 가능 | 11.04 | 신규 | 선행 PBR 1배 | [연합 11.04](https://example.com/a) |
| 다라증권 | 12개월 | 9,000 (밴드 6,000~10,500) | 12.20 (오래됨) | ↓ 12,000→9,000 | 이익 하향 | [한경 12.21](https://example.com/b) |

외국계
| 증권사 | 기간 | 목표·밴드 | 제시일 | 변경 | 핵심 근거 | 출처 |
|---|---|---|---|---|---|---|
| 노무라 | 내년 | 7,000~8,500 | 10.25 보도일 | 신규 | 수출 | [로이터 10.25](https://example.com/c) |
"""


class TargetsTest(unittest.TestCase):
    def test_parse_markdown(self):
        rows = targets.parse_markdown(MD_SAMPLE)
        self.assertEqual(len(rows), 3)
        a, b, c = rows
        self.assertEqual((a["증권사"], a["기간"], a["목표"]), ("가나증권", "단기", "5330"))
        self.assertEqual((b["목표"], b["하단"], b["상단"]), ("9000", "6000", "10500"))
        self.assertEqual(b["제시일"], "2025-12-20")  # 기준일보다 뒤 날짜 → 작년
        self.assertEqual((c["구분"], c["목표"], c["하단"], c["날짜구분"]), ("외국계", "", "7000", "보도일"))
        self.assertEqual(c["링크"], "https://example.com/c")

    def test_parse_new_skill_columns(self):
        md = """기준일: 2026-11-23 (월) 코스피 목표 지수 · 증권사 1곳

외국계
| 증권사 | 기간 | 기준 | 목표·밴드 | 제시일 | 변경 | 직전 전망 | 전망 근거 요약 | 출처 |
|---|---|---|---|---|---|---|---|---|
| ★Goldman Sachs | 12개월 | 향후 12개월 목표 | 7,500 | 11.17 | ↓ 하향 | 9,000 (10.26) | 이익 하향 · PER 8배 | [CNBC 11.17](https://x/a) |
"""
        rows = targets.parse_markdown(md)
        self.assertEqual(len(rows), 2)  # 최신 + 직전 전망 이력
        cur, prev = rows
        self.assertEqual((cur["기준"], cur["근거"], cur["목표"]), ("향후 12개월 목표", "이익 하향 · PER 8배", "7500"))
        self.assertEqual((prev["목표"], prev["제시일"], prev["기간"]), ("9000", "2026-10-26", "12개월"))
        p = targets.build_payload(rows, [], date(2026, 11, 23))
        g = p["brokers"][0]
        self.assertEqual([i["change"] for i in g["items"]], ["하향", "신규"])  # 최신은 직전 9,000 대비 하향
        self.assertIsNone(targets.parse_prev("-", date(2026, 11, 23)))
        self.assertIsNone(targets.parse_prev("9,000", date(2026, 11, 23)))  # 날짜 없으면 이력으로 안 넣음

    def test_levels(self):
        self.assertEqual(targets.parse_levels("선행 PBR 1배인 5,330선"), (5330, None, None))
        self.assertEqual(targets.parse_levels("12개월 목표 8,000"), (8000, None, None))
        self.assertEqual(targets.parse_levels("4,500-5,200"), (None, 4500, 5200))

    def test_append_dedupes_and_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.csv"
            added, dup = targets.append_rows(targets.parse_markdown(MD_SAMPLE), path)
            self.assertEqual((len(added), dup), (3, 0))
            added, dup = targets.append_rows(targets.parse_markdown(MD_SAMPLE), path)
            self.assertEqual((len(added), dup), (0, 3))
            # 같은 증권사·기간 새 전망 → 직전값 대비 상향
            newer = targets.parse_markdown(MD_SAMPLE.replace("9,000 (밴드 6,000~10,500) | 12.20 (오래됨)",
                                                             "9,500 | 11.05"))
            targets.append_rows(newer, path)
            p = targets.build_payload(targets.load_rows(path), [["2026-11-06", 5100]], date(2026, 11, 6))
            dara = next(r for r in p["snapshot"] if r["broker"] == "다라증권")
            self.assertEqual((dara["level"], dara["change"], dara["prev"]["level"]), (9500, "상향", 9000))
            self.assertTrue(dara["recent"])
            nomura = next(r for r in p["snapshot"] if r["broker"] == "노무라")
            self.assertEqual(nomura["level"], 7750)  # 밴드 중간값
            self.assertEqual(p["snapshot"][0]["group"], "국내")
            self.assertEqual({r["period"] for r in p["ranges"]}, {"단기", "12개월", "내년"})


    def test_stale_excluded_from_ranges_and_basis_kept(self):
        rows = [
            {**{k: "" for k in targets.FIELDS}, "증권사": "A", "구분": "외국계", "기간": "12개월", "목표": "7500",
             "제시일": "2026-11-17", "기준": "향후 12개월 목표"},
            {**{k: "" for k in targets.FIELDS}, "증권사": "B", "구분": "외국계", "기간": "12개월", "목표": "12500",
             "제시일": "2026-07-21"},
        ]
        p = targets.build_payload(rows, [], date(2026, 11, 23), {"기준일": "2026-11-23"})
        r12 = next(r for r in p["ranges"] if r["period"] == "12개월")
        self.assertEqual((r12["count"], r12["median"]), (1, 7500))  # 3개월 넘은 B 제외
        self.assertTrue(next(r for r in p["snapshot"] if r["broker"] == "B")["stale"])
        self.assertEqual(next(r for r in p["snapshot"] if r["broker"] == "A")["basis"], "향후 12개월 목표")
        self.assertEqual(p["meta"]["기준일"], "2026-11-23")

    def test_broker_history(self):
        def r(b, per, t, d):
            return {**{k: "" for k in targets.FIELDS}, "증권사": b, "구분": "외국계", "기간": per, "목표": t, "제시일": d}
        rows = [r("G", "12개월", "12000", "2026-06-03"), r("G", "12개월", "9000", "2026-10-26"),
                r("G", "12개월", "7500", "2026-11-17"), r("N", "기간 미상", "8000", "2026-02-26"),
                r("N", "기간 미상", "10000", "2026-11-05")]
        p = targets.build_payload(rows, [], date(2026, 11, 23))
        g = next(b for b in p["brokers"] if b["broker"] == "G")
        self.assertEqual([i["level"] for i in g["items"]], [7500, 9000, 12000])  # 최신순
        self.assertEqual([i["change"] for i in g["items"]], ["하향", "하향", "신규"])
        self.assertEqual(g["items"][0]["prev"]["level"], 9000)
        self.assertEqual((g["ups"], g["downs"]), (0, 2))
        n = next(b for b in p["brokers"] if b["broker"] == "N")
        self.assertEqual(n["items"][0]["change"], "신규")  # 기간을 모르는 전망끼리는 비교하지 않음

    def test_committed_data_loads(self):
        rows = targets.load_rows()
        self.assertTrue(all(r["기준"] for r in rows), "모든 행에 기준(무엇을 뜻하는 수치인지)이 있어야 함")
        self.assertTrue(all(r["제시일"] and r["링크"] for r in rows))


class ExtrasCacheTest(unittest.TestCase):
    def test_failure_falls_back_to_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            st = Path(tmp)
            calls = []

            def ok():
                calls.append(1)
                return {"v": 1}

            def bad():
                raise RuntimeError("down")

            data, info = extras.cached("x", ok, 60, st, 1000)
            self.assertEqual((data, info["from_cache"]), ({"v": 1}, False))
            data, info = extras.cached("x", ok, 60, st, 1030)  # 주기 전 → 캐시
            self.assertEqual((len(calls), info["from_cache"]), (1, True))
            data, info = extras.cached("x", bad, 60, st, 2000)  # 실패 → 이전 데이터
            self.assertEqual((data, info["ok"]), ({"v": 1}, False))

    def test_build_extras_offline(self):
        sp = md.parse_spark(fixture_json("yahoo_spark.json"))
        ix = md.parse_kr_index(fixture_json("naver_kospi_basic.json"), fixture_json("naver_kospi_integration.json"))
        issue = wfe.parse_issue((FX / "wfe_issue.html").read_text(encoding="utf-8"))
        sources = {
            "market_kr": (lambda: {"indices": {"KOSPI": ix}, "top_mcap": {}}, 0),
            "market_overseas": (lambda: {"items": [dict(symbol=s, name=n, group=g, **(sp.get(s) or {}))
                                                   for s, n, g in md.OVERSEAS]}, 0),
            "kospi_history": (lambda: [["2026-11-20", 4869.96], ["2026-11-23", 4708.54]], 0),
            "wfe": (lambda: wfe.summarize(issue, "src"), 0),
        }
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "dist"
            out.mkdir()
            csv_path = Path(tmp) / "t.csv"
            targets.append_rows(targets.parse_markdown(MD_SAMPLE), csv_path)
            extras.build_extras(out, Path(tmp) / "state", sources=sources, targets_csv=csv_path,
                                now=datetime(2026, 11, 23, 17, 0, tzinfo=md.KST))
            market = json.loads((out / "market.json").read_text(encoding="utf-8"))
            self.assertIn("○ KOSPI", market["drafts"]["closing"]["copy"])
            self.assertIn("○ 美 증시", market["drafts"]["overnight"]["copy"])
            self.assertEqual(len(json.loads((out / "wfe.json").read_text(encoding="utf-8"))["metrics"]), 4)
            self.assertEqual(len(json.loads((out / "targets.json").read_text(encoding="utf-8"))["kospi"]), 2)


if __name__ == "__main__":
    unittest.main()
