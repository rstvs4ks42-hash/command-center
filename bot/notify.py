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
import json
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
    from crypto_util import encrypt_state, is_envelope, load_and_decrypt
except ImportError:  # pragma: no cover
    print("Установите зависимости: pip install -r bot/requirements.txt", file=sys.stderr)
    sys.exit(1)

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAY_LABELS = {
    "mon": "Пн",
    "tue": "Вт",
    "wed": "Ср",
    "thu": "Чт",
    "fri": "Пт",
    "sat": "Сб",
    "sun": "Вс",
}

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


def _post_ntfy(
    text: str,
    *,
    title: str = "YouTube Command Center",
    tags: str = "rocket",
    at: Optional[str] = None,
    append_link: bool = True,
) -> None:
    """POST https://ntfy.sh/{NTFY_TOPIC} с Click/Actions на сайт Command Center."""
    topic = require_ntfy_topic()
    url = f"{NTFY_BASE}/{topic}"
    url_safe = f"{NTFY_BASE}/***"
    print(f"ntfy endpoint: {NTFY_BASE}/{{NTFY_TOPIC}}", file=sys.stderr)

    message = text.rstrip()
    if append_link:
        message += f"\n\n🔗 Открыть трекер: {NTFY_CLICK}"
    body = message.encode("utf-8")
    headers = {
        "User-Agent": NTFY_USER_AGENT,
        "Title": title,
        "Priority": "default",
        "Tags": tags,
        "Click": NTFY_CLICK,
        "Actions": f"view, Open App, {NTFY_CLICK}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    if at:
        headers["At"] = at

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers=headers,
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


def send_ntfy(text: str) -> None:
    _post_ntfy(text)


def normalize_time_hhmm(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()[:5]
    if len(s) != 5 or s[2] != ":":
        return None
    try:
        hh = int(s[:2])
        mm = int(s[3:5])
    except ValueError:
        return None
    if hh > 23 or mm > 59:
        return None
    return f"{hh:02d}:{mm:02d}"


def shanghai_iso(date_str: str, time_str: str) -> str:
    tm = normalize_time_hhmm(time_str) or "09:00"
    return f"{date_str[:10]}T{tm}:00+08:00"


def reminder_key(kind: str, item_id: str, date_str: str, time_str: str) -> str:
    return f"{kind}:{item_id}:{date_str}:{time_str}"


def weekday_key(day: date) -> str:
    return WEEKDAY_KEYS[day.weekday()]


def _as_list(val: Any) -> List[Any]:
    return val if isinstance(val, list) else []


def _as_dict(val: Any) -> Dict[str, Any]:
    return val if isinstance(val, dict) else {}


def collect_timed_items_for_day(state: Dict[str, Any], day: date) -> List[Dict[str, str]]:
    """Задачи дня (dailyTasks или weeklySchedule) + привычки с HH:MM."""
    key = day.isoformat()
    items: List[Dict[str, str]] = []

    daily_raw = _as_list(state.get("dailyTasks"))
    daily = [
        t
        for t in daily_raw
        if isinstance(t, dict)
        and (t.get("date") or "")[:10] == key
        and not t.get("done")
    ]
    if daily:
        for t in daily:
            tm = normalize_time_hhmm(t.get("time"))
            if not tm:
                continue
            items.append(
                {
                    "kind": "task",
                    "id": str(t.get("id") or f"task-{tm}-{t.get('title') or ''}"),
                    "title": str(t.get("title") or "Задача"),
                    "time": tm,
                }
            )
    else:
        wd = weekday_key(day)
        schedule = _as_dict(state.get("weeklySchedule"))
        for t in _as_list(schedule.get(wd)):
            if not isinstance(t, dict):
                continue
            tm = normalize_time_hhmm(t.get("time"))
            if not tm:
                continue
            items.append(
                {
                    "kind": "task",
                    "id": str(t.get("id") or f"ws-{wd}-{tm}-{t.get('title') or ''}"),
                    "title": str(t.get("title") or "Задача"),
                    "time": tm,
                }
            )

    logs = _as_dict(_as_dict(state.get("habitLogs")).get(key))
    for h in _as_list(state.get("habits")):
        if not isinstance(h, dict):
            continue
        if h.get("archived"):
            continue
        if logs.get(h.get("id")):
            continue
        tm = normalize_time_hhmm(h.get("time"))
        if not tm:
            continue
        items.append(
            {
                "kind": "habit",
                "id": str(h.get("id") or f"habit-{tm}"),
                "title": str(h.get("name") or "Привычка"),
                "time": tm,
            }
        )

    items.sort(key=lambda x: (x["time"], x["title"]))
    return items


def schedule_day_reminders(state: Dict[str, Any]) -> int:
    """Ставит отложенные пуши At: на весь день. Дедуп через sentReminderIds."""
    today = today_cn()
    date_str = today.isoformat()
    wd = weekday_key(today)
    print(
        f"Scheduling reminders for {date_str} ({WEEKDAY_LABELS.get(wd, wd)})",
        file=sys.stderr,
    )

    sent = state.setdefault("sentReminderIds", [])
    if not isinstance(sent, list):
        sent = []
        state["sentReminderIds"] = sent

    now = datetime.now(CN_TZ)
    scheduled = 0
    for item in collect_timed_items_for_day(state, today):
        key = reminder_key(item["kind"], item["id"], date_str, item["time"])
        if key in sent:
            print(f"skip already scheduled: {key}", file=sys.stderr)
            continue
        at = shanghai_iso(date_str, item["time"])
        at_dt = datetime.fromisoformat(at)
        # Минимум +1 минута от текущего времени Asia/Shanghai
        if at_dt < now + timedelta(minutes=1):
            print(f"skip past: {key}", file=sys.stderr)
            continue
        body = f"⏰ Пора ({item['time']}): {item['title']}"
        try:
            _post_ntfy(
                body,
                title="Command Center Reminder",
                tags="alarm_clock",
                at=at,
                append_link=False,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: failed to schedule {key}: {exc}", file=sys.stderr)
            continue
        sent.append(key)
        scheduled += 1
        print(f"scheduled {key} at {at}", file=sys.stderr)

    if len(sent) > 400:
        state["sentReminderIds"] = sent[-300:]

    return scheduled


def save_state(state: Dict[str, Any]) -> bool:
    """Перезаписывает data/state.json (шифр тем же salt), возвращает True если записали."""
    password = os.environ.get("APP_PASSWORD", "").strip()
    if not STATE_PATH.exists():
        return False
    raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    if is_envelope(raw):
        if not password:
            print("WARN: APP_PASSWORD missing — cannot persist sentReminderIds", file=sys.stderr)
            return False
        envelope = encrypt_state(
            state,
            password,
            existing_salt_b64=raw.get("salt"),
            iterations=int(raw.get("iter") or 250000),
        )
        STATE_PATH.write_text(
            json.dumps(envelope, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return True
    if isinstance(raw, dict) and "monetization" in raw:
        STATE_PATH.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return True
    return False


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
    logs = _as_dict(_as_dict(state.get("habitLogs")).get(key))
    rows = []
    for h in _as_list(state.get("habits")):
        if not isinstance(h, dict):
            continue
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
    """Задачи на сегодня: dailyTasks (основной источник) или legacy tasks."""
    key = today.isoformat()
    out: List[Dict[str, Any]] = []
    daily = _as_list(state.get("dailyTasks"))
    if daily:
        for t in daily:
            if not isinstance(t, dict):
                continue
            if (t.get("date") or "")[:10] == key:
                out.append(t)
        return out
    for t in _as_list(state.get("tasks")):
        if not isinstance(t, dict):
            continue
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
            tm = (ev.get("time") or "").strip()
            lines.append(f"• {title}" + (f" · ⏰ {tm}" if tm else ""))
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
            tm = (ev.get("time") or "").strip()
            lines.append(f"• {title}" + (f" · ⏰ {tm}" if tm else ""))
            if note:
                lines.append(f"  {note}")
    return lines


def timed_tasks_block(state: Dict[str, Any], today: date) -> List[str]:
    """Задачи dailyTasks (или weeklySchedule) с точным временем — в утренний брифинг."""
    key = today.isoformat()
    tasks: List[Dict[str, Any]] = []
    source = _as_list(state.get("dailyTasks")) or _as_list(state.get("tasks"))
    for t in source:
        if not isinstance(t, dict):
            continue
        if t.get("done"):
            continue
        if (t.get("date") or "")[:10] != key:
            continue
        tm = normalize_time_hhmm(t.get("time"))
        if not tm:
            continue
        tasks.append({"time": tm, "title": t.get("title") or "Задача", "priority": t.get("priority")})
    if not tasks:
        wd = weekday_key(today)
        schedule = _as_dict(state.get("weeklySchedule"))
        for t in _as_list(schedule.get(wd)):
            if not isinstance(t, dict):
                continue
            tm = normalize_time_hhmm(t.get("time"))
            if not tm:
                continue
            tasks.append(
                {
                    "time": tm,
                    "title": t.get("title") or "Задача",
                    "priority": t.get("priority"),
                }
            )
    # привычки с временем (ещё не отмеченные)
    logs = _as_dict(_as_dict(state.get("habitLogs")).get(key))
    for h in _as_list(state.get("habits")):
        if not isinstance(h, dict):
            continue
        if h.get("archived") or logs.get(h.get("id")):
            continue
        tm = normalize_time_hhmm(h.get("time"))
        if not tm:
            continue
        tasks.append(
            {
                "time": tm,
                "title": h.get("name") or "Привычка",
                "priority": "habit",
            }
        )

    tasks.sort(key=lambda x: (x.get("time") or "99:99", x.get("title") or ""))
    if not tasks:
        return []
    lines = ["", "⏰ Напоминания с точным временем сегодня"]
    for t in tasks:
        if t.get("priority") == "habit":
            prio = "💪"
        elif t.get("priority") == "high":
            prio = "🔥"
        else:
            prio = "⚡"
        lines.append(f"{prio} {t.get('time')} — {t.get('title') or 'Задача'}")
    return lines


def morning_message(state: Dict[str, Any]) -> str:
    today = today_cn()
    wd = weekday_key(today)
    lines = [
        f"☀️ Утренний брифинг · {today.strftime('%d.%m.%Y')} · {WEEKDAY_LABELS.get(wd, wd)}",
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
    lines.extend(timed_tasks_block(state, today))

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
    state_dirty = False
    if state is None:
        print(
            f"WARN: не удалось прочитать/расшифровать state.json — {load_error}",
            file=sys.stderr,
        )
        text = SETUP_MESSAGE
        kind = "setup"
    else:
        if args.mode == "morning":
            before = list(state.get("sentReminderIds") or [])
            n = schedule_day_reminders(state)
            after = list(state.get("sentReminderIds") or [])
            state_dirty = before != after
            print(f"OK: scheduled {n} delayed reminder(s)", file=sys.stderr)
            text = morning_message(state)
        else:
            text = evening_message(state)
        kind = args.mode

    print(text)
    send_ntfy(text)
    if state is not None and state_dirty:
        if save_state(state):
            print("OK: persisted sentReminderIds into data/state.json", file=sys.stderr)
            # маркер для workflow commit step
            Path(os.environ.get("GITHUB_WORKSPACE", ROOT)).joinpath(
                ".cc_state_dirty"
            ).write_text("1", encoding="utf-8")
        else:
            print("WARN: could not persist sentReminderIds", file=sys.stderr)
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
