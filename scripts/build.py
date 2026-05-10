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
    "Fed", "FOMC", "rate cut", "rate hike", "CPI", "PCE", "Powell", "BOJ", "E
