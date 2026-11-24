"""시황 그래프 시계열: 분봉 줄이기 · 네이버 분봉/일봉 파싱 · 현재가 기록으로 당일 흐름 대체"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import charts  # noqa: E402


class ChartsTest(unittest.TestCase):
    def test_thin_keeps_last_of_bucket(self):
        pts = [[0, 1], [60, 2], [299, 3], [300, 4], [360, 5]]
        self.assertEqual(charts.thin(pts, 300), [[299, 3], [360, 5]])

    def test_naver_minute_and_day(self):
        rows = [{"localDateTime": "20261124090000", "currentPrice": 100.0},
                {"localDateTime": "20261124090100", "currentPrice": 101.0},
                {"localDateTime": "20261124090500", "currentPrice": 102.0}]
        pts = charts.parse_naver_minute(rows)
        self.assertEqual([v for _, v in pts], [101.0, 102.0])   # 09:00~09:04 구간은 마지막 값
        day = charts.parse_naver_day({"priceInfos": [{"localDate": "20261121", "closePrice": 1},
                                                     {"localDate": "20261124", "closePrice": 2}]})
        self.assertEqual(day, [["2026-11-21", 1.0], ["2026-11-24", 2.0]])

    def test_samples_fill_missing_intraday(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            charts.update_samples(path, {"EScv1": 7200.0, "KOSPI": 5000.0}, 1000)
            charts.update_samples(path, {"EScv1": 7210.0}, 1300)
            samples = charts.update_samples(path, {"EScv1": 7210.0}, 1400)   # 같은 값·10분 안 → 추가 안 함
            self.assertEqual(samples["EScv1"], [[1000, 7200.0], [1300, 7210.0]])
            series = {"EScv1": {"day": [["2026-11-21", 7100.0], ["2026-11-24", 7210.0]]},
                      "KOSPI": {"intra": [[1, 1.0], [2, 2.0]]}}
            charts.fill_from_samples(series, samples)
            self.assertTrue(series["EScv1"]["sampled"])
            self.assertEqual(series["EScv1"]["prev"], 7100.0)
            self.assertNotIn("sampled", series["KOSPI"])   # 분봉이 있으면 그대로

    def test_samples_expire(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            charts.update_samples(path, {"A": 1.0}, 0)
            samples = charts.update_samples(path, {"B": 2.0}, charts.SAMPLE_HOURS * 3600 + 10)
            self.assertNotIn("A", samples)


if __name__ == "__main__":
    unittest.main()
