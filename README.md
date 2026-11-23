# HOT 시장 이슈 — 앱(PWA) + 텔레그램 알림

GitHub Actions가 5분마다 한국·글로벌 뉴스 RSS를 모아서 HOT 이슈를 골라냅니다.
- **대시보드 앱(PWA)**: GitHub Pages로 호스팅됩니다. 휴대폰 홈 화면에 설치할 수 있고, 열어 두면 1분마다 자동으로 갱신됩니다.
- **텔레그램 알림**: 새 긴급 이슈가 생기면 팀 채팅방으로 바로 발송합니다.

```
scripts/config.py   ← 뉴스 소스 · 키워드 · 긴급 키워드 · 휴장일 (여기만 고치면 됨)
scripts/build.py    ← 수집 → 분류 → 중복 제거 → dist/ 생성
scripts/notify.py   ← 새 이슈 텔레그램 발송
web/                ← 앱 화면 (HTML/CSS/JS, 서비스워커, 아이콘)
scripts/marketdata.py · briefing.py ← 시세 수집 · 시황문자 초안
scripts/targets.py  ← 증권사 코스피 전망 기록·가져오기
scripts/wfe.py      ← WFE 월간 통계
scripts/extras.py   ← 위 데이터를 캐시와 함께 dist/*.json 으로 빌드
data/kospi_targets.csv ← 증권사 전망 기록
tests/              ← 오프라인 테스트 (python -m unittest discover tests)
```

## 주요 기능

| 구분 | 내용 |
|---|---|
| 해외 소스 | Reuters · Bloomberg · AP(구글뉴스 경유), Bloomberg Markets, CNBC 5종, MarketWatch, WSJ, FT, Yahoo, Investing 3종, SCMP, BBC, **Fed·ECB 보도자료 원문** |
| 국내 소스 | 한경 3종, 연합 3종, 매경 증권, 연합인포맥스, 구글뉴스(코스피·환율), DART 공시(옵션) |
| 분류 | 카테고리 자동 분류 (Fed·중앙은행, 매크로지표, 정책·정치, 지정학, 빅테크·반도체, 원자재 등) |
| 긴급 | 속보·금통위·FOMC·급락·관세·거래정지 등이 들어간 기사에 `긴급` 표시하고 알림 발송 |
| 중복 제거 | 여러 매체에 같은 기사가 실리면 하나만 남기고 `+N`으로 표시 |
| 앱 | 탭(전체/한국/해외/긴급), 카테고리 칩, 검색, NEW 배지, KRX·NYSE 개장 상태, 오프라인 지원 |
| 상태 확인 | 앱 하단 "수집 소스"에서 소스별 성공·실패를 보여주고, 서버 갱신이 20분 넘게 밀리면 `⚠ 지연 중` 표시 |

## 셋업

### 1. 대시보드 (필수)
1. **Settings → Pages → Source: GitHub Actions**
2. **Actions → Build News Dashboard → Run workflow** (첫 빌드)
3. `https://<아이디>.github.io/market-issue/` 접속

### 2. 휴대폰에 앱 설치
- **아이폰(Safari)**: 공유 버튼 → **홈 화면에 추가**
- **안드로이드(Chrome)**: 메뉴 ⋮ → **앱 설치** (또는 홈 화면에 추가)

설치하면 앱처럼 전체 화면으로 열리고, 앱으로 돌아올 때마다 바로 최신 데이터를 불러옵니다.

### 3. 텔레그램 알림 (팀 단톡방)
1. 텔레그램에서 **@BotFather** → `/newbot` → 봇 토큰 발급
2. 팀 그룹에 봇을 초대한 뒤 그룹에 아무 메시지나 하나 보내기
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates` 열기 → `"chat":{"id":-100...}` 값이 채팅방 ID
4. GitHub 저장소 → **Settings → Secrets and variables → Actions → Secrets**
   - `TELEGRAM_BOT_TOKEN` = 봇 토큰
   - `TELEGRAM_CHAT_ID` = 채팅방 ID
5. **Actions → Run workflow → "텔레그램 테스트 메시지 보내기" 체크** → 채팅방에 ✅ 메시지가 오면 연결 성공

알림 범위는 **Variables** 탭에서 `ALERT_MODE`로 바꿀 수 있습니다.

| 값 | 동작 |
|---|---|
| `urgent` (기본) | 긴급 이슈만 발송 |
| `all` | HOT 이슈 전부 발송 (많음) |
| `off` | 발송 중지 |

> 처음 실행할 때는 그동안 쌓인 기사를 한꺼번에 보내지 않도록 기록만 하고, 그다음 실행부터 새 기사를 보냅니다.

### 4. DART 공시 (옵션)
https://opendart.fss.or.kr/ 에서 API 키를 발급받아 Secret `DART_API_KEY`로 등록하면 됩니다.

## 업데이트가 늦을 때 (중요)

GitHub의 예약 실행(cron)은 **5분으로 설정해도 실제로는 10~30분 이상 밀리는 일이 흔합니다**(GitHub 서버 부하 때문). 정확히 5분마다 돌리려면 외부 무료 스케줄러로 워크플로를 직접 호출하세요.

1. GitHub → Settings → Developer settings → **Fine-grained token** 생성
   (이 저장소만 선택, 권한: **Actions: Read and write**)
2. https://cron-job.org 가입 → 새 작업
   - URL: `https://api.github.com/repos/<아이디>/market-issue/actions/workflows/build.yml/dispatches`
   - 방식: `POST`, 주기: 5분
   - 헤더: `Authorization: Bearer <토큰>`, `Accept: application/vnd.github+json`
   - 본문: `{"ref":"main"}`

참고:
- 예약 실행은 **기본 브랜치(main)에 있는 워크플로만** 동작합니다.
- 저장소에 60일 동안 활동이 없으면 GitHub가 예약 실행을 자동으로 끕니다. 이때는 Actions 탭에서 다시 켜면 됩니다.
- Private 저장소는 Actions 무료 사용량(월 2,000분)을 넘을 수 있습니다. Public 저장소는 무료입니다.

## 화면 구성

앱 상단 메뉴: **이슈 · 시황 · 전망 · WFE**

| 화면 | 내용 | 데이터 | 갱신 |
|---|---|---|---|
| 이슈 | HOT 시장 뉴스 (기존) | 국내외 RSS | 5분 |
| 시황 | 코스피·코스닥 마감 데이터, 해외 지수·금리·환율, **시황문자 초안** | 네이버 증권, Yahoo Finance | 장중 5분, 해외 20분 |
| 전망 | 증권사별 코스피 목표치·밴드, 상향/하향 이력, 코스피 추이와 비교 | `data/kospi_targets.csv` | 커밋할 때 |
| WFE | 세계거래소연맹 월간 통계에서 한국거래소 순위(시가총액·상장사·거래대금·지수 등락률) | WFE Focus 월간 Market Statistics | 하루 1번 |

### 시황문자 초안 (텔레그램)
텔레그램이 연결되어 있으면 평일(휴장일 제외)에 자동으로 보냅니다.
- **해외시황**: 06:30~09:00 사이 첫 실행 때 (직전 美 거래일 기준, 유럽도 같은 날 종가로 맞춤)
- **국내 마감시황**: 16:00~19:30 사이 첫 실행 때 (당일 데이터·장 마감 확인 후)

초안은 사내 시황문자 문체 규칙을 따릅니다. 방향(3대지수 모두/혼조, 일제히), N%대, 출발·전환, 수급 주체, 낙폭 축소 같은 장중 흐름처럼 숫자로 판단할 수 있는 부분은 자동으로 채웁니다. **재료(원인)와 업종은 `[출발 재료]`, `[업종]` 빈칸으로 남깁니다.** 기사를 확인한 뒤 채우거나 Claude의 `/market-sms`로 완성하세요. 업종을 비워 두는 이유는 KRX 업종 분류 데이터는 정보데이터시스템 로그인이 필요해서입니다.

끄거나 하나만 받으려면 Variables에 `BRIEFINGS`를 `off` / `overnight` / `closing`으로 지정합니다.

### 증권사 전망 기록하기
1. Claude에서 `/kospi-targets` 실행 → 결과 표를 `targets.md`로 저장
2. `python scripts/targets.py import targets.md` → `data/kospi_targets.csv`에 추가 (이미 있는 행은 건너뜀)
3. 커밋·푸시하면 전망 화면에 반영

GitHub 웹에서 CSV를 직접 고쳐도 됩니다. 열은 `기록일,증권사,구분,기간,목표,하단,상단,내용,제시일,날짜구분,변경,근거,출처,링크`이고, 기간은 `단기/월간/분기/3개월/6개월/12개월/연말/내년` 중 하나로 씁니다.

### WFE 통계 범위
공개된 월간 통계 표 4개(시가총액, 상장회사 수, 주식 거래대금, 대표지수)만 가져옵니다. 전체 통계 DB(statistics.world-exchanges.org)는 로그인이 필요해서 포함하지 않았습니다. 회원사 계정으로 받은 엑셀이 있으면 추가로 연결할 수 있습니다.

### 데이터 출처 주의
- 국내 수치는 네이버 증권 기준입니다. 문자 발송 전에 KRX 정보데이터시스템 수치와 대조하세요.
- Yahoo Finance는 요청이 많으면 일시적으로 막힐 때가 있습니다(429). 그러면 네이버 증권(해외지수·美 10년물·WTI·금·달러/원)으로 자동 대체합니다. 美 3대지수 시가는 네이버에서 먼저 받습니다. 둘 다 실패하면 마지막 성공 데이터를 쓰고 화면에 "수집 실패"를 표시합니다.

## 키워드 커스터마이징

`scripts/config.py`에서 수정합니다.
- `KEYWORDS_KR` / `KEYWORDS_EN`: 카테고리별 HOT 키워드 (위에 있는 카테고리가 먼저 매칭됨)
- `URGENT_KR` / `URGENT_EN`: 텔레그램으로 즉시 보낼 긴급 키워드
- `FEEDS`: 소스 추가·삭제. 구글뉴스 검색 RSS(`GN_SEARCH + "검색어+when:1d"`)로 원하는 주제를 손쉽게 추가할 수 있습니다.
- `KR_HOLIDAYS`: KRX 휴장일 (매년 갱신)

업무 비중에 따라 이렇게 조정하면 됩니다.
- 시황 작성 위주: 매크로 키워드 강화 (Fed, BOK, CPI, 환율)
- 민원 회신 위주: 기업 이벤트 키워드 강화 (감자, 유상증자, 전환사채, 리픽싱)
- 외국인 매매 분석: 글로벌 리스크 키워드 강화 (VIX, DXY, EM, risk-off)

## 한계
- RSS 특성상 기사 반영에 수 분의 시차가 있습니다. 정보 습득용이며 트레이딩 신호용으로는 맞지 않습니다.
- 앱 안의 브라우저 알림(🔔)은 앱이 열려 있을 때만 동작합니다. 앱이 꺼져 있을 때 받는 알림은 텔레그램으로 받으세요.
- Public 저장소라면 코드와 수집 데이터가 공개됩니다.
