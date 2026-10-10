"""
Cloudflare Worker 단일 파일 생성
- scripts/config.py (소스·키워드) + web/ (앱 화면) + cloudflare/src/worker.js
  → cloudflare/worker.js  (Cloudflare 대시보드 편집기에 그대로 붙여넣는 파일)
실행: python cloudflare/build.py
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import config  # noqa: E402

SRC = ROOT / "cloudflare" / "src" / "worker.js"
OUT = ROOT / "cloudflare" / "worker.js"
WEB = ROOT / "web"

# 한 번 실행(2분)에 처리할 소스 묶음 수. 피드 수 / BATCHES 개씩 돌아가며 수집
BATCHES = 3

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def build_config():
    return {
        "feeds": [{"name": n, "url": u, "region": r, "opts": o} for n, (u, r, o) in config.FEEDS.items()],
        "keywords_kr": list(config.KEYWORDS_KR.items()),
        "keywords_en": list(config.KEYWORDS_EN.items()),
        "urgent_kr": config.URGENT_KR,
        "urgent_en": config.URGENT_EN,
        "dart_keywords": config.DART_KEYWORDS,
        "kr_holidays": config.KR_HOLIDAYS,
        "lookback_hours": config.LOOKBACK_HOURS,
        "default_feed_limit": config.DEFAULT_FEED_LIMIT,
        "batches": BATCHES,
    }


def build_assets():
    files = sorted(p for p in WEB.rglob("*") if p.is_file())
    version = hashlib.sha1(b"".join(p.read_bytes() for p in files)).hexdigest()[:10]
    assets = {}
    for p in files:
        rel = p.relative_to(WEB).as_posix()
        ctype = TYPES.get(p.suffix, "application/octet-stream")
        if ctype.startswith("image/png"):
            assets[rel] = {"type": ctype, "b64": True, "body": base64.b64encode(p.read_bytes()).decode()}
        else:
            body = p.read_text(encoding="utf-8")
            if rel == "sw.js":
                body = body.replace("__VERSION__", version)
            assets[rel] = {"type": ctype, "body": body}
    return assets


def main():
    src = SRC.read_text(encoding="utf-8")
    cfg = json.dumps(build_config(), ensure_ascii=False, indent=1)
    assets = json.dumps(build_assets(), ensure_ascii=False)
    for marker in ("/*__CONFIG__*/null", "/*__ASSETS__*/null"):
        assert src.count(marker) == 1, marker
    out = src.replace("/*__CONFIG__*/null", cfg).replace("/*__ASSETS__*/null", assets)
    header = "// 자동 생성 파일 — 직접 고치지 마세요 (python cloudflare/build.py)\n"
    OUT.write_text(header + out, encoding="utf-8")
    print(f"생성 완료: {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, 피드 {len(config.FEEDS)}개 / {BATCHES}묶음)")


if __name__ == "__main__":
    main()
