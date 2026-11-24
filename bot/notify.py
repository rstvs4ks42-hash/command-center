#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Telegram-уведомления для Personal & YouTube Command Center.
Читает (и при необходимости расшифровывает) data/state.json,
шлёт утренний брифинг или вечерний «умный пинок».

Секреты: BOT_TOKEN, CHAT_ID, APP_PASSWORD (env / GitHub Secrets).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BOT_DIR = Path(__file__).resolve().parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

try:
    import urllib3.util.connection as urllib3_cn
except ImportError:  # pragma: no cover
    urllib3_cn = None  # type: ignore

# GitHub Actions иногда резолвит api.telegram.org в IPv6 → Read timed out.
# Принудительно используем только IPv4 (urllib3 + socket.getaddrinfo).
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

TELEGRAM_TIMEOUT = 20
TELEGRAM_POST_ATTEMPTS = 2
TELEGRAM_RETRY_PAUSE = 3
TELEGRAM_GET_FALLBACK_TIMEOUT = 60
TELEGRAM_USER_AGENT = (
    "CommandCenterBot/1.0 (+https://github.com/rstvs4ks42-hash/command-center; urllib)"
)

# Время Китая (Нанкин) UTC+8
CN_TZ = timezone(timedelta(hours=8))
ROOT = BOT_DIR.parent
STATE_PATH = ROOT / "data" / "state.json"


def today_cn() -> date:
    return datetime.now(CN_TZ).date()


SETUP_MESSAGE = (
    "✅ Связь настроена! Command Center подключён, ожидаю первой синхронизации данных с сайта."
)


def load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        raise FileNotFoundError(f"Не найден {STATE_PATH}")
    return load_and_decrypt(STATE_PATH)


def try_load_state() -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Вернуть (state, None) или (None, причина), не бросая исключение наружу."""
    try:
        return load_state(), None
    except Exception as exc:  # noqa: BLE001
        reason = str(exc).strip() or repr(exc) or type(exc).__name__
        return None, reason


def require_telegram_secrets() -> tuple[str, str]:
    missing = []
    token = os.environ.get("BOT_TOKEN", "").strip()
    chat_id = os.environ.get("CHAT_ID", "").strip()
    if not token:
        missing.append("BOT_TOKEN")
    if not chat_id:
        missing.append("CHAT_ID")
    if missing:
        names = ", ".join(missing)
        raise RuntimeError(
            f"Не задан GitHub Secret / переменная окружения: {names}. "
            "Добавьте в Settings → Secrets and variables → Actions."
        )
    return token, chat_id


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


def _telegram_opener() -> urllib.request.OpenerDirector:
    proxy = os.environ.get("TG_PROXY_URL", "").strip()
    handlers: list[Any] = []
    if proxy:
        print(f"Telegram: используем TG_PROXY_URL={proxy}", file=sys.stderr)
        handlers.append(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    else:
        print("Telegram: прямое соединение с api.telegram.org (без TG_PROXY_URL)", file=sys.stderr)
    return urllib.request.build_opener(*handlers)


def _is_timeout_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(
        token in text
        for token in (
            "timed out",
            "timeout",
            "read timed out",
            "the read operation timed out",
        )
    )


def _parse_telegram_body(status: int, body: str) -> Dict[str, Any]:
    body = (body or "").strip()
    print(f"Telegram HTTP {status}: {body or '(пустой ответ)'}", file=sys.stderr)
    if status != 200:
        raise RuntimeError(f"Telegram API error {status}: {body or '(пустой ответ)'}")
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Telegram вернул не-JSON ответ: {body or '(пусто)'}") from exc
    if not data.get("ok"):
        desc = data.get("description") or body or "неизвестная ошибка Telegram"
        raise RuntimeError(f"Telegram API ok=false: {desc}")
    return data


def _urllib_request(
    method: str,
    url: str,
    *,
    data: Optional[bytes] = None,
    timeout: int,
    opener: urllib.request.OpenerDirector,
) -> Tuple[int, str]:
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "User-Agent": TELEGRAM_USER_AGENT,
            "Accept": "application/json",
        },
    )
    if data is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return int(getattr(resp, "status", 200) or 200), raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return int(exc.code), raw


def send_telegram(text: str) -> None:
    """POST через urllib (+ опциональный TG_PROXY_URL); при 429/timeout — GET fallback."""
    token, chat_id = require_telegram_secrets()
    opener = _telegram_opener()
    post_url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps(
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        ensure_ascii=False,
    ).encode("utf-8")

    retryable_failure = False
    last_error: Optional[BaseException] = None

    for attempt in range(1, TELEGRAM_POST_ATTEMPTS + 1):
        try:
            print(
                f"Telegram POST attempt {attempt}/{TELEGRAM_POST_ATTEMPTS} "
                f"(urllib/IPv4, timeout={TELEGRAM_TIMEOUT}s)",
                file=sys.stderr,
            )
            status, body = _urllib_request(
                "POST",
                post_url,
                data=payload,
                timeout=TELEGRAM_TIMEOUT,
                opener=opener,
            )
            if status == 429:
                retryable_failure = True
                last_error = RuntimeError(f"HTTP 429: {body or '(пусто)'}")
                print(
                    f"WARN: HTTP 429 на попытке {attempt}/{TELEGRAM_POST_ATTEMPTS} — {body or '(пусто)'}",
                    file=sys.stderr,
                )
                if attempt < TELEGRAM_POST_ATTEMPTS:
                    time.sleep(TELEGRAM_RETRY_PAUSE)
                continue

            _parse_telegram_body(status, body)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            msg = str(exc).strip() or repr(exc) or type(exc).__name__
            if _is_timeout_error(exc) or "429" in msg:
                retryable_failure = True
            print(
                f"WARN: POST попытка {attempt}/{TELEGRAM_POST_ATTEMPTS} не удалась — {msg}",
                file=sys.stderr,
            )
            if attempt < TELEGRAM_POST_ATTEMPTS and (_is_timeout_error(exc) or "429" in msg):
                time.sleep(TELEGRAM_RETRY_PAUSE)
                continue
            if not (_is_timeout_error(exc) or "429" in msg):
                # Логические ошибки API (401 и т.п.) — без GET-fallback
                raise

    if not retryable_failure and last_error is not None:
        raise RuntimeError(str(last_error).strip() or repr(last_error))

    # Fallback: GET sendMessage после 429 / Read timed out
    query = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "True",
        },
        encoding="utf-8",
    )
    get_url = f"https://api.telegram.org/bot{token}/sendMessage?{query}"
    print(
        f"Telegram GET fallback (timeout={TELEGRAM_GET_FALLBACK_TIMEOUT}s) после 429/timeout",
        file=sys.stderr,
    )
    try:
        status, body = _urllib_request(
            "GET",
            get_url,
            timeout=TELEGRAM_GET_FALLBACK_TIMEOUT,
            opener=opener,
        )
        print(
            f"Telegram GET fallback status={status} body={body or '(пустой ответ)'}",
            file=sys.stderr,
        )
        _parse_telegram_body(status, body)
        print("OK: GET fallback доставил сообщение", file=sys.stderr)
        return
    except Exception as exc:  # noqa: BLE001
        prev = str(last_error).strip() if last_error else ""
        cur = str(exc).strip() or repr(exc) or type(exc).__name__
        raise RuntimeError(
            f"Telegram: POST исчерпан ({prev or '429/timeout'}), GET fallback тоже не удался — {cur}"
        ) from exc


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
        f"📈 <b>Монетизация</b>\n"
        f"Подписчики: {subs:,} / {subs_goal:,} ({sub_pct:.0f}%) — осталось {sub_left:,}\n"
        f"Часы просмотра: {hours:,.0f} / {hours_goal:,.0f} ({hours_pct:.0f}%) — осталось {hours_left:,.0f} ч"
    ).replace(",", " ")


def videos_today(state: Dict[str, Any], today: date) -> List[Dict[str, Any]]:
    """Ролики в работе: сначала с датой публикации = сегодня, затем остальные незавершённые."""
    out = []
    for v in state.get("videos") or []:
        stage = v.get("stage")
        if stage == "published":
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


def morning_message(state: Dict[str, Any]) -> str:
    today = today_cn()
    lines = [
        f"☀️ <b>Утренний брифинг</b> · {today.strftime('%d.%m.%Y')}",
        "",
        monetization_block(state),
        "",
        "🎬 <b>Ролики в работе</b>",
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
    lines.append("✅ <b>Привычки на сегодня</b>")
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
        lines.append("💳 <b>Продления ≤ 3 дней</b>")
        lines.extend(warns)

    streak = (state.get("streak") or {}).get("current") or 0
    lines.append("")
    lines.append(f"🔥 Текущая серия: <b>{streak}</b> дн. Удачного дня!")
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
        f"🌙 <b>Вечерний умный пинок</b> · {today.strftime('%d.%m.%Y')}",
        "",
    ]

    if not open_habits and habits:
        lines.append("Отлично! Все привычки за сегодня закрыты. 💪")
    elif open_habits:
        lines.append("<b>Незакрытые привычки:</b>")
        for n in open_habits:
            lines.append(f"⬜️ {n}")
        lines.append("")
        lines.append(
            f"Не сбивай серию: сейчас <b>{streak}</b> дн."
            + (f" (рекорд {best})." if best else ".")
        )
        lines.append("Закрой остаток до полуночи по Китаю — завтра будет легче.")
    else:
        lines.append("Привычки не настроены. Добавь их во вкладке «Фокус».")

    if open_tasks:
        lines.append("")
        lines.append("<b>Открытые задачи на сегодня:</b>")
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

    if open_habits:
        lines.append("")
        lines.append("Ты ближе к монетизации, чем вчера. Один чекбокс — и серия жива.")
    else:
        lines.append("")
        lines.append("Спокойной ночи. Завтра снова в конвейер. 🎬")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Telegram notify for Command Center")
    parser.add_argument(
        "--mode",
        choices=("morning", "evening"),
        required=True,
        help="morning = 10:00 CST, evening = 21:00 CST",
    )
    args = parser.parse_args()

    # Сначала проверяем секреты Telegram — без них слать некуда
    require_telegram_secrets()

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
    send_telegram(text)
    print(f"OK: sent --mode {args.mode} ({kind})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).strip() or repr(exc) or type(exc).__name__
        print(f"ERROR: {msg}", file=sys.stderr)
        raise SystemExit(1)
