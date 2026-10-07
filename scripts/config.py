"""
뉴스 소스 · 키워드 · 알림 설정
- 키워드/피드 추가·삭제는 이 파일만 수정하면 됩니다.
"""

# ===== 뉴스 소스 =====
# name: (url, region, options)
#   region: "KR" | "GLOBAL"
#   options:
#     take_all  : 키워드 매칭 없이 전부 수집 (중앙은행 보도자료 등)
#     category  : take_all 일 때 붙일 카테고리
#     urgent    : 이 소스의 기사는 모두 긴급 알림 대상
#     limit     : 피드에서 읽을 최대 기사 수 (기본 60)

GN_EN = "&hl=en-US&gl=US&ceid=US:en"
GN_KO = "&hl=ko&gl=KR&ceid=KR:ko"
GN_SEARCH = "https://news.google.com/rss/search?q="

FEEDS = {
    # ---------- 한국 ----------
    "한경 증권": ("https://www.hankyung.com/feed/finance", "KR", {}),
    "한경 경제": ("https://www.hankyung.com/feed/economy", "KR", {}),
    "한경 국제": ("https://www.hankyung.com/feed/international", "KR", {}),
    "연합 경제": ("https://www.yna.co.kr/rss/economy.xml", "KR", {}),
    "연합 증권": ("https://www.yna.co.kr/rss/market.xml", "KR", {}),
    "연합 국제": ("https://www.yna.co.kr/rss/international.xml", "KR", {}),
    "매경 증권": ("https://www.mk.co.kr/rss/50200011/", "KR", {}),
    "연합인포맥스": ("https://news.einfomax.co.kr/rss/allArticle.xml", "KR", {}),
    "구글뉴스 증시": (GN_SEARCH + "코스피+OR+코스닥+OR+환율+when:1d" + GN_KO, "KR", {}),

    # ---------- 글로벌: 통신사·주요 경제지 (구글뉴스 경유) ----------
    # Reuters/Bloomberg/AP 는 공식 RSS 가 없거나 막혀 있어 구글뉴스 검색 RSS 로 수집
    "Reuters": (GN_SEARCH + "site:reuters.com+(markets+OR+stocks+OR+economy+OR+Fed)+when:1d" + GN_EN, "GLOBAL", {}),
    "Bloomberg": (GN_SEARCH + "site:bloomberg.com+(markets+OR+stocks+OR+economy)+when:1d" + GN_EN, "GLOBAL", {}),
    "AP Business": (GN_SEARCH + "site:apnews.com+(stocks+OR+economy+OR+tariff)+when:1d" + GN_EN, "GLOBAL", {}),
    "구글뉴스 Business": ("https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en", "GLOBAL", {}),
    "구글뉴스 Fed·금리": (GN_SEARCH + "(Fed+OR+FOMC+OR+Powell+OR+%22Treasury+yields%22)+when:1d" + GN_EN, "GLOBAL", {}),
    "구글뉴스 아시아": (GN_SEARCH + "(Nikkei+OR+%22Hang+Seng%22+OR+KOSPI+OR+yuan+OR+yen)+markets+when:1d" + GN_EN, "GLOBAL", {}),

    # ---------- 글로벌: 직접 RSS ----------
    "Bloomberg Markets": ("https://feeds.bloomberg.com/markets/news.rss", "GLOBAL", {}),
    "CNBC Top": ("https://www.cnbc.com/id/100003114/device/rss/rss.html", "GLOBAL", {}),
    "CNBC Markets": ("https://www.cnbc.com/id/10000664/device/rss/rss.html", "GLOBAL", {}),
    "CNBC Economy": ("https://www.cnbc.com/id/20910258/device/rss/rss.html", "GLOBAL", {}),
    "CNBC World": ("https://www.cnbc.com/id/100727362/device/rss/rss.html", "GLOBAL", {}),
    "CNBC Tech": ("https://www.cnbc.com/id/19854910/device/rss/rss.html", "GLOBAL", {}),
    "MarketWatch": ("https://feeds.marketwatch.com/marketwatch/topstories/", "GLOBAL", {}),
    "MarketWatch Pulse": ("https://feeds.marketwatch.com/marketwatch/marketpulse/", "GLOBAL", {}),
    "WSJ Markets": ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "GLOBAL", {}),
    "WSJ World": ("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "GLOBAL", {}),
    "FT Markets": ("https://www.ft.com/markets?format=rss", "GLOBAL", {}),
    "Yahoo Finance": ("https://finance.yahoo.com/news/rssindex", "GLOBAL", {}),
    "Investing 증시": ("https://www.investing.com/rss/news_25.rss", "GLOBAL", {}),
    "Investing 경제": ("https://www.investing.com/rss/news_14.rss", "GLOBAL", {}),
    "Investing 원자재": ("https://www.investing.com/rss/news_11.rss", "GLOBAL", {}),
    "SCMP Business": ("https://www.scmp.com/rss/92/feed", "GLOBAL", {}),
    "BBC Business": ("https://feeds.bbci.co.uk/news/business/rss.xml", "GLOBAL", {}),

    # ---------- 중앙은행 원문 (전부 수집) ----------
    "Fed 보도자료": ("https://www.federalreserve.gov/feeds/press_all.xml", "GLOBAL",
                  {"take_all": True, "category": "Fed·중앙은행", "urgent": True}),
    "ECB 보도자료": ("https://www.ecb.europa.eu/rss/press.html", "GLOBAL",
                  {"take_all": True, "category": "Fed·중앙은행"}),
}

# ===== HOT 키워드 (카테고리별) =====
# 위에서부터 먼저 매칭되는 카테고리가 붙습니다.
# 한국어는 부분 문자열, 영어는 단어 단위(복수형 s/es 허용, 대소문자 무시)로 매칭.
KEYWORDS_KR = {
    "통화·금리": ["한국은행", "한은", "기준금리", "금통위", "이창용", "국고채", "금리"],
    "환율·외환": ["환율", "원달러", "원·달러", "외환", "달러"],
    "기업이벤트": ["감자", "유상증자", "전환사채", "리픽싱", "자사주", "거래정지", "관리종목",
                "상장폐지", "공시", "배당", "어닝", "영업이익", "실적"],
    "정책·당국": ["금감원", "금융위", "거래소", "금융당국", "밸류업", "공매도", "상법"],
    "물가·지표": ["CPI", "물가", "수출", "무역수지", "GDP", "성장률", "고용"],
    "해외변수": ["트럼프", "관세", "연준", "파월", "FOMC", "美", "미국", "중국", "엔비디아",
              "테슬라", "애플", "무역분쟁", "무역전쟁", "유가"],
    "종목·섹터": ["삼성전자", "SK하이닉스", "반도체", "HBM", "2차전지", "방산", "조선", "바이오",
              "현대차"],
    "증시": ["코스피", "코스닥", "외국인", "기관", "순매수", "순매도", "시가총액", "증시"],
}

KEYWORDS_EN = {
    "Fed·중앙은행": ["Fed", "FOMC", "Powell", "rate cut", "rate hike", "interest rate",
                  "central bank", "BOJ", "ECB", "BOE", "PBOC", "Lagarde", "Ueda"],
    "매크로지표": ["CPI", "PCE", "inflation", "jobs report", "payrolls", "nonfarm",
              "unemployment", "jobless claims", "GDP", "recession", "retail sales",
              "ISM", "PMI", "consumer sentiment", "consumer confidence"],
    "정책·정치": ["Trump", "tariff", "trade war", "trade deal", "sanction", "executive order",
              "shutdown", "debt ceiling", "White House", "Congress", "Bessent",
              "Treasury Secretary"],
    "지정학": ["war", "ceasefire", "missile", "invasion", "Ukraine", "Russia", "Israel",
            "Iran", "Gaza", "Taiwan", "North Korea", "Middle East"],
    "빅테크·반도체": ["Nvidia", "Apple", "Tesla", "Microsoft", "Alphabet", "Google", "Amazon",
                "Meta", "Broadcom", "TSMC", "Samsung", "SK Hynix", "semiconductor",
                "chipmaker", "chip", "AI"],
    "실적·기업": ["earnings", "guidance", "profit warning", "downgrade", "upgrade", "IPO",
              "merger", "acquisition", "buyback", "bankruptcy", "layoff"],
    "금리·채권·달러": ["Treasury", "Treasuries", "yield", "bond", "dollar", "DXY", "yen",
                 "yuan", "euro", "currency"],
    "원자재·에너지": ["oil", "crude", "OPEC", "Brent", "WTI", "gold", "copper",
                "natural gas", "bitcoin", "crypto"],
    "아시아·신흥국": ["Korea", "KOSPI", "Japan", "Nikkei", "Hang Seng", "China", "India",
                "emerging market"],
    "증시": ["S&P 500", "Nasdaq", "Dow", "Russell 2000", "Wall Street", "stock", "selloff",
           "sell-off", "rally", "plunge", "surge", "crash", "record high", "correction",
           "VIX", "futures"],
}

# ===== 긴급(알림) 키워드 =====
# HOT 기사 중 아래 키워드가 들어간 것만 텔레그램으로 즉시 발송 (ALERT_MODE=urgent 기본값)
URGENT_KR = ["속보", "긴급", "금통위", "기준금리", "거래정지", "상장폐지", "서킷브레이커",
             "사이드카", "급락", "급등", "폭락", "폭등", "관세", "FOMC"]
URGENT_EN = ["breaking", "FOMC", "rate cut", "rate hike", "emergency", "crash", "plunge",
             "circuit breaker", "halt", "tariff", "sanction", "default", "bankruptcy",
             "ceasefire", "missile", "invasion"]

# ===== DART 공시 (DART_API_KEY 설정 시) =====
DART_KEYWORDS = ["감자", "유상증자", "전환사채", "자사주", "거래정지", "관리종목", "상장폐지"]

# ===== 한국 증시 휴장일 (KRX 공지로 매년 확인 필요) =====
KR_HOLIDAYS = [
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
    "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-08-17",
    "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25",
    "2026-12-31",
]

LOOKBACK_HOURS = 24
DEFAULT_FEED_LIMIT = 60
