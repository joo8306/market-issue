"""해외 뉴스 제목 번역: 대상 선별 · 캐시 재사용 · 실패 시 영문 유지"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import translate  # noqa: E402


def items():
    return [
        {"id": "a", "region": "GLOBAL", "title": "Stocks rally as Fed signals cut"},
        {"id": "b", "region": "GLOBAL", "title": "엔비디아 실적 발표"},      # 이미 한글 → 제외
        {"id": "c", "region": "KR", "title": "Samsung shares jump"},       # 국내 탭 → 제외
        {"id": "d", "region": "GLOBAL", "title": "Oil falls 2%"},
    ]


class TranslateTest(unittest.TestCase):
    def test_targets_and_cache(self):
        calls = []

        def fake(titles):
            calls.append(list(titles))
            return [f"[번역]{t}" for t in titles]

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "c.json"
            its = items()
            n, name, err = translate.apply_translations(its, engine=("fake", fake), cache_path=cache)
            self.assertEqual((n, err), (2, None))
            self.assertEqual(calls, [["Stocks rally as Fed signals cut", "Oil falls 2%"]])
            self.assertEqual(its[0]["title_ko"], "[번역]Stocks rally as Fed signals cut")
            self.assertNotIn("title_ko", its[1])
            self.assertNotIn("title_ko", its[2])
            # 두 번째 실행: 캐시에서 채우고 다시 번역하지 않음
            its2 = items()
            n, _, _ = translate.apply_translations(its2, engine=("fake", fake), cache_path=cache)
            self.assertEqual((n, len(calls)), (0, 1))
            self.assertEqual(its2[3]["title_ko"], "[번역]Oil falls 2%")

    def test_failure_keeps_english(self):
        def broken(titles):
            raise RuntimeError("차단")

        with tempfile.TemporaryDirectory() as tmp:
            its = items()
            n, _, err = translate.apply_translations(its, engine=("x", broken), cache_path=Path(tmp) / "c.json")
            self.assertEqual(n, 0)
            self.assertIn("차단", err)
            self.assertTrue(all("title_ko" not in i for i in its))


if __name__ == "__main__":
    unittest.main()
