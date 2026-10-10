// 자동 생성 파일 — 직접 고치지 마세요 (python cloudflare/build.py)
// HOT 시장 이슈 — Cloudflare Worker
// - 크론(2분마다): 뉴스 RSS 를 몇 묶음으로 나눠 돌아가며 수집 → KV 저장 → 새 긴급 이슈 텔레그램 발송
// - 웹 요청: PWA 대시보드(/), 데이터(/data.json), 정적 파일 제공
//
// ⚠ 이 파일을 직접 고치지 말고 scripts/config.py · web/ · cloudflare/src/ 를 고친 뒤
//   python cloudflare/build.py 로 cloudflare/worker.js 를 다시 만드세요.
//
// 필요한 설정 (Cloudflare 대시보드)
//   KV 바인딩  STORE                    : 수집 결과·발송 기록 저장
//   Secret     TELEGRAM_BOT_TOKEN       : 텔레그램 봇 토큰 (없으면 알림 생략)
//   Secret     TELEGRAM_CHAT_ID         : 텔레그램 채팅방 ID
//   변수(선택) ALERT_MODE               : urgent(기본) | all | off
//   변수(선택) DASHBOARD_URL            : 알림 메시지에 넣을 대시보드 주소
//   Secret(선택) DART_API_KEY           : DART 공시 수집
//   크론 트리거 */2 * * * *

const CONFIG = {
 "feeds": [
  {
   "name": "한경 증권",
   "url": "https://www.hankyung.com/feed/finance",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "한경 경제",
   "url": "https://www.hankyung.com/feed/economy",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "한경 국제",
   "url": "https://www.hankyung.com/feed/international",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "연합 경제",
   "url": "https://www.yna.co.kr/rss/economy.xml",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "연합 증권",
   "url": "https://www.yna.co.kr/rss/market.xml",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "연합 국제",
   "url": "https://www.yna.co.kr/rss/international.xml",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "매경 증권",
   "url": "https://www.mk.co.kr/rss/50200011/",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "연합인포맥스",
   "url": "https://news.einfomax.co.kr/rss/allArticle.xml",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "구글뉴스 증시",
   "url": "https://news.google.com/rss/search?q=코스피+OR+코스닥+OR+환율+when:1d&hl=ko&gl=KR&ceid=KR:ko",
   "region": "KR",
   "opts": {}
  },
  {
   "name": "Reuters",
   "url": "https://news.google.com/rss/search?q=site:reuters.com+(markets+OR+stocks+OR+economy+OR+Fed)+when:1d&hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Bloomberg",
   "url": "https://news.google.com/rss/search?q=site:bloomberg.com+(markets+OR+stocks+OR+economy)+when:1d&hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "AP Business",
   "url": "https://news.google.com/rss/search?q=site:apnews.com+(stocks+OR+economy+OR+tariff)+when:1d&hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "구글뉴스 Business",
   "url": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "구글뉴스 Fed·금리",
   "url": "https://news.google.com/rss/search?q=(Fed+OR+FOMC+OR+Powell+OR+%22Treasury+yields%22)+when:1d&hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "구글뉴스 아시아",
   "url": "https://news.google.com/rss/search?q=(Nikkei+OR+%22Hang+Seng%22+OR+KOSPI+OR+yuan+OR+yen)+markets+when:1d&hl=en-US&gl=US&ceid=US:en",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Bloomberg Markets",
   "url": "https://feeds.bloomberg.com/markets/news.rss",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "CNBC Top",
   "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "CNBC Markets",
   "url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "CNBC Economy",
   "url": "https://www.cnbc.com/id/20910258/device/rss/rss.html",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "CNBC World",
   "url": "https://www.cnbc.com/id/100727362/device/rss/rss.html",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "CNBC Tech",
   "url": "https://www.cnbc.com/id/19854910/device/rss/rss.html",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "MarketWatch",
   "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "MarketWatch Pulse",
   "url": "https://feeds.marketwatch.com/marketwatch/marketpulse/",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "WSJ Markets",
   "url": "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "WSJ World",
   "url": "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "FT Markets",
   "url": "https://www.ft.com/markets?format=rss",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Yahoo Finance",
   "url": "https://finance.yahoo.com/news/rssindex",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Investing 증시",
   "url": "https://www.investing.com/rss/news_25.rss",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Investing 경제",
   "url": "https://www.investing.com/rss/news_14.rss",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Investing 원자재",
   "url": "https://www.investing.com/rss/news_11.rss",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "SCMP Business",
   "url": "https://www.scmp.com/rss/92/feed",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "BBC Business",
   "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
   "region": "GLOBAL",
   "opts": {}
  },
  {
   "name": "Fed 보도자료",
   "url": "https://www.federalreserve.gov/feeds/press_all.xml",
   "region": "GLOBAL",
   "opts": {
    "take_all": true,
    "category": "Fed·중앙은행",
    "urgent": true
   }
  },
  {
   "name": "ECB 보도자료",
   "url": "https://www.ecb.europa.eu/rss/press.html",
   "region": "GLOBAL",
   "opts": {
    "take_all": true,
    "category": "Fed·중앙은행"
   }
  }
 ],
 "keywords_kr": [
  [
   "통화·금리",
   [
    "한국은행",
    "한은",
    "기준금리",
    "금통위",
    "이창용",
    "국고채",
    "금리"
   ]
  ],
  [
   "환율·외환",
   [
    "환율",
    "원달러",
    "원·달러",
    "외환",
    "달러"
   ]
  ],
  [
   "기업이벤트",
   [
    "감자",
    "유상증자",
    "전환사채",
    "리픽싱",
    "자사주",
    "거래정지",
    "관리종목",
    "상장폐지",
    "공시",
    "배당",
    "어닝",
    "영업이익",
    "실적"
   ]
  ],
  [
   "정책·당국",
   [
    "금감원",
    "금융위",
    "거래소",
    "금융당국",
    "밸류업",
    "공매도",
    "상법"
   ]
  ],
  [
   "물가·지표",
   [
    "CPI",
    "물가",
    "수출",
    "무역수지",
    "GDP",
    "성장률",
    "고용"
   ]
  ],
  [
   "해외변수",
   [
    "트럼프",
    "관세",
    "연준",
    "파월",
    "FOMC",
    "美",
    "미국",
    "중국",
    "엔비디아",
    "테슬라",
    "애플",
    "무역분쟁",
    "무역전쟁",
    "유가"
   ]
  ],
  [
   "종목·섹터",
   [
    "삼성전자",
    "SK하이닉스",
    "반도체",
    "HBM",
    "2차전지",
    "방산",
    "조선",
    "바이오",
    "현대차"
   ]
  ],
  [
   "증시",
   [
    "코스피",
    "코스닥",
    "외국인",
    "기관",
    "순매수",
    "순매도",
    "시가총액",
    "증시"
   ]
  ]
 ],
 "keywords_en": [
  [
   "Fed·중앙은행",
   [
    "Fed",
    "FOMC",
    "Powell",
    "rate cut",
    "rate hike",
    "interest rate",
    "central bank",
    "BOJ",
    "ECB",
    "BOE",
    "PBOC",
    "Lagarde",
    "Ueda"
   ]
  ],
  [
   "매크로지표",
   [
    "CPI",
    "PCE",
    "inflation",
    "jobs report",
    "payrolls",
    "nonfarm",
    "unemployment",
    "jobless claims",
    "GDP",
    "recession",
    "retail sales",
    "ISM",
    "PMI",
    "consumer sentiment",
    "consumer confidence"
   ]
  ],
  [
   "정책·정치",
   [
    "Trump",
    "tariff",
    "trade war",
    "trade deal",
    "sanction",
    "executive order",
    "shutdown",
    "debt ceiling",
    "White House",
    "Congress",
    "Bessent",
    "Treasury Secretary"
   ]
  ],
  [
   "지정학",
   [
    "war",
    "ceasefire",
    "missile",
    "invasion",
    "Ukraine",
    "Russia",
    "Israel",
    "Iran",
    "Gaza",
    "Taiwan",
    "North Korea",
    "Middle East"
   ]
  ],
  [
   "빅테크·반도체",
   [
    "Nvidia",
    "Apple",
    "Tesla",
    "Microsoft",
    "Alphabet",
    "Google",
    "Amazon",
    "Meta",
    "Broadcom",
    "TSMC",
    "Samsung",
    "SK Hynix",
    "semiconductor",
    "chipmaker",
    "chip",
    "AI"
   ]
  ],
  [
   "실적·기업",
   [
    "earnings",
    "guidance",
    "profit warning",
    "downgrade",
    "upgrade",
    "IPO",
    "merger",
    "acquisition",
    "buyback",
    "bankruptcy",
    "layoff"
   ]
  ],
  [
   "금리·채권·달러",
   [
    "Treasury",
    "Treasuries",
    "yield",
    "bond",
    "dollar",
    "DXY",
    "yen",
    "yuan",
    "euro",
    "currency"
   ]
  ],
  [
   "원자재·에너지",
   [
    "oil",
    "crude",
    "OPEC",
    "Brent",
    "WTI",
    "gold",
    "copper",
    "natural gas",
    "bitcoin",
    "crypto"
   ]
  ],
  [
   "아시아·신흥국",
   [
    "Korea",
    "KOSPI",
    "Japan",
    "Nikkei",
    "Hang Seng",
    "China",
    "India",
    "emerging market"
   ]
  ],
  [
   "증시",
   [
    "S&P 500",
    "Nasdaq",
    "Dow",
    "Russell 2000",
    "Wall Street",
    "stock",
    "selloff",
    "sell-off",
    "rally",
    "plunge",
    "surge",
    "crash",
    "record high",
    "correction",
    "VIX",
    "futures"
   ]
  ]
 ],
 "urgent_kr": [
  "속보",
  "긴급",
  "금통위",
  "기준금리",
  "거래정지",
  "상장폐지",
  "서킷브레이커",
  "사이드카",
  "급락",
  "급등",
  "폭락",
  "폭등",
  "관세",
  "FOMC"
 ],
 "urgent_en": [
  "breaking",
  "FOMC",
  "rate cut",
  "rate hike",
  "emergency",
  "crash",
  "plunge",
  "circuit breaker",
  "halt",
  "tariff",
  "sanction",
  "default",
  "bankruptcy",
  "ceasefire",
  "missile",
  "invasion"
 ],
 "dart_keywords": [
  "감자",
  "유상증자",
  "전환사채",
  "자사주",
  "거래정지",
  "관리종목",
  "상장폐지"
 ],
 "kr_holidays": [
  "2026-01-01",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-02",
  "2026-05-01",
  "2026-05-05",
  "2026-05-25",
  "2026-06-03",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-10-05",
  "2026-10-09",
  "2026-12-25",
  "2026-12-31"
 ],
 "lookback_hours": 24,
 "default_feed_limit": 60,
 "batches": 3
};
const ASSETS = {"app.js": {"type": "text/javascript; charset=utf-8", "body": "(() => {\n  'use strict';\n\n  const REFRESH_MS = 60 * 1000;        // 앱이 열려 있을 때 데이터 확인 주기\n  const STALE_MIN = 20;                // 빌드가 이보다 오래되면 지연 경고\n  const SEEN_KEY = 'hot-seen-ids';\n  const TAB_KEY = 'hot-tab';\n\n  const $ = (id) => document.getElementById(id);\n  const store = {\n    get(key, fallback) {\n      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }\n      catch { return fallback; }\n    },\n    set(key, value) {\n      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사파리 사생활 보호 모드 등 */ }\n    },\n  };\n\n  const state = {\n    data: null,\n    tab: store.get(TAB_KEY, 'all'),\n    category: null,\n    query: '',\n    newIds: new Set(),\n    lastChecked: null,\n  };\n\n  // ---------- 유틸 ----------\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => (\n    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n\n  const kstFmt = new Intl.DateTimeFormat('en-US', {\n    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',\n    hour: '2-digit', minute: '2-digit', hour12: false,\n  });\n  function fmtKst(ts) {\n    const p = Object.fromEntries(kstFmt.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));\n    return `${p.month}-${p.day} ${String(parseInt(p.hour, 10) % 24).padStart(2, '0')}:${p.minute}`;\n  }\n\n  function relTime(ts) {\n    const min = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));\n    if (min < 1) return '방금';\n    if (min < 60) return `${min}분 전`;\n    const h = Math.floor(min / 60);\n    return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;\n  }\n\n  function zonedParts(tz) {\n    const parts = new Intl.DateTimeFormat('en-US', {\n      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',\n      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,\n    }).formatToParts(new Date());\n    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));\n    return {\n      date: `${p.year}-${p.month}-${p.day}`,\n      weekend: p.weekday === 'Sat' || p.weekday === 'Sun',\n      minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10),\n    };\n  }\n\n  // ---------- 시장 상태 ----------\n  function marketStatus() {\n    const holidays = state.data?.kr_holidays || [];\n    const kr = zonedParts('Asia/Seoul');\n    const us = zonedParts('America/New_York');\n    let krLabel;\n    if (kr.weekend || holidays.includes(kr.date)) krLabel = ['KRX 휴장', false];\n    else if (kr.minutes >= 540 && kr.minutes < 930) krLabel = ['KRX 장중', true];\n    else krLabel = ['KRX 마감', false];\n    const usOpen = !us.weekend && us.minutes >= 570 && us.minutes < 960;\n    const usLabel = [usOpen ? 'NYSE 장중' : 'NYSE 마감', usOpen];\n    $('markets').innerHTML = [krLabel, usLabel]\n      .map(([label, open]) => `<span class=\"mkt${open ? ' open' : ''}\">${label}</span>`).join('');\n    return { krClosedToday: kr.weekend || holidays.includes(kr.date) };\n  }\n\n  // ---------- 렌더링 ----------\n  function filtered(items, { ignoreCategory = false } = {}) {\n    const q = state.query.trim().toLowerCase();\n    return items.filter((it) => {\n      if (state.tab === 'KR' || state.tab === 'GLOBAL') { if (it.region !== state.tab) return false; }\n      else if (state.tab === 'urgent' && !it.urgent) return false;\n      if (!ignoreCategory && state.category && it.category !== state.category) return false;\n      if (q) {\n        const hay = `${it.title} ${it.source} ${it.publisher || ''} ${it.keyword} ${it.category}`.toLowerCase();\n        if (!hay.includes(q)) return false;\n      }\n      return true;\n    });\n  }\n\n  function rowHtml(it) {\n    const isNew = state.newIds.has(it.id);\n    const src = it.publisher && it.publisher !== it.source ? `${it.source} · ${it.publisher}` : it.source;\n    const also = it.also?.length ? ` +${it.also.length}` : '';\n    return `\n      <a class=\"row${it.urgent ? ' urgent' : ''}${isNew ? ' new' : ''}\" href=\"${esc(it.link)}\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"row-time\">${esc(fmtKst(it.time_ts))}<span class=\"rel\">${relTime(it.time_ts)}</span></div>\n        <div class=\"row-content\">\n          <div class=\"row-title\">${isNew ? '<span class=\"badge new\">NEW</span>' : ''}${it.urgent ? '<span class=\"badge urgent\">긴급</span>' : ''}${esc(it.title)}</div>\n          <div class=\"row-meta\">\n            <span class=\"cat\">${esc(it.category)}</span>\n            <span class=\"kw\">${esc(it.keyword)}</span>\n            <span class=\"src\" title=\"${esc((it.also || []).join(', '))}\">${esc(src)}${also}</span>\n          </div>\n        </div>\n      </a>`;\n  }\n\n  function listHtml(items) {\n    return items.length ? items.map(rowHtml).join('') : '<div class=\"empty\">조건에 맞는 이슈가 없습니다</div>';\n  }\n\n  function sectionHtml(region, items) {\n    const label = region === 'KR' ? ['KR', '한국 시장'] : ['GLOBAL', '해외 시장 / 매크로'];\n    return `\n      <section>\n        <div class=\"section-header\">\n          <span class=\"section-tag tag-${region}\">${label[0]}</span>\n          <span class=\"section-title\">${label[1]}</span>\n          <span class=\"section-count\">${items.length} items</span>\n        </div>\n        ${listHtml(items)}\n      </section>`;\n  }\n\n  function renderChips(items) {\n    const counts = new Map();\n    for (const it of items) counts.set(it.category, (counts.get(it.category) || 0) + 1);\n    if (state.category && !counts.has(state.category)) state.category = null;\n    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);\n    $('chips').innerHTML = [\n      `<button type=\"button\" class=\"chip${state.category ? '' : ' active'}\" data-cat=\"\">전체<span class=\"n\">${items.length}</span></button>`,\n      ...sorted.map(([cat, n]) => `<button type=\"button\" class=\"chip${state.category === cat ? ' active' : ''}\" data-cat=\"${esc(cat)}\">${esc(cat)}<span class=\"n\">${n}</span></button>`),\n    ].join('');\n  }\n\n  function renderTabs(items) {\n    const counts = {\n      all: items.length,\n      KR: items.filter((i) => i.region === 'KR').length,\n      GLOBAL: items.filter((i) => i.region === 'GLOBAL').length,\n      urgent: items.filter((i) => i.urgent).length,\n    };\n    for (const btn of $('tabs').querySelectorAll('button')) {\n      btn.classList.toggle('active', btn.dataset.tab === state.tab);\n      btn.setAttribute('aria-selected', btn.dataset.tab === state.tab);\n      btn.querySelector('.cnt').textContent = counts[btn.dataset.tab];\n    }\n  }\n\n  function renderStatus() {\n    const d = state.data;\n    if (!d) return;\n    const updated = $('updated');\n    if (!d.generated_ts) {\n      updated.textContent = '첫 수집 대기 중 (몇 분 내 자동 시작)';\n      updated.classList.remove('stale');\n      marketStatus();\n      return;\n    }\n    const ageMin = Math.floor((Date.now() / 1000 - d.generated_ts) / 60);\n    updated.textContent = `서버 갱신 ${fmtKst(d.generated_ts)} (${relTime(d.generated_ts)})`;\n    updated.classList.toggle('stale', ageMin >= STALE_MIN);\n    if (ageMin >= STALE_MIN) updated.textContent += ' ⚠ 지연 중';\n    $('checked').textContent = state.lastChecked\n      ? `확인 ${relTime(Math.floor(state.lastChecked / 1000))}` : '';\n\n    const { krClosedToday } = marketStatus();\n    const notice = $('notice');\n    notice.hidden = !krClosedToday;\n    notice.innerHTML = krClosedToday ? '<strong>NOTICE</strong>오늘은 한국 증시 휴장일 — 글로벌 이슈 위주로 확인하세요' : '';\n  }\n\n  function renderSources() {\n    const sources = state.data?.sources || [];\n    const ok = sources.filter((s) => s.ok).length;\n    $('source-summary').textContent = `수집 소스 ${ok}/${sources.length} 정상`;\n    $('sources').innerHTML = sources.map((s) => (s.ok\n      ? `<li><span class=\"ok\">✓</span> ${esc(s.name)} <span>${s.hot}/${s.entries}</span></li>`\n      : `<li title=\"${esc(s.error)}\"><span class=\"fail\">✗</span> ${esc(s.name)} <span>${esc(s.error || '')}</span></li>`\n    )).join('');\n    $('lookback').textContent = state.data?.lookback_hours ?? 24;\n  }\n\n  function render() {\n    const items = state.data?.items || [];\n    renderTabs(items);\n    renderChips(filtered(items, { ignoreCategory: true }));\n    renderStatus();\n    renderSources();\n\n    const visible = filtered(items);\n    const list = $('list');\n    if (state.tab === 'all') {\n      list.innerHTML = `<div class=\"columns two\">${sectionHtml('KR', visible.filter((i) => i.region === 'KR'))}${sectionHtml('GLOBAL', visible.filter((i) => i.region === 'GLOBAL'))}</div>`;\n    } else {\n      list.innerHTML = `<div class=\"columns\"><section>${listHtml(visible)}</section></div>`;\n    }\n  }\n\n  // ---------- 데이터 ----------\n  function applyData(data, { notify = false } = {}) {\n    const seen = store.get(SEEN_KEY, null);\n    const fresh = seen ? data.items.filter((it) => !seen.includes(it.id)) : [];\n    for (const it of fresh) state.newIds.add(it.id);\n\n    // 처음 방문이면 전부 '본 것'으로 기록 (NEW 남발 방지)\n    const ids = data.items.map((it) => it.id);\n    store.set(SEEN_KEY, [...new Set([...ids, ...(seen || [])])].slice(0, 800));\n\n    state.data = data;\n    render();\n\n    if (notify && fresh.length) {\n      showToast(`새 이슈 ${fresh.length}건`);\n      document.title = `(${state.newIds.size}) HOT 시장 이슈`;\n      const urgent = fresh.filter((it) => it.urgent);\n      if (urgent.length) systemNotify(urgent);\n    }\n  }\n\n  async function refresh({ manual = false } = {}) {\n    const btn = $('refresh-btn');\n    btn.classList.add('spinning');\n    try {\n      const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });\n      if (!res.ok) throw new Error(res.status);\n      const data = await res.json();\n      state.lastChecked = Date.now();\n      if (!state.data || (data.generated_ts || 0) > (state.data.generated_ts || 0)) {\n        applyData(data, { notify: Boolean(state.data) });\n      } else {\n        renderStatus();\n        if (manual) showToast('최신 상태입니다');\n      }\n    } catch (e) {\n      if (manual) showToast('갱신 실패 — 네트워크를 확인하세요');\n    } finally {\n      btn.classList.remove('spinning');\n    }\n  }\n\n  // ---------- 알림 ----------\n  let toastTimer;\n  function showToast(text) {\n    const t = $('toast');\n    t.textContent = text;\n    t.hidden = false;\n    clearTimeout(toastTimer);\n    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);\n  }\n\n  async function systemNotify(items) {\n    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;\n    const title = items.length === 1 ? '🚨 긴급 시장 이슈' : `🚨 긴급 시장 이슈 ${items.length}건`;\n    const body = items.slice(0, 3).map((i) => `[${i.category}] ${i.title}`).join('\\n');\n    try {\n      const reg = await navigator.serviceWorker?.getRegistration();\n      if (reg) reg.showNotification(title, { body, tag: 'hot-urgent', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });\n      else new Notification(title, { body });\n    } catch { /* 알림 미지원 환경 */ }\n  }\n\n  function setupNotifyButton() {\n    const btn = $('notify-btn');\n    if (!('Notification' in window) || Notification.permission !== 'default') return;\n    btn.hidden = false;\n    btn.addEventListener('click', async () => {\n      const result = await Notification.requestPermission();\n      btn.hidden = true;\n      showToast(result === 'granted' ? '앱이 열려 있는 동안 긴급 이슈를 알려드립니다' : '알림이 차단되었습니다');\n    });\n  }\n\n  // ---------- 이벤트 ----------\n  $('tabs').addEventListener('click', (e) => {\n    const btn = e.target.closest('button[data-tab]');\n    if (!btn) return;\n    state.tab = btn.dataset.tab;\n    state.category = null;\n    store.set(TAB_KEY, state.tab);\n    render();\n  });\n  $('chips').addEventListener('click', (e) => {\n    const chip = e.target.closest('.chip');\n    if (!chip) return;\n    state.category = chip.dataset.cat || null;\n    render();\n  });\n  let searchTimer;\n  $('search').addEventListener('input', (e) => {\n    clearTimeout(searchTimer);\n    searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 150);\n  });\n  $('refresh-btn').addEventListener('click', () => refresh({ manual: true }));\n  $('toast').addEventListener('click', () => {\n    $('toast').hidden = true;\n    window.scrollTo({ top: 0, behavior: 'smooth' });\n  });\n  document.addEventListener('visibilitychange', () => {\n    if (!document.hidden) {\n      document.title = 'HOT 시장 이슈';\n      refresh();   // 앱으로 돌아오면 즉시 최신 데이터 확인\n    }\n  });\n\n  // ---------- 시작 ----------\n  if (!['all', 'KR', 'GLOBAL', 'urgent'].includes(state.tab)) state.tab = 'all';\n  if (window.__INITIAL_DATA__) applyData(window.__INITIAL_DATA__);\n  refresh();\n  setInterval(refresh, REFRESH_MS);\n  setInterval(render, 30 * 1000);   // 'n분 전' 표시 갱신\n  setupNotifyButton();\n\n  if ('serviceWorker' in navigator) {\n    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));\n  }\n})();\n"}, "icons/apple-touch-icon.png": {"type": "image/png", "b64": true, "body": "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"}, "icons/icon-192.png": {"type": "image/png", "b64": true, "body": "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"}, "icons/icon-512.png": {"type": "image/png", "b64": true, "body": "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"}, "icons/icon.svg": {"type": "image/svg+xml", "body": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">\n  <rect width=\"512\" height=\"512\" rx=\"96\" fill=\"#0a0a0a\"/>\n  <polyline points=\"112,340 184,276 240,308 312,212 368,236\" fill=\"none\" stroke=\"#e8e8e8\" stroke-width=\"28\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <circle cx=\"384\" cy=\"172\" r=\"44\" fill=\"#ff8c00\"/>\n</svg>\n"}, "index.html": {"type": "text/html; charset=utf-8", "body": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\">\n<title>HOT 시장 이슈</title>\n<meta name=\"description\" content=\"한국·글로벌 주요 시장 이슈 실시간 대시보드\">\n<meta property=\"og:title\" content=\"HOT 시장 이슈\">\n<meta property=\"og:description\" content=\"한국·글로벌 주요 시장 이슈 실시간 대시보드\">\n<meta name=\"theme-color\" content=\"#0a0a0a\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<meta name=\"apple-mobile-web-app-title\" content=\"HOT이슈\">\n<link rel=\"manifest\" href=\"manifest.webmanifest\">\n<link rel=\"icon\" href=\"icons/icon.svg\" type=\"image/svg+xml\">\n<link rel=\"apple-touch-icon\" href=\"icons/apple-touch-icon.png\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<link rel=\"stylesheet\" href=\"style.css\">\n</head>\n<body>\n<div class=\"container\">\n  <header class=\"header\">\n    <div class=\"title\"><span class=\"blink\">●</span> HOT_ISSUES</div>\n    <div class=\"header-right\">\n      <button class=\"icon-btn\" id=\"refresh-btn\" type=\"button\" aria-label=\"새로고침\" title=\"새로고침\">↻</button>\n      <button class=\"icon-btn\" id=\"notify-btn\" type=\"button\" aria-label=\"알림 켜기\" title=\"새 긴급 이슈 알림 켜기\" hidden>🔔</button>\n    </div>\n  </header>\n\n  <div class=\"status\" id=\"status\">\n    <span class=\"markets\" id=\"markets\"></span>\n    <span id=\"updated\">-</span>\n    <span class=\"dot-sep\">·</span>\n    <span id=\"checked\"></span>\n  </div>\n  <div class=\"notice\" id=\"notice\" hidden></div>\n\n  <nav class=\"tabs\" id=\"tabs\" role=\"tablist\">\n    <button type=\"button\" data-tab=\"all\" class=\"active\">전체 <span class=\"cnt\"></span></button>\n    <button type=\"button\" data-tab=\"KR\">한국 <span class=\"cnt\"></span></button>\n    <button type=\"button\" data-tab=\"GLOBAL\">해외 <span class=\"cnt\"></span></button>\n    <button type=\"button\" data-tab=\"urgent\">긴급 <span class=\"cnt\"></span></button>\n  </nav>\n\n  <div class=\"filters\">\n    <input type=\"search\" id=\"search\" placeholder=\"검색 (예: 엔비디아, Fed, 환율)\" autocomplete=\"off\">\n    <div class=\"chips\" id=\"chips\"></div>\n  </div>\n\n  <main id=\"list\"></main>\n\n  <footer class=\"footer\">\n    <details>\n      <summary id=\"source-summary\">수집 소스</summary>\n      <ul class=\"sources\" id=\"sources\"></ul>\n    </details>\n    <p>HOT 키워드 매칭 · 최근 <span id=\"lookback\">24</span>시간 · 앱을 열어두면 1분마다 자동 갱신</p>\n  </footer>\n</div>\n\n<div class=\"toast\" id=\"toast\" hidden></div>\n\n<script>window.__INITIAL_DATA__ = /*__INITIAL_DATA__*/null;</script>\n<script src=\"app.js\"></script>\n</body>\n</html>\n"}, "manifest.webmanifest": {"type": "application/manifest+json", "body": "{\n  \"name\": \"HOT 시장 이슈\",\n  \"short_name\": \"HOT이슈\",\n  \"description\": \"한국·글로벌 주요 시장 이슈 실시간 대시보드\",\n  \"lang\": \"ko\",\n  \"start_url\": \"./\",\n  \"scope\": \"./\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#0a0a0a\",\n  \"theme_color\": \"#0a0a0a\",\n  \"icons\": [\n    { \"src\": \"icons/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"any\" },\n    { \"src\": \"icons/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"any\" },\n    { \"src\": \"icons/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"maskable\" },\n    { \"src\": \"icons/icon.svg\", \"sizes\": \"any\", \"type\": \"image/svg+xml\" }\n  ]\n}\n"}, "style.css": {"type": "text/css; charset=utf-8", "body": ":root {\n  --bg: #0a0a0a; --bg-card: #121212; --bg-hover: #161616; --border: #1f1f1f;\n  --text: #e8e8e8; --text-dim: #8a8a8a; --text-faint: #5c5c5c;\n  --accent: #ff8c00; --kr: #ff5555; --global: #5599ff; --urgent: #ff3b3b; --ok: #3ccf7a;\n  --mono: 'JetBrains Mono', ui-monospace, monospace;\n}\n* { margin: 0; padding: 0; box-sizing: border-box; }\nhtml { -webkit-text-size-adjust: 100%; }\nbody {\n  background: var(--bg); color: var(--text);\n  font-family: 'IBM Plex Sans KR', -apple-system, 'Apple SD Gothic Neo', sans-serif;\n  font-size: 14px; line-height: 1.5; min-height: 100vh;\n  padding: calc(16px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom));\n}\nbutton { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }\n.container { max-width: 1200px; margin: 0 auto; }\n\n/* header */\n.header {\n  display: flex; justify-content: space-between; align-items: center;\n  flex-wrap: wrap; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--border);\n}\n.title { font-family: var(--mono); font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }\n.title .blink { color: var(--accent); animation: blink 1.5s infinite; }\n@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.3; } }\n.header-right { display: flex; align-items: center; gap: 8px; }\n.markets { display: flex; gap: 6px; font-family: var(--mono); font-size: 11px; }\n.mkt { padding: 3px 7px; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }\n.mkt.open { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }\n.mkt.open::before { content: \"● \"; }\n.icon-btn {\n  width: 34px; height: 34px; border: 1px solid var(--border); font-size: 16px;\n  display: inline-flex; align-items: center; justify-content: center;\n}\n.icon-btn:hover { background: var(--bg-card); }\n.icon-btn.spinning { animation: spin 0.8s linear infinite; }\n@keyframes spin { to { transform: rotate(360deg); } }\n\n/* status */\n.status {\n  font-family: var(--mono); font-size: 12px; color: var(--text-dim);\n  padding: 10px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;\n}\n.status .markets { margin-right: 6px; }\n.status .stale { color: var(--accent); }\n.dot-sep { color: var(--text-faint); }\n.notice {\n  background: var(--bg-card); border-left: 3px solid var(--accent);\n  padding: 9px 12px; margin-bottom: 12px;\n  font-family: var(--mono); font-size: 12px; color: var(--text-dim);\n}\n.notice strong { color: var(--accent); margin-right: 6px; }\n\n/* tabs & filters */\n.tabs {\n  display: flex; gap: 4px; border-bottom: 1px solid var(--border);\n  position: sticky; top: 0; background: var(--bg); z-index: 5;\n  padding-top: env(safe-area-inset-top);\n}\n.tabs button {\n  padding: 10px 14px; font-size: 14px; color: var(--text-dim);\n  border-bottom: 2px solid transparent; margin-bottom: -1px;\n}\n.tabs button.active { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }\n.tabs button[data-tab=\"urgent\"].active { border-bottom-color: var(--urgent); }\n.tabs .cnt { font-family: var(--mono); font-size: 11px; color: var(--text-faint); margin-left: 2px; }\n.filters { padding: 12px 0 4px; }\n#search {\n  width: 100%; padding: 9px 12px; background: var(--bg-card); color: var(--text);\n  border: 1px solid var(--border); font: inherit; font-size: 14px; outline: none;\n}\n#search:focus { border-color: var(--text-faint); }\n.chips { display: flex; gap: 6px; overflow-x: auto; padding: 10px 0 6px; scrollbar-width: none; }\n.chips::-webkit-scrollbar { display: none; }\n.chip {\n  flex-shrink: 0; padding: 4px 10px; border: 1px solid var(--border);\n  font-size: 12px; color: var(--text-dim); white-space: nowrap;\n}\n.chip.active { color: var(--bg); background: var(--accent); border-color: var(--accent); font-weight: 600; }\n.chip .n { font-family: var(--mono); font-size: 10px; opacity: 0.75; margin-left: 3px; }\n\n/* list */\n.columns { display: grid; grid-template-columns: 1fr; gap: 28px; }\n@media (min-width: 1000px) { .columns.two { grid-template-columns: 1fr 1fr; } }\n.section-header {\n  display: flex; align-items: center; gap: 10px; margin: 12px 0 4px;\n  padding-bottom: 8px; border-bottom: 1px dashed var(--border);\n}\n.section-tag {\n  font-family: var(--mono); font-size: 11px; font-weight: 700;\n  letter-spacing: 1px; padding: 2px 8px; border: 1px solid;\n}\n.tag-KR { color: var(--kr); border-color: var(--kr); }\n.tag-GLOBAL { color: var(--global); border-color: var(--global); }\n.section-title { font-size: 13px; color: var(--text-dim); font-family: var(--mono); }\n.section-count { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--text-faint); }\n\n.row {\n  display: flex; gap: 14px; padding: 11px 10px; border-bottom: 1px solid var(--border);\n  text-decoration: none; color: inherit; transition: background 0.15s;\n}\n.row:hover { background: var(--bg-hover); }\n.row.urgent { border-left: 2px solid var(--urgent); padding-left: 8px; }\n.row.new { background: color-mix(in srgb, var(--accent) 7%, transparent); }\n.row-time { font-family: var(--mono); font-size: 12px; color: var(--text-faint); flex-shrink: 0; width: 64px; padding-top: 2px; }\n.row-time .rel { display: block; font-size: 10px; }\n.row-content { flex: 1; min-width: 0; }\n.row-title { font-size: 14px; font-weight: 500; line-height: 1.45; margin-bottom: 4px; overflow-wrap: anywhere; }\n.row:visited .row-title { color: var(--text-dim); }\n.badge {\n  display: inline-block; font-family: var(--mono); font-size: 10px; font-weight: 700;\n  padding: 0 5px; margin-right: 6px; vertical-align: 2px;\n}\n.badge.new { background: var(--accent); color: var(--bg); }\n.badge.urgent { background: var(--urgent); color: #fff; }\n.row-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-family: var(--mono); font-size: 11px; }\n.cat { color: var(--accent); font-weight: 700; }\n.kw { color: var(--text-dim); }\n.kw::before { content: \"# \"; }\n.src { color: var(--text-faint); }\n.src::before { content: \"/ \"; }\n.empty {\n  padding: 24px; text-align: center; color: var(--text-faint);\n  font-family: var(--mono); font-size: 12px; border: 1px dashed var(--border); margin-top: 12px;\n}\n\n/* footer */\n.footer {\n  margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--border);\n  font-family: var(--mono); font-size: 11px; color: var(--text-faint); line-height: 1.7;\n}\n.footer summary { cursor: pointer; color: var(--text-dim); margin-bottom: 6px; }\n.sources { list-style: none; columns: 2 220px; margin: 6px 0 12px; }\n.sources li { break-inside: avoid; }\n.sources .ok { color: var(--ok); }\n.sources .fail { color: var(--urgent); }\n\n.toast {\n  position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom));\n  transform: translateX(-50%); background: var(--accent); color: var(--bg);\n  font-weight: 600; padding: 9px 16px; font-size: 13px; z-index: 10; cursor: pointer;\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);\n}\n\n@media (max-width: 600px) {\n  body { font-size: 13px; padding-left: 12px; padding-right: 12px; }\n  .title { font-size: 18px; }\n  .row { flex-direction: column; gap: 3px; padding: 10px 6px; }\n  .row.urgent { padding-left: 6px; }\n  .row-time { width: auto; font-size: 11px; }\n  .row-time .rel { display: inline; margin-left: 6px; }\n  .tabs button { padding: 10px 10px; }\n}\n"}, "sw.js": {"type": "text/javascript; charset=utf-8", "body": "// 서비스워커: 오프라인에서도 마지막 데이터 표시 + 앱 설치(PWA) 지원\n// be67bcba33 은 빌드 시 웹 자산 내용 해시로 치환됨 (자산이 바뀔 때만 캐시 교체)\nconst CACHE = 'hot-issues-be67bcba33';\nconst SHELL = [\n  './',\n  'index.html',\n  'style.css',\n  'app.js',\n  'manifest.webmanifest',\n  'icons/icon.svg',\n  'icons/icon-192.png',\n  'icons/icon-512.png',\n  'icons/apple-touch-icon.png',\n];\n\nself.addEventListener('install', (event) => {\n  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));\n});\n\nself.addEventListener('activate', (event) => {\n  event.waitUntil(\n    caches.keys()\n      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))\n      .then(() => self.clients.claim())\n  );\n});\n\n// 네트워크 우선, 실패 시 캐시 (뉴스는 항상 최신이 중요)\nasync function networkFirst(request, cacheKey) {\n  const cache = await caches.open(CACHE);\n  try {\n    const res = await fetch(request, { cache: 'no-store' });\n    if (res.ok) cache.put(cacheKey, res.clone());\n    return res;\n  } catch (e) {\n    const cached = await cache.match(cacheKey);\n    if (cached) return cached;\n    throw e;\n  }\n}\n\nself.addEventListener('fetch', (event) => {\n  const req = event.request;\n  if (req.method !== 'GET') return;\n  const url = new URL(req.url);\n  if (url.origin !== self.location.origin) return;\n\n  if (url.pathname.endsWith('/data.json')) {\n    // ?t= 캐시버스터는 무시하고 하나의 키로 저장\n    event.respondWith(networkFirst(req, new URL('data.json', self.registration.scope).href));\n  } else if (req.mode === 'navigate') {\n    event.respondWith(networkFirst(req, new URL('index.html', self.registration.scope).href));\n  } else {\n    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));\n  }\n});\n\nself.addEventListener('notificationclick', (event) => {\n  event.notification.close();\n  event.waitUntil(\n    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {\n      const client = list.find((c) => 'focus' in c);\n      return client ? client.focus() : self.clients.openWindow(self.registration.scope);\n    })\n  );\n});\n"}};

const STATE_KEY = 'state-v1';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_ITEMS = 600;
const CHECKED_TTL = 26 * 3600;        // 이미 확인한 기사 기록 보관 시간
const SENT_TTL = 72 * 3600;           // 발송 기록 보관 시간
const ALERT_MAX_AGE = 6 * 3600;       // 이보다 오래된 기사는 알림 안 함 (밀린 기사 폭탄 방지)
const TG_LIMIT = 3800;
const MAX_PER_MESSAGE_RUN = 15;

// ===== 키워드 매칭 (설정에서 한 번만 컴파일) =====
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enSuffix = (kw) => (kw.length <= 3 ? '(?:s)?' : '(?:s|es|ed|d|ing)?');

function compileGroups(groups, english) {
  // 키워드마다 캡처 그룹 하나 → 어떤 키워드가 걸렸는지와 우선순위(설정 순서)를 함께 알 수 있음
  const flat = [];
  for (const [category, kws] of groups) for (const kw of kws) flat.push({ category, kw });
  const body = flat.map(({ kw }) => `(${escapeRe(kw)})${english ? enSuffix(kw) : ''}`).join('|');
  const re = new RegExp(english ? `\\b(?:${body})\\b` : body, 'gi');
  return { flat, re };
}

const EN = compileGroups(CONFIG.keywords_en, true);
const KR = compileGroups(CONFIG.keywords_kr, false);
const URGENT_EN_RE = new RegExp(`\\b(?:${CONFIG.urgent_en.map((k) => escapeRe(k) + enSuffix(k)).join('|')})\\b`, 'i');

function bestMatch(matcher, text) {
  let best = -1;
  matcher.re.lastIndex = 0;
  for (const m of text.matchAll(matcher.re)) {
    const idx = m.findIndex((g, i) => i > 0 && g !== undefined) - 1;
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
    if (best === 0) break;
  }
  return best < 0 ? null : [matcher.flat[best].category, matcher.flat[best].kw];
}

function classify(title, summary, region) {
  const text = `${title} ${summary}`;
  const kr = bestMatch(KR, text);
  const en = bestMatch(EN, text);
  return region === 'KR' ? kr || en : en || kr;
}

function isUrgent(title) {
  return CONFIG.urgent_kr.some((k) => title.includes(k)) || URGENT_EN_RE.test(title);
}

function isPaidArticle(link, title) {
  if (link.includes('hankyung.com/article/')) {
    const id = link.replace(/\/+$/, '').split('/').pop();
    if (id && !/^\d+$/.test(id)) return true;
  }
  return ['[마켓PRO]', '[프리미엄]', '[한경 코리아마켓]'].some((m) => title.includes(m));
}

// ===== 중복 제거 =====
function splitPublisher(title) {
  const m = title.match(/^(.*\S)\s+[-–—|]\s+([^-–—|]{2,40})$/);
  return m ? [m[1], m[2].trim()] : [title, null];
}

function normalizeTitle(title) {
  return splitPublisher(title)[0].toLowerCase()
    .replace(/[[(【<].*?[\])】>]/g, ' ')
    .replace(/[^0-9a-z가-힣]+/g, '')
    .slice(0, 60);
}

function hashId(str) {
  // cyrb53: 빠른 53비트 문자열 해시
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const itemId = (title) => hashId(normalizeTitle(title));

// ===== RSS / Atom 파싱 =====
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function cleanText(raw) {
  if (!raw) return '';
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s);                 // 이스케이프된 HTML 을 먼저 풀고
  s = s.replace(/<[^>]+>/g, ' ');        // 태그 제거
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseDate(raw, region) {
  const s = cleanText(raw);
  if (!s) return null;
  // "2026-10-07 14:32:00" 처럼 시간대 없는 한국 피드는 KST 로 간주
  const local = s.match(/^(\d{4})[-.](\d{2})[-.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, mo, d, h, mi, sec] = local;
    const offset = region === 'KR' ? '+09:00' : 'Z';
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec || '00'}${offset}`);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function parseFeed(xml, region) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    let link = cleanText(tag(b, 'link'));
    if (!link) {
      const href = b.match(/<link[^>]*?href=["']([^"']+)["'][^>]*>/i);
      link = href ? decodeEntities(href[1]) : '';
    }
    if (!link) link = cleanText(tag(b, 'guid'));
    const time = parseDate(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'), region);
    return {
      title: cleanText(tag(b, 'title')),
      link,
      summary: cleanText(tag(b, 'description') || tag(b, 'summary')).slice(0, 300),
      publisher: cleanText(tag(b, 'source')) || null,
      time,
    };
  });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(12000),
    cf: { cacheTtl: 60 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 200));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// ===== 수집 =====
function batchFeeds(index) {
  return CONFIG.feeds.filter((_, i) => i % CONFIG.batches === index);
}

async function collectFeed(feed, now, cutoff, known, checked) {
  const { name, url, region, opts } = feed;
  const fresh = [];      // 새로 분류된 HOT 기사
  const seenAgain = [];  // 이미 있는 기사를 다른 매체가 보도 → also 갱신
  const newChecked = [];
  try {
    const entries = parseFeed(await fetchText(url), region).slice(0, opts.limit || CONFIG.default_feed_limit);
    for (const e of entries) {
      if (!e.title) continue;
      const time = e.time ?? now;
      if (time < cutoff) continue;
      const id = itemId(e.title);
      if (known.has(id)) { seenAgain.push(id); continue; }
      if (checked[id]) continue;
      newChecked.push(id);
      if (isPaidArticle(e.link, e.title)) continue;
      const hit = opts.take_all ? [opts.category || '기타', name] : classify(e.title, e.summary, region);
      if (!hit) continue;
      const isGoogle = url.includes('news.google.com');
      const [headline, pub] = isGoogle ? splitPublisher(e.title) : [e.title, null];
      fresh.push({
        id,
        source: name,
        publisher: e.publisher || pub,
        region,
        category: hit[0],
        keyword: hit[1],
        urgent: Boolean(opts.urgent) || isUrgent(headline),
        title: headline,
        link: e.link,
        time: new Date(time * 1000).toISOString(),
        time_ts: time,
      });
    }
    return { fresh, seenAgain, newChecked, health: { name, region, ok: entries.length > 0, entries: entries.length, hot: fresh.length + seenAgain.length, ...(entries.length ? {} : { error: '빈 피드' }), at: now } };
  } catch (e) {
    return { fresh, seenAgain, newChecked, health: { name, region, ok: false, entries: 0, hot: 0, error: String(e.message || e).slice(0, 80), at: now } };
  }
}

async function collectDart(env, now) {
  if (!env.DART_API_KEY) return null;
  const kst = new Date((now + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(env.DART_API_KEY)}&bgn_de=${kst}&page_count=100`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const items = [];
    for (const d of data.list || []) {
      const report = d.report_nm || '';
      const kw = CONFIG.dart_keywords.find((k) => report.includes(k));
      if (!kw) continue;
      const r = d.rcept_dt || kst;
      const time = Math.floor(Date.parse(`${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)}T00:00:00+09:00`) / 1000);
      const title = `[${d.corp_name || ''}] ${report}`;
      items.push({
        id: itemId(title + d.rcept_no), source: 'DART 공시', publisher: null, region: 'KR',
        category: '기업이벤트', keyword: kw, urgent: kw === '거래정지' || kw === '상장폐지',
        title, link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,
        time: new Date(time * 1000).toISOString(), time_ts: time,
      });
    }
    return { items, health: { name: 'DART 공시', region: 'KR', ok: true, entries: (data.list || []).length, hot: items.length, at: now } };
  } catch (e) {
    return { items: [], health: { name: 'DART 공시', region: 'KR', ok: false, entries: 0, hot: 0, error: String(e.message || e).slice(0, 80), at: now } };
  }
}

function emptyState() {
  return { items: [], sources: {}, checked: {}, sent: {}, seeded: [], welcomed: false, generated_ts: null };
}

async function loadState(env) {
  return (await env.STORE.get(STATE_KEY, 'json')) || emptyState();
}

async function runCollection(env, scheduledMs) {
  const now = Math.floor((scheduledMs || Date.now()) / 1000);
  const cutoff = now - CONFIG.lookback_hours * 3600;
  const batch = Math.floor(now / 120) % CONFIG.batches;   // 2분 단위로 묶음 순환
  const state = await loadState(env);

  const byId = new Map(state.items.filter((i) => i.time_ts >= cutoff).map((i) => [i.id, i]));
  const results = await Promise.all(batchFeeds(batch).map((f) => collectFeed(f, now, cutoff, byId, state.checked)));
  const dart = batch === 0 ? await collectDart(env, now) : null;

  const added = [];
  for (const r of results) {
    state.sources[r.health.name] = r.health;
    for (const id of r.newChecked) state.checked[id] = now;
    for (const it of r.fresh) {
      const existing = byId.get(it.id);
      if (existing) {
        mergeDuplicate(existing, it);
      } else {
        byId.set(it.id, it);
        added.push(it);
      }
    }
    for (const id of r.seenAgain) {
      const it = byId.get(id);
      if (it && it.source !== r.health.name) it.also = [...new Set([...(it.also || []), r.health.name])].sort();
    }
  }
  if (dart) {
    state.sources[dart.health.name] = dart.health;
    for (const it of dart.items) if (!byId.has(it.id)) { byId.set(it.id, it); added.push(it); }
  }

  // 정리
  state.items = [...byId.values()].sort((a, b) => b.time_ts - a.time_ts).slice(0, MAX_ITEMS);
  state.checked = Object.fromEntries(Object.entries(state.checked).filter(([, t]) => t >= now - CHECKED_TTL));
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, t]) => t >= now - SENT_TTL));
  state.generated_ts = now;

  await sendAlerts(env, state, added, batch, now);
  await env.STORE.put(STATE_KEY, JSON.stringify(state));
  return { batch, added: added.length, total: state.items.length };
}

function mergeDuplicate(existing, it) {
  existing.urgent = existing.urgent || it.urgent;
  if (it.source !== existing.source) existing.also = [...new Set([...(existing.also || []), it.source])].sort();
}

// ===== 텔레그램 =====
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function kstLabel(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function formatItem(it) {
  const flag = it.region === 'KR' ? '🇰🇷' : '🌎';
  const siren = it.urgent ? '🚨 ' : '';
  const more = it.also?.length ? ` 외 ${it.also.length}곳` : '';
  return `${siren}${flag} <b>[${escHtml(it.category)}]</b> <a href="${escHtml(it.link)}">${escHtml(it.title)}</a>\n`
    + `<i>${escHtml(it.publisher || it.source)}${more} · ${kstLabel(it.time_ts)}</i>`;
}

function buildMessages(items, dashboardUrl) {
  const shown = items.slice(0, MAX_PER_MESSAGE_RUN);
  const rest = items.length - shown.length;
  let footer = '';
  if (rest > 0) footer += `\n\n…외 ${rest}건`;
  if (dashboardUrl) footer += `\n\n📊 <a href="${escHtml(dashboardUrl)}">대시보드 열기</a>`;
  const messages = [];
  let current = `<b>📈 HOT 시장 이슈 ${items.length}건</b>\n\n`;
  for (const it of shown) {
    const block = `${formatItem(it)}\n\n`;
    if (current.length + block.length > TG_LIMIT) { messages.push(current.trimEnd()); current = ''; }
    current += block;
  }
  messages.push(current.trimEnd() + footer);
  return messages;
}

async function sendTelegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`텔레그램 오류: ${body.description || res.status}`);
}

async function sendAlerts(env, state, added, batch, now) {
  // 첫 순환(모든 묶음을 한 번씩 수집할 때까지)은 기존 기사를 '발송됨'으로만 기록
  const seeding = state.seeded.length < CONFIG.batches;
  if (seeding && !state.seeded.includes(batch)) state.seeded.push(batch);

  const mode = (env.ALERT_MODE || 'urgent').trim().toLowerCase();
  const canSend = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && mode !== 'off';

  if (canSend && !state.welcomed) {
    try {
      await sendTelegram(env, `✅ HOT 시장 이슈 봇 연결 성공\n앞으로 새 ${mode === 'all' ? 'HOT' : '긴급'} 이슈를 이 방으로 보내드립니다.`
        + (env.DASHBOARD_URL ? `\n📊 ${env.DASHBOARD_URL}` : ''));
      state.welcomed = true;
    } catch (e) {
      console.log(String(e));
    }
  }

  const targets = added
    .filter((it) => !state.sent[it.id] && (mode === 'all' || it.urgent) && it.time_ts >= now - ALERT_MAX_AGE)
    .sort((a, b) => b.time_ts - a.time_ts);
  for (const it of added) state.sent[it.id] = now;

  if (seeding || !canSend || !targets.length) return;
  try {
    for (const text of buildMessages(targets, env.DASHBOARD_URL)) await sendTelegram(env, text);
  } catch (e) {
    console.log(String(e));
  }
}

// ===== 웹 =====
function payload(state) {
  return {
    generated_ts: state.generated_ts,
    generated_at: state.generated_ts ? new Date(state.generated_ts * 1000).toISOString() : null,
    lookback_hours: CONFIG.lookback_hours,
    kr_holidays: CONFIG.kr_holidays,
    sources: CONFIG.feeds.map((f) => state.sources[f.name] || { name: f.name, region: f.region, ok: false, entries: 0, hot: 0, error: '수집 대기' })
      .concat(state.sources['DART 공시'] ? [state.sources['DART 공시']] : []),
    items: state.items,
  };
}

async function readState(env) {
  return (await env.STORE.get(STATE_KEY, { type: 'json', cacheTtl: 30 })) || emptyState();
}

function assetResponse(path) {
  const a = ASSETS[path];
  if (!a) return null;
  const body = a.b64 ? Uint8Array.from(atob(a.body), (c) => c.charCodeAt(0)) : a.body;
  const cache = path === 'sw.js' ? 'no-cache' : 'public, max-age=300';
  return new Response(body, { headers: { 'Content-Type': a.type, 'Cache-Control': cache } });
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/, '') || 'index.html';

  if (!env.STORE) {
    return new Response('KV 바인딩(STORE)이 설정되지 않았습니다. README 의 Cloudflare 설정을 확인하세요.', {
      status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (path === 'data.json') {
    return new Response(JSON.stringify(payload(await readState(env))), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (path === 'index.html') {
    const data = JSON.stringify(payload(await readState(env))).replace(/</g, '\\u003c');
    const html = ASSETS['index.html'].body.replace('/*__INITIAL_DATA__*/null', data);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return assetResponse(path) || new Response('Not found', { status: 404 });
}

export default {
  fetch: handleFetch,
  async scheduled(event, env, ctx) {
    const result = await runCollection(env, event.scheduledTime);
    console.log(`batch ${result.batch}: 새 기사 ${result.added}건, 전체 ${result.total}건`);
  },
};

// 테스트용 내보내기
export const _test = { classify, isUrgent, parseFeed, normalizeTitle, itemId, splitPublisher, buildMessages, runCollection, payload, CONFIG };
