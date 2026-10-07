"""오프라인 테스트: 실제 RSS 대신 가짜 피드로 수집·분류·중복제거·사이트 생성·알림 포맷 검증
실행: python -m unittest discover tests
"""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import feedparser  # noqa: E402

import build  # noqa: E402
import notify  # noqa: E402


def rss(items):
    body = "".join(
        f"<item><title>{t}</title><link>{l}</link><pubDate>{format_datetime(d)}</pubDate></item>"
        for t, l, d in items
    )
    return feedparser.parse(f"<rss version='2.0'><channel><title>x</title>{body}</channel></rss>")


class ClassifyTest(unittest.TestCase):
    def test_english_word_boundaries(self):
        self.assertIsNone(build.classify("Software award winners announced", region="GLOBAL"))
        self.assertIsNone(build.classify("Metal prices and the aid package", region="GLOBAL"))
        self.assertEqual(build.classify("Fed signals rate cut in December")[0], "Fed·중앙은행")
        self.assertEqual(build.classify("New tariffs hit Asian exporters")[1], "tariff")
        self.assertEqual(build.classify("Oil plunged after OPEC meeting")[0], "원자재·에너지")

    def test_korean(self):
        self.assertEqual(build.classify("금통위, 기준금리 동결", region="KR")[0], "통화·금리")
        self.assertEqual(build.classify("코스피 외국인 순매수", region="KR")[0], "증시")

    def test_urgent(self):
        self.assertTrue(build.is_urgent("[속보] 코스피 사이드카 발동"))
        self.assertTrue(build.is_urgent("Stocks plunge as tariffs bite"))
        self.assertFalse(build.is_urgent("Apple unveils new iPhone"))

    def test_publisher_split_and_dedupe_id(self):
        self.assertEqual(build.split_publisher("Fed holds rates steady - Reuters"),
                         ("Fed holds rates steady", "Reuters"))
        self.assertEqual(build.item_id("Fed holds rates steady - Reuters"),
                         build.item_id("Fed holds rates steady"))


class PipelineTest(unittest.TestCase):
    def setUp(self):
        now = datetime.now(timezone.utc)
        self.feeds = {
            "https://kr.example/rss": rss([
                ("[속보] 금통위 기준금리 인하", "https://kr.example/1", now - timedelta(minutes=5)),
                ("오늘의 날씨", "https://kr.example/2", now - timedelta(minutes=6)),
                ("오래된 코스피 기사", "https://kr.example/3", now - timedelta(hours=30)),
            ]),
            "https://news.google.com/rss/a": rss([
                ("Fed cuts rates by 25 basis points - Reuters", "https://g/1", now - timedelta(minutes=3)),
            ]),
            "https://cnbc.example/rss": rss([
                ("Fed cuts rates by 25 basis points", "https://cnbc/1", now - timedelta(minutes=1)),
                ("Nvidia shares surge on AI demand", "https://cnbc/2", now - timedelta(minutes=2)),
            ]),
        }
        self.config_feeds = {
            "KR test": ("https://kr.example/rss", "KR", {}),
            "Reuters": ("https://news.google.com/rss/a", "GLOBAL", {}),
            "CNBC": ("https://cnbc.example/rss", "GLOBAL", {}),
            "Broken": ("https://broken.example/rss", "GLOBAL", {}),
        }

    def fake_fetch(self, url):
        if url not in self.feeds:
            raise OSError("HTTP Error 403")
        return self.feeds[url]

    def test_fetch_all(self):
        with mock.patch.object(build, "fetch_feed", self.fake_fetch), \
                mock.patch.object(build.config, "FEEDS", self.config_feeds):
            items, health = build.fetch_all()

        titles = [i["title"] for i in items]
        self.assertIn("[속보] 금통위 기준금리 인하", titles)
        self.assertNotIn("오늘의 날씨", titles)          # HOT 아님
        self.assertNotIn("오래된 코스피 기사", titles)    # 24시간 초과
        fed = [i for i in items if i["title"].startswith("Fed cuts")]
        self.assertEqual(len(fed), 1)                     # 매체 간 중복 제거
        self.assertEqual(fed[0]["source"], "Reuters")     # 먼저 보도한 쪽 유지
        self.assertEqual(fed[0]["publisher"], "Reuters")
        self.assertEqual(fed[0]["also"], ["CNBC"])
        self.assertTrue(next(i for i in items if "금통위" in i["title"])["urgent"])
        self.assertEqual([h["ok"] for h in health], [True, True, True, False])

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "dist"
            build.build_site({"generated_ts": 1, "items": items, "sources": health}, out)
            index = (out / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("/*__INITIAL_DATA__*/null", index)
            self.assertIn("금통위", index)
            self.assertNotIn("__VERSION__", (out / "sw.js").read_text(encoding="utf-8"))
            self.assertEqual(len(json.loads((out / "data.json").read_text())["items"]), len(items))
            self.assertTrue((out / "icons" / "icon-192.png").exists())


class NotifyTest(unittest.TestCase):
    def item(self, n, urgent=False):
        return {"id": f"id{n}", "region": "GLOBAL", "category": "증시", "source": "CNBC",
                "publisher": None, "urgent": urgent, "title": f"Headline <{n}> & co",
                "link": f"https://x/{n}?a=1&b=2", "time": "2026-10-07T03:00:00+00:00",
                "time_ts": 1791342000}

    def test_messages_escaped_and_split(self):
        items = [self.item(i) for i in range(40)]
        msgs = notify.build_messages(items, "https://example.github.io/market-issue/")
        self.assertTrue(all(len(m) <= 4096 for m in msgs))
        self.assertIn("&lt;0&gt; &amp; co", msgs[0])
        self.assertIn("외 25건", msgs[-1])
        self.assertIn("대시보드 열기", msgs[-1])

    def test_state_flow(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data.json"
            st = Path(tmp) / "state" / "sent.json"
            sent = []
            env = {"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "c", "ALERT_MODE": ""}
            with mock.patch.object(notify, "DATA_FILE", data), \
                    mock.patch.object(notify, "STATE_FILE", st), \
                    mock.patch.object(notify, "send_telegram", lambda t, c, text: sent.append(text)), \
                    mock.patch.dict("os.environ", env):
                data.write_text(json.dumps({"items": [self.item(1, True)]}))
                notify.main()                       # 첫 실행: 기록만
                self.assertEqual(sent, [])
                data.write_text(json.dumps({"items": [self.item(1, True), self.item(2, True),
                                                      self.item(3, False)]}))
                notify.main()                       # 새 긴급 1건만 발송
                self.assertEqual(len(sent), 1)
                self.assertIn("Headline &lt;2&gt;", sent[0])
                self.assertNotIn("&lt;3&gt;", sent[0])
                notify.main()                       # 재실행: 중복 없음
                self.assertEqual(len(sent), 1)


if __name__ == "__main__":
    unittest.main()
