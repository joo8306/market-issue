# A안: RSS 기반 카톡 대시보드

## 개념
GitHub Actions가 10분마다 RSS를 모아서 정적 HTML로 굽고, GitHub Pages가 그걸 호스팅. 카톡 즐겨찾기에 URL 등록해두고 필요할 때 탭.

## 셋업 (5분)

1. **GitHub 저장소 생성** (이름 예: `market-issues`, Public)
2. **이 폴더 전체를 push**
   ```
   scripts/build.py
   .github/workflows/build.yml
   ```
3. **Settings → Pages → Source: GitHub Actions**
4. **Actions 탭 → "Build News Dashboard" → Run workflow** (첫 빌드 수동 실행)
5. 5분 후 `https://<아이디>.github.io/market-issues/` 접속 확인
6. **카톡 즐겨찾기**: URL을 "나에게 보내기"로 전송 → 메시지 길게 눌러서 책갈피

## DART 공시 연동 (옵션)

한국 상장사 실시간 공시(감자, 유상증자, 전환사채 등)를 추가하려면:

1. https://opendart.fss.or.kr/ 에서 무료 API 키 발급
2. GitHub 저장소 → Settings → Secrets and variables → Actions
3. New secret: `DART_API_KEY` = 발급받은 키
4. 다음 빌드부터 자동으로 공시 포함됨

## 키워드 커스터마이징

`scripts/build.py` 상단 수정:
```python
HOT_KEYWORDS_KR = ["전환사채", "리픽싱", "감자", ...]
HOT_KEYWORDS_EN = ["Fed", "FOMC", ...]
```

업무 비중에 따라:
- 민원 회신 위주: 기업 이벤트 키워드 강화 (감자, 유상증자, 전환사채, 리픽싱)
- 시황 작성 위주: 매크로 키워드 강화 (Fed, BOK, CPI, 환율)
- 외국인 매매 분석: 글로벌 리스크 키워드 강화 (VIX, DXY, EM, risk-off)

## 한계
- RSS 시차 5초~수분 (트레이딩 신호용 X, 정보 습득용 O)
- 회사 PC에서 GitHub 차단 시 모바일에서만 조회
- Public 저장소면 코드·데이터 공개 (Private 원하면 Cloudflare Pages 등 별도 호스팅)
