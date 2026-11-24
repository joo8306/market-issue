"""
해외 뉴스 영문 제목 → 한글 번역 (화면에서 한글 제목을 크게, 원문을 작게 표시)

번역 엔진 (위에서부터 사용 가능한 것)
1. Claude API — GitHub 비밀값 ANTHROPIC_API_KEY 가 있으면 사용 (안정적, 금융 용어 품질 좋음)
   · 모델은 저장소 변수 TRANSLATE_MODEL 로 바꿀 수 있음 (기본 claude-opus-5-5)
2. 구글 번역 무료 주소 — 키 없이 시도. 공식 서비스가 아니라 막히면 번역 없이 영문만 표시

- 한 번 번역한 제목은 .state/title_ko.json 에 저장해 다시 번역하지 않음 (새 기사만 번역)
- 번역이 실패해도 뉴스 빌드는 그대로 진행
"""

import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / ".state" / "title_ko.json"
HANGUL = re.compile(r"[가-힣]")
MAX_PER_RUN = 300        # 한 번 실행에서 새로 번역할 최대 건수
BATCH = 40               # 한 번에 묶어 보낼 제목 수
KEEP = 4000              # 캐시 최대 보관 건수
DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM = (
    "You translate English financial news headlines into Korean for a Korea Exchange market desk. "
    "Write natural Korean news-headline style (concise, noun-ending where natural, e.g. '…상승', '…발표'). "
    "Keep tickers, company names commonly written in English (e.g. Nvidia → 엔비디아, Fed → 연준), "
    "numbers, % and currency units accurate. Do not add information. "
    "Return one translation per input, in the same order."
)


def needs_translation(item):
    t = item.get("title") or ""
    return item.get("region") != "KR" and not HANGUL.search(t) and re.search(r"[A-Za-z]", t)


# ===== 엔진 1: Claude API =====
def claude_translate(titles, model=None):
    import anthropic
    client = anthropic.Anthropic(max_retries=2, timeout=120)
    schema = {
        "type": "object",
        "properties": {"ko": {"type": "array", "items": {"type": "string"}}},
        "required": ["ko"],
        "additionalProperties": False,
    }
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(titles))
    resp = client.beta.messages.create(
        model=model or os.environ.get("TRANSLATE_MODEL") or DEFAULT_MODEL,
        max_tokens=8000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",                      # 거절되면 서버가 다른 모델로 다시 시도
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=SYSTEM,
        messages=[{"role": "user", "content": f"Translate these {len(titles)} headlines:\n{numbered}"}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("번역 요청이 거절됨")
    text = next(b.text for b in resp.content if b.type == "text")
    ko = json.loads(text)["ko"]
    if len(ko) != len(titles):
        raise RuntimeError(f"번역 개수 불일치 {len(ko)}/{len(titles)}")
    return [k.strip() for k in ko]


# ===== 엔진 2: 구글 번역 (무료, 비공식) =====
GOOGLE_URL = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t"


def google_translate(titles):
    # 줄바꿈으로 묶어 한 번에 보내고, 결과를 줄 단위로 다시 나눔
    body = urllib.parse.urlencode({"q": "\n".join(t.replace("\n", " ") for t in titles)}).encode()
    req = urllib.request.Request(GOOGLE_URL, data=body, headers={
        "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if "sorry" in r.geturl():
            raise RuntimeError("구글 번역 차단(봇 확인)")
        data = json.loads(r.read().decode("utf-8"))
    joined = "".join(seg[0] for seg in data[0] if seg and seg[0])
    ko = [s.strip() for s in joined.split("\n")]
    if len(ko) != len(titles):
        raise RuntimeError(f"번역 개수 불일치 {len(ko)}/{len(titles)}")
    return ko


def pick_engine():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude", claude_translate
    return "google", google_translate


# ===== 캐시 + 적용 =====
def load_cache(path=CACHE_PATH):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache, keep_ids, path=CACHE_PATH):
    # 지금 화면에 있는 기사 우선, 나머지는 최근 것만 보관
    keys = [k for k in cache if k in keep_ids] + [k for k in cache if k not in keep_ids]
    trimmed = {k: cache[k] for k in keys[:KEEP]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")


def apply_translations(items, engine=None, cache_path=CACHE_PATH):
    """items 에 title_ko 를 채움. 반환: (새로 번역한 수, 엔진 이름, 오류)"""
    cache = load_cache(cache_path)
    targets = [it for it in items if needs_translation(it)]
    todo = [it for it in targets if it["id"] not in cache][:MAX_PER_RUN]
    name, fn = engine or pick_engine()
    done, error = 0, None
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        try:
            ko = fn([it["title"] for it in chunk])
        except Exception as e:  # 한 묶음이라도 실패하면 이번 실행은 멈추고 다음 실행에 재시도
            error = str(e)[:120]
            break
        for it, k in zip(chunk, ko):
            if k:
                cache[it["id"]] = k
                done += 1
    for it in targets:
        if it["id"] in cache:
            it["title_ko"] = cache[it["id"]]
    save_cache(cache, {it["id"] for it in items}, cache_path)
    return done, name, error
