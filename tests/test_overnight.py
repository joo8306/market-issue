"""야간·주말 지표: 미국 선물 · 시간외 · 하이퍼리퀴드 무기한 선물 파싱"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import overnight as on  # noqa: E402


class OvernightTest(unittest.TestCase):
    def test_us_futures_order_and_filter(self):
        rows = [
            {"reutersCode": "RTYcv1", "closePrice": "2,686.20", "fluctuationsRatio": "0.45"},
            {"reutersCode": "YMcv1", "closePrice": "49,869.00", "fluctuationsRatio": "0.39", "marketStatus": "OPEN"},
            {"reutersCode": "EScv1", "closePrice": "7,219.50", "fluctuationsRatio": "-0.48"},
        ]
        out = on.parse_us_futures(rows)
        self.assertEqual([r["code"] for r in out], ["EScv1", "YMcv1"])   # 러셀 제외, S&P → 다우 순
        self.assertEqual(out[0]["price"], 7219.5)
        self.assertEqual(out[1]["pct"], 0.39)

    def test_over_market(self):
        self.assertIsNone(on.parse_over_market(None))
        o = on.parse_over_market({"overPrice": "650.10", "fluctuationsRatio": "1.20",
                                  "tradingSessionType": "AFTER_MARKET", "localTradedAt": "t"})
        self.assertEqual((o["price"], o["pct"], o["session"]), (650.1, 1.2, "애프터마켓"))

    def test_perps_vs_kr_close(self):
        meta = {"universe": [{"name": "xyz:KR200"}, {"name": "xyz:SMSN"}, {"name": "xyz:KRW"}, {"name": "xyz:SKHX"}]}
        ctxs = [
            {"markPx": "750", "prevDayPx": "780", "oraclePx": "750", "dayNtlVlm": "1000000", "openInterest": "10"},
            {"markPx": "135", "prevDayPx": "140", "oraclePx": "135", "dayNtlVlm": "5", "openInterest": "1"},
            {"markPx": "1340", "oraclePx": "1340"},
            {"markPx": "800", "prevDayPx": "800"},
        ]
        closes = {"KPI200": {"close": 780.0}, "005930": {"close": 180000.0}}   # 하이닉스 종가 없음
        perps, fx = on.parse_perps((meta, ctxs), closes)
        self.assertEqual(fx, 1340.0)
        k = {p["name"]: p for p in perps}
        self.assertAlmostEqual(k["코스피200"]["vs_close"], (750 / 780 - 1) * 100)   # 지수는 포인트 그대로
        self.assertAlmostEqual(k["삼성전자"]["krw"], 135 * 1340)                     # 달러 → 원화 환산
        self.assertAlmostEqual(k["삼성전자"]["vs_close"], (135 * 1340 / 180000 - 1) * 100)
        self.assertIsNone(k["SK하이닉스"]["vs_close"])                              # 기준 종가 없으면 비교 안 함
        self.assertNotIn("EWY", k)                                                  # 시세 없는 상품은 생략

    def test_krx_close_row_skips_today_before_close(self):
        from datetime import datetime
        rows = [{"localTradedAt": "2026-11-25", "closePrice": "189,400"}, {"localTradedAt": "2026-11-24", "closePrice": "182,900"}]
        self.assertEqual(on.krx_close_row(rows, datetime(2026, 11, 25, 8, 20, tzinfo=on.md.KST))["closePrice"], "182,900")
        self.assertEqual(on.krx_close_row(rows, datetime(2026, 11, 25, 15, 40, tzinfo=on.md.KST))["closePrice"], "189,400")

    def test_kr_premarket(self):
        basic = {"overMarketPriceInfo": {"tradingSessionType": "PRE_MARKET", "overMarketStatus": "OPEN",
                                         "overPrice": "180,600", "localTradedAt": "2026-11-25T08:21:29+09:00"}}
        r = on.parse_kr_pre("005930", "삼성전자", basic, 182900.0)
        self.assertEqual(r["price"], 180600.0)
        self.assertAlmostEqual(r["vs_krx"], (180600 / 182900 - 1) * 100)   # 네이버 등락률이 아니라 KRX 종가 대비
        after = {"overMarketPriceInfo": {"tradingSessionType": "AFTER_MARKET", "overPrice": "182,900"}}
        self.assertIsNone(on.parse_kr_pre("005930", "삼성전자", after, 182900.0))   # 애프터마켓은 제외


if __name__ == "__main__":
    unittest.main()
