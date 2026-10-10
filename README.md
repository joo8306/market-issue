# HOT 시장 이슈 — 앱(PWA) + 텔레그램 알림

한국·글로벌 뉴스 RSS를 모아 HOT 이슈를 골라내고, 팀이 보는 대시보드 앱과 텔레그램 알림으로 전달합니다.
- **대시보드 앱(PWA)**: 휴대폰 홈 화면에 설치할 수 있고, 열어 두면 1분마다 자동으로 갱신됩니다.
- **텔레그램 알림**: 새 긴급 이슈가 생기면 팀 채팅방으로 바로 발송합니다.

실행 방식은 두 가지이고, **현재 권장은 Cloudflare Worker**입니다.

| | Cloudflare Worker (권장) | GitHub Actions + Pages |
|---|---|---|
| 수집 주기 | 2분마다 (소스를 3묶음으로 나눠 순환, 소스별 약 6분마다 갱신) | 5분 설정이지만 실제로는 자주 밀림 |
| 비용 | 무료 (카드 불필요) | 무료 (Public 저장소) |
| 설정 | 아래 **Cloudflare 셋업** | 아래 **GitHub 셋업** |

```
scripts/config.py      ← 뉴스 소스 · 키워드 · 긴급 키워드 · 휴장일 (여기만 고치면 됨)
web/                   ← 앱 화면 (HTML/CSS/JS, 서비스워커, 아이콘)
cloudflare/worker.js   ← Cloudflare 에 붙여넣는 완성 파일 (자동 생성)
cloudflare/src/        ← Worker 원본 코드
cloudflare/build.py    ← config.py + web/ + src/ → worker.js 생성
scripts/build.py       ← (GitHub 방식) 수집 → dist/ 생성
scripts/notify.py      ← (GitHub 방식) 텔레그램 발송
tests/                 ← 오프라인 테스트
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

## Cloudflare 셋업 (권장, 약 20분, PC 권장)

화면 메뉴 이름은 Cloudflare 업데이트에 따라 조금 다를 수 있습니다.

### 1. 가입
https://dash.cloudflare.com/sign-up 에서 이메일로 가입합니다 (무료, 카드 불필요).

### 2. Worker 만들기
1. 왼쪽 메뉴 **Compute (Workers) → Workers & Pages** → **Create** (또는 Create application)
2. **Start with Hello World!** → 이름 입력 (예: `hot-issues`) → **Deploy**
3. **Edit code** 클릭 → 편집기의 기존 코드를 **전부 지우기**
4. 새 탭에서 아래 주소를 열고 **전체 선택(Ctrl+A) → 복사(Ctrl+C)**
   `https://raw.githubusercontent.com/joo8306/market-issue/main/cloudflare/worker.js`
5. 편집기에 붙여넣기 → 오른쪽 위 **Deploy**

### 3. 저장소(KV) 만들고 연결
1. 왼쪽 메뉴 **Storage & Databases → Workers KV** → **Create** (이름: `hot-issues`)
2. 만든 Worker 화면 → **Settings → Bindings → Add → KV namespace**
   - Variable name: `STORE` (대문자 정확히)
   - KV namespace: `hot-issues` 선택 → **Deploy/Save**

### 4. 텔레그램 정보 넣기
Worker 화면 → **Settings → Variables and Secrets → Add**
| Type | Name | Value |
|---|---|---|
| **Secret** | `TELEGRAM_BOT_TOKEN` | BotFather 토큰 (`/mybots` → 봇 → API Token 에서 다시 볼 수 있음) |
| **Secret** | `TELEGRAM_CHAT_ID` | 채팅방 ID (web.telegram.org/a/ 에서 방을 열면 주소 끝 `#` 뒤 숫자) |
| Text (선택) | `DASHBOARD_URL` | Worker 주소 (예: `https://hot-issues.○○○.workers.dev/`) |
| Text (선택) | `ALERT_MODE` | `urgent`(기본, 긴급만) / `all`(HOT 전부) / `off` |
| Secret (선택) | `DART_API_KEY` | DART 공시 API 키 |

### 5. 2분마다 자동 실행
Worker 화면 → **Settings → Trigger Events (Triggers)** → **Add → Cron Triggers** → `*/2 * * * *` 입력 → 저장

### 6. 확인
- 2~6분 뒤 텔레그램 방에 **"✅ HOT 시장 이슈 봇 연결 성공"** 메시지가 옵니다.
- Worker 주소(`https://hot-issues.○○○.workers.dev`)를 열면 대시보드가 보입니다. 처음 몇 분은 "첫 수집 대기 중"이 표시됩니다.
- 첫 6분(모든 소스를 한 번씩 수집하는 동안)은 기존 기사를 기록만 하고, 그 뒤부터 새 긴급 이슈를 보냅니다.
- 문제가 있으면 Worker 화면 **Logs (Observability)** 에서 `batch 0: 새 기사 N건` 같은 실행 기록을 볼 수 있습니다.

### 키워드·소스를 바꾼 뒤 반영하기
`scripts/config.py` 를 고치고 `python cloudflare/build.py` 로 `cloudflare/worker.js` 를 다시 만든 뒤, 2단계 3~5번(붙여넣기 → Deploy)만 반복하면 됩니다. 설정(KV, Secret, Cron)은 그대로 유지됩니다.

## GitHub 셋업 (대안)

### 1. 대시보드 (필수)
1. **Settings → Pages → Source: GitHub Actions**
2. **Actions → Build News Dashboard → Run workflow** (첫 빌드)
3. `https://<아이디>.github.io/market-issue/` 접속

### 2. 휴대폰에 앱 설치
- **아이폰(Safari)**: 공유 버튼 → **홈 화면에 추가**
- **안드로이드(Chrome)**: 메뉴 ⋮ → **앱 설치** (또는 홈 화면에 추가)

설치하면 앱처럼 전체 화면으로 열리고, 앱으로 돌아올 때마다 바로 최신 데이터를 불러옵니다.

### 3. 텔레그램 알림 (팀 단톡방)
> Cloudflare Worker 와 중복 발송되지 않도록 GitHub 쪽 알림은 기본으로 꺼져 있습니다. GitHub 로 보내려면 **Variables** 에 `ALERT_VIA_GITHUB` = `true` 를 추가하세요.

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
