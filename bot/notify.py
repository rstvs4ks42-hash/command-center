#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пуш-уведомления через ntfy.sh для Personal & YouTube Command Center.
Читает (и при необходимости расшифровывает) data/state.json,
шлёт утренний брифинг или вечерний «умный пинок».

Секреты: NTFY_TOPIC, APP_PASSWORD (env / GitHub Secrets).
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import traceback
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

LAST_HTTP_RESPONSE: Dict[str, Any] = {
    "status_code": None,
    "text": None,
    "url_safe": None,
}

BOT_DIR = Path(__file__).resolve().parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

try:
    import urllib3.util.connection as urllib3_cn
except ImportError:  # pragma: no cover
    urllib3_cn = None  # type: ignore

if urllib3_cn is not None:
    urllib3_cn.allowed_gai_family = lambda: socket.AF_INET

_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)


socket.getaddrinfo = _ipv4_getaddrinfo  # type: ignore[assignment]

try:
    from crypto_util import load_and_decrypt
except ImportError:  # pragma: no cover
    print("Установите зависимости: pip install -r bot/requirements.txt", file=sys.stderr)
    sys.exit(1)

NTFY_BASE = "https://ntfy.sh"
NTFY_TIMEOUT = 30
NTFY_USER_AGENT = (
    "CommandCenterBot/1.0 (+https://github.com/rstvs4ks42-hash/command-center; ntfy)"
)
NTFY_CLICK = "https://rstvs4ks42-hash.github.io/command-center/"

CN_TZ = timezone(timedelta(hours=8))
ROOT = BOT_DIR.parent
STATE_PATH = ROOT / "data" / "state.json"

SETUP_MESSAGE = (
    "✅ Связь настроена! Command Center подключён, ожидаю первой синхронизации данных с сайта."
)


def today_cn() -> date:
    return datetime.now(CN_TZ).date()


def load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        raise FileNotFoundError(f"Не найден {STATE_PATH}")
    return load_and_decrypt(STATE_PATH)


def try_load_state() -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        return load_state(), None
    except Exception as exc:  # noqa: BLE001
        reason = str(exc).strip() or repr(exc) or type(exc).__name__
        return None, reason


def require_ntfy_topic() -> str:
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    print(f"NTFY_TOPIC is set: {bool(topic)}", file=sys.stderr)
    if not topic:
        raise RuntimeError(
            "Не задан GitHub Secret / переменная окружения: NTFY_TOPIC. "
            "Добавьте в Settings → Secrets and variables → Actions "
            "(уникальное имя топика, напр. my-cc-ruslan-42)."
        )
    return topic


def remember_http_response(
    status_code: Optional[int],
    text: Optional[str],
    *,
    url_safe: Optional[str] = None,
) -> None:
    LAST_HTTP_RESPONSE["status_code"] = status_code
    LAST_HTTP_RESPONSE["text"] = text
    if url_safe is not None:
        LAST_HTTP_RESPONSE["url_safe"] = url_safe
    print(f"resp.status_code = {status_code!r}", file=sys.stderr)
    print(f"resp.text = {(text if text is not None else '') or '(пусто)'}", file=sys.stderr)


def parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def days_until(d: Optional[date], today: Optional[date] = None) -> Optional[int]:
    if d is None:
        return None
    today = today or today_cn()
    return (d - today).days


def send_ntfy(text: str) -> None:
    """POST https://ntfy.sh/{NTFY_TOPIC} с Click/Actions на сайт Command Center."""
    topic = require_ntfy_topic()
    url = f"{NTFY_BASE}/{topic}"
    url_safe = f"{NTFY_BASE}/***"
    print(f"ntfy endpoint: {NTFY_BASE}/{{NTFY_TOPIC}}", file=sys.stderr)

    message = text.rstrip() + f"\n\n🔗 Открыть трекер: {NTFY_CLICK}"
    body = message.encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "User-Agent": NTFY_USER_AGENT,
            "Title": "YouTube Command Center",
            "Priority": "default",
            "Tags": "rocket",
            "Click": NTFY_CLICK,
            "Actions": f"view, Open App, {NTFY_CLICK}",
            "Content-Type": "text/plain; charset=utf-8",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=NTFY_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = int(getattr(resp, "status", 200) or 200)
            remember_http_response(status, raw, url_safe=url_safe)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        remember_http_response(int(exc.code), raw, url_safe=url_safe)
        snippet = (raw or "")[:300] or "(пустой ответ)"
        raise RuntimeError(
            f"ntfy HTTP error status={exc.code}, body[:300]={snippet}"
        ) from exc
    except Exception as exc:  # noqa: BLE001
        remember_http_response(None, None, url_safe=url_safe)
        msg = str(exc).strip() or repr(exc) or type(exc).__name__
        raise RuntimeError(f"ntfy request failed: {msg}") from exc

    status = LAST_HTTP_RESPONSE.get("status_code")
    raw = LAST_HTTP_RESPONSE.get("text") or ""
    snippet = raw[:300] if raw else "(пустой ответ)"
    if status != 200:
        print(f"ntfy error response (first 300): {snippet}", file=sys.stderr)
        raise RuntimeError(f"ntfy expected HTTP 200, got status={status}, body[:300]={snippet}")

    print(f"OK: ntfy accepted message (status={status})", file=sys.stderr)


def monetization_block(state: Dict[str, Any]) -> str:
    m = state.get("monetization") or {}
    subs = int(m.get("subscribers") or 0)
    subs_goal = int(m.get("subscribersGoal") or 1000)
    hours = float(m.get("watchHours") or 0)
    hours_goal = float(m.get("watchHoursGoal") or 4000)
    sub_left = max(0, subs_goal - subs)
    hours_left = max(0.0, hours_goal - hours)
    sub_pct = min(100.0, (subs / subs_goal * 100) if subs_goal else 0)
    hours_pct = min(100.0, (hours / hours_goal * 100) if hours_goal else 0)
    return (
        f"📈 Монетизация\n"
        f"Подписчики: {subs:,} / {subs_goal:,} ({sub_pct:.0f}%) — осталось {sub_left:,}\n"
        f"Часы просмотра: {hours:,.0f} / {hours_goal:,.0f} ({hours_pct:.0f}%) — осталось {hours_left:,.0f} ч"
    ).replace(",", " ")


def videos_today(state: Dict[str, Any], today: date) -> List[Dict[str, Any]]:
    out = []
    for v in state.get("videos") or []:
        if v.get("stage") == "published":
            continue
        out.append(v)
    out.sort(
        key=lambda x: (
            0 if parse_date(x.get("publishDate")) == today else 1,
            parse_date(x.get("publishDate")) or date.max,
            x.get("title") or "",
        )
    )
    return out[:12]


def stage_label(stage: str) -> str:
    return {
        "idea": "Идея",
        "script": "Сценарий/Голос",
        "images": "Картинки 即梦AI",
        "edit": "Монтаж Remotion",
        "published": "Опубликовано",
    }.get(stage, stage or "?")


def habits_status(state: Dict[str, Any], today: date) -> List[tuple]:
    key = today.isoformat()
    logs = (state.get("habitLogs") or {}).get(key) or {}
    rows = []
    for h in state.get("habits") or []:
        if h.get("archived"):
            continue
        done = bool(logs.get(h.get("id")))
        rows.append((h.get("name") or "Привычка", done))
    return rows


def subscription_warnings(state: Dict[str, Any], today: date, threshold: int = 3) -> List[str]:
    warns = []
    for sub in state.get("subscriptions") or []:
        d = parse_date(sub.get("renewDate"))
        left = days_until(d, today)
        if left is None:
            continue
        if left <= threshold:
            name = sub.get("name") or "Подписка"
            if left < 0:
                warns.append(f"⚠️ {name}: просрочено на {abs(left)} дн.!")
            elif left == 0:
                warns.append(f"🚨 {name}: платёж СЕГОДНЯ")
            else:
                warns.append(f"⏰ {name}: через {left} дн. ({sub.get('renewDate')})")
    return warns


def tasks_today(state: Dict[str, Any], today: date) -> List[Dict[str, Any]]:
    key = today.isoformat()
    out = []
    for t in state.get("tasks") or []:
        if t.get("date") == key or (not t.get("done") and not t.get("date")):
            out.append(t)
    return out


def calendar_events_on(state: Dict[str, Any], day: date) -> List[Dict[str, Any]]:
    key = day.isoformat()
    out = []
    for ev in state.get("calendarEvents") or []:
        if (ev.get("date") or "")[:10] == key:
            out.append(ev)
    out.sort(key=lambda x: (x.get("title") or "").lower())
    return out


def calendar_blocks(state: Dict[str, Any], today: date) -> List[str]:
    """Блоки «сегодня» и «завтра» для ntfy."""
    lines: List[str] = []
    today_ev = calendar_events_on(state, today)
    if today_ev:
        lines.append("")
        lines.append("📅 Важные даты на сегодня")
        for ev in today_ev:
            title = ev.get("title") or "Событие"
            note = (ev.get("note") or "").strip()
            lines.append(f"• {title}")
            if note:
                lines.append(f"  {note}")

    tomorrow = today + timedelta(days=1)
    tomorrow_ev = calendar_events_on(state, tomorrow)
    if tomorrow_ev:
        lines.append("")
        lines.append("⏳ Напоминание на завтра")
        for ev in tomorrow_ev:
            title = ev.get("title") or "Событие"
            note = (ev.get("note") or "").strip()
            lines.append(f"• {title}")
            if note:
                lines.append(f"  {note}")
    return lines


def morning_message(state: Dict[str, Any]) -> str:
    today = today_cn()
    lines = [
        f"☀️ Утренний брифинг · {today.strftime('%d.%m.%Y')}",
        "",
        monetization_block(state),
        "",
        "🎬 Ролики в работе",
    ]
    vids = videos_today(state, today)
    if not vids:
        lines.append("На сегодня активных роликов нет — самое время завести идею.")
    else:
        for v in vids:
            fmt = "Shorts" if v.get("format") == "shorts" else "Long"
            vir = v.get("virality", "—")
            lines.append(
                f"• {v.get('title') or 'Без названия'} "
                f"[{stage_label(v.get('stage'))}] · {fmt} · 🔥{vir}%"
            )

    lines.append("")
    lines.append("✅ Привычки на сегодня")
    habits = habits_status(state, today)
    if not habits:
        lines.append("Список привычек пуст.")
    else:
        for name, done in habits:
            mark = "☑️" if done else "⬜️"
            lines.append(f"{mark} {name}")

    warns = subscription_warnings(state, today, threshold=3)
    if warns:
        lines.append("")
        lines.append("💳 Продления ≤ 3 дней")
        lines.extend(warns)

    lines.extend(calendar_blocks(state, today))

    streak = (state.get("streak") or {}).get("current") or 0
    lines.append("")
    lines.append(f"🔥 Текущая серия: {streak} дн. Удачного дня!")
    return "\n".join(lines)


def evening_message(state: Dict[str, Any]) -> str:
    today = today_cn()
    habits = habits_status(state, today)
    open_habits = [n for n, done in habits if not done]
    tasks = tasks_today(state, today)
    open_tasks = [t for t in tasks if not t.get("done")]
    streak = (state.get("streak") or {}).get("current") or 0
    best = (state.get("streak") or {}).get("best") or 0

    lines = [
        f"🌙 Вечерний умный пинок · {today.strftime('%d.%m.%Y')}",
        "",
    ]

    if not open_habits and habits:
        lines.append("Отлично! Все привычки за сегодня закрыты. 💪")
    elif open_habits:
        lines.append("Незакрытые привычки:")
        for n in open_habits:
            lines.append(f"⬜️ {n}")
        lines.append("")
        lines.append(
            f"Не сбивай серию: сейчас {streak} дн."
            + (f" (рекорд {best})." if best else ".")
        )
        lines.append("Закрой остаток до полуночи по Китаю — завтра будет легче.")
    else:
        lines.append("Привычки не настроены. Добавь их во вкладке «Фокус».")

    if open_tasks:
        lines.append("")
        lines.append("Открытые задачи на сегодня:")
        for t in open_tasks[:8]:
            prio = {"high": "🔴", "medium": "🟡", "low": "⚪"}.get(t.get("priority"), "•")
            lines.append(f"{prio} {t.get('title') or 'Задача'}")
    elif tasks:
        lines.append("")
        lines.append("Все быстрые задачи на сегодня выполнены. ✨")

    warns = subscription_warnings(state, today, threshold=3)
    if warns:
        lines.append("")
        lines.append("💳 Не забудь про подписки:")
        lines.extend(warns)

    lines.extend(calendar_blocks(state, today))

    if open_habits:
        lines.append("")
        lines.append("Ты ближе к монетизации, чем вчера. Один чекбокс — и серия жива.")
    else:
        lines.append("")
        lines.append("Спокойной ночи. Завтра снова в конвейер. 🎬")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="ntfy.sh notify for Command Center")
    parser.add_argument(
        "--mode",
        choices=("morning", "evening"),
        required=True,
        help="morning = 10:00 CST, evening = 21:00 CST",
    )
    args = parser.parse_args()

    require_ntfy_topic()

    state, load_error = try_load_state()
    if state is None:
        print(
            f"WARN: не удалось прочитать/расшифровать state.json — {load_error}",
            file=sys.stderr,
        )
        text = SETUP_MESSAGE
        kind = "setup"
    else:
        text = morning_message(state) if args.mode == "morning" else evening_message(state)
        kind = args.mode

    print(text)
    send_ntfy(text)
    print(f"OK: sent --mode {args.mode} ({kind}) via ntfy.sh", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).strip() or repr(exc) or type(exc).__name__
        print(f"ERROR: {msg}", file=sys.stderr)
        print("----- traceback -----", file=sys.stderr)
        traceback.print_exc()
        print("----- last HTTP response -----", file=sys.stderr)
        print(f"resp.status_code = {LAST_HTTP_RESPONSE.get('status_code')!r}", file=sys.stderr)
        print(
            f"resp.text = {LAST_HTTP_RESPONSE.get('text') if LAST_HTTP_RESPONSE.get('text') is not None else '(нет ответа)'}",
            file=sys.stderr,
        )
        if LAST_HTTP_RESPONSE.get("url_safe"):
            print(f"url = {LAST_HTTP_RESPONSE.get('url_safe')}", file=sys.stderr)
        print(f"NTFY_TOPIC is set: {bool(os.environ.get('NTFY_TOPIC', '').strip())}", file=sys.stderr)
        raise SystemExit(1)
