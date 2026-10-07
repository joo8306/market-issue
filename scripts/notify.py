"""
새 HOT 이슈 → 텔레그램 알림
- dist/data.json 을 읽어 아직 보내지 않은 기사만 발송
- 발송 기록은 .state/sent.json (GitHub Actions 캐시로 실행 간 유지)
- 환경변수
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID : 없으면 아무것도 하지 않음
    ALERT_MODE   : urgent(기본, 긴급만) | all(HOT 전부) | off
    DASHBOARD_URL: 메시지 하단 대시보드 링크
    TEST_ALERT   : "true" 면 테스트 메시지 1건 발송
"""

import html
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "dist" / "data.json"
STATE_FILE = ROOT / ".state" / "sent.json"

KST = timezone(timedelta(hours=9))
MAX_PER_RUN = 15         # 한 번에 상세히 보낼 최대 건수 (나머지는 "외 N건")
STATE_TTL_HOURS = 72     # 이 시간 지난 발송 기록은 정리
TG_LIMIT = 3800          # 텔레그램 메시지 4096자 제한 여유분


def load_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_state(sent):
    cutoff = time.time() - STATE_TTL_HOURS * 3600
    sent = {k: v for k, v in sent.items() if v >= cutoff}
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(sent), encoding="utf-8")


def select_items(items, mode):
    if mode == "all":
        return items
    return [i for i in items if i.get("urgent")]


def format_item(it):
    t = datetime.fromisoformat(it["time"]).astimezone(KST).strftime("%m-%d %H:%M")
    flag = "🇰🇷" if it["region"] == "KR" else "🌎"
    siren = "🚨 " if it.get("urgent") else ""
    src = it.get("publisher") or it["source"]
    more = f" 외 {len(it['also'])}곳" if it.get("also") else ""
    return (
        f"{siren}{flag} <b>[{html.escape(it['category'])}]</b> "
        f"<a href=\"{html.escape(it['link'], quote=True)}\">{html.escape(it['title'])}</a>\n"
        f"<i>{html.escape(src)}{more} · {t}</i>"
    )


def build_messages(items, dashboard_url=None):
    """기사 목록 → 텔레그램 메시지 텍스트 목록 (길이 제한에 맞게 분할)"""
    shown = items[:MAX_PER_RUN]
    rest = len(items) - len(shown)

    footer = ""
    if rest > 0:
        footer += f"\n\n…외 {rest}건"
    if dashboard_url:
        footer += f"\n\n📊 <a href=\"{html.escape(dashboard_url, quote=True)}\">대시보드 열기</a>"

    header = f"<b>📈 HOT 시장 이슈 {len(items)}건</b>\n\n"
    messages, current = [], header
    for it in shown:
        block = format_item(it) + "\n\n"
        if len(current) + len(block) > TG_LIMIT:
            messages.append(current.rstrip())
            current = ""
        current += block
    current = current.rstrip() + footer
    messages.append(current)
    return messages


def send_telegram(token, chat_id, text):
    body = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body)
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    if not result.get("ok"):
        raise RuntimeError(result)


def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    mode = (os.getenv("ALERT_MODE") or "urgent").strip().lower()
    dashboard_url = os.getenv("DASHBOARD_URL")

    if not token or not chat_id:
        print("텔레그램 미설정 (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) → 알림 건너뜀")
        return
    if mode == "off":
        print("ALERT_MODE=off → 알림 건너뜀")
        return

    if os.getenv("TEST_ALERT", "").lower() == "true":
        send_telegram(token, chat_id, "✅ HOT 시장 이슈 봇 연결 테스트 성공"
                      + (f"\n📊 {dashboard_url}" if dashboard_url else ""))
        print("테스트 메시지 발송")

    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    items = payload["items"]
    state = load_state()
    now = time.time()

    if state is None:
        # 첫 실행: 지난 24시간치를 한꺼번에 쏟아내지 않도록 현재 기사를 '발송됨'으로만 기록
        save_state({it["id"]: now for it in items})
        print(f"첫 실행 → 기존 {len(items)}건을 기록만 하고 발송하지 않음")
        return

    targets = [it for it in select_items(items, mode) if it["id"] not in state]
    if targets:
        targets.sort(key=lambda x: x["time_ts"], reverse=True)
        for text in build_messages(targets, dashboard_url):
            send_telegram(token, chat_id, text)
        print(f"알림 발송: {len(targets)}건 (mode={mode})")
    else:
        print("새 알림 대상 없음")

    # 모드와 상관없이 현재 기사 전부 기록 → 나중에 모드를 바꿔도 과거 기사가 쏟아지지 않음
    for it in items:
        state.setdefault(it["id"], now)
    save_state(state)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"알림 실패: {e}", file=sys.stderr)
        sys.exit(1)
