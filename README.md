# Personal & YouTube Command Center

Бессерверное веб-приложение для ведения YouTube-конвейера, привычек, бюджета и подписок.  
Работает **24/7 бесплатно** на **GitHub Pages + GitHub Actions** и шлёт **пуш-уведомления в Telegram** на iPhone — даже когда ноутбук выключен.

Единый источник правды: файл [`data/state.json`](data/state.json). Его же может читать и обновлять Claude Code на ПК через `git pull` / `git push`.

---

## Что внутри

| Вкладка | Возможности |
|--------|-------------|
| **Конвейер YouTube** | Термометр монетизации (1000 подписчиков / 4000 часов), канбан `[Идея → Сценарий/Голос → 即梦AI → Remotion → Опубликовано]`, календарь публикаций |
| **Фокус и дисциплина** | Привычки, серия дней (Streak), быстрые задачи с приоритетами |
| **Бюджет и подписки** | Расходы ¥/$ с курсом, доходы YouTube, ROI, обратный отсчёт до продления IPRoyal / Claude Pro / 即梦AI |
| **Банк промтов** | Карточки с копированием в 1 клик + чек-лист перед публикацией |
| **Настройки** | GitHub PAT + Owner + Repo в `localStorage`, автосинхронизация `state.json` |

---

## Быстрый старт

### 1. Создайте репозиторий и загрузите код

```bash
git init
git add .
git commit -m "feat: Personal & YouTube Command Center"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

### 2. Включите GitHub Pages

1. Откройте репозиторий на GitHub → **Settings** → **Pages**.
2. **Source**: Deploy from a branch.
3. **Branch**: `main` / папка `/ (root)`.
4. Сохраните. Через 1–2 минуты сайт будет по адресу:  
   `https://ВАШ_ЛОГИН.github.io/ИМЯ_РЕПО/`

> Для добавления на экран «Домой» iPhone: Safari → «Поделиться» → «На экран „Домой“».

### 3. Настройте синхронизацию с телефона / ПК

1. Создайте **Personal Access Token**:  
   GitHub → Settings → Developer settings → Personal access tokens.  
   - Fine-grained: доступ к репозиторию, permission **Contents: Read and write**.  
   - Или classic с правом `repo`.
2. Откройте сайт → вкладка **Синхр.**  
3. Вставьте **Token**, **Owner** (логин), **Repo** (имя репозитория) → **Сохранить в браузере**.  
4. Нажмите **Отправить state.json** для проверки.

Токен хранится **только в localStorage браузера** и не попадает в git.

Любое изменение данных на сайте с задержкой ~1 с само загружает обновлённый `data/state.json` в репозиторий.

---

## Telegram-бот без сервера

Уведомления шлёт GitHub Actions по расписанию:

| Режим | Время (Нанкин, UTC+8) | UTC | Содержание |
|-------|------------------------|-----|------------|
| `morning` | 10:00 | 02:00 | Прогресс монетизации, ролики в работе, привычки, предупреждения о подписках ≤ 3 дней |
| `evening` | 21:00 | 13:00 | Незакрытые привычки/задачи + мотивация не сбить Streak |

Файлы: [`bot/notify.py`](bot/notify.py), [`.github/workflows/telegram_cron.yml`](.github/workflows/telegram_cron.yml).

### Шаг A — создайте бота в @BotFather

1. Откройте Telegram → найдите **[@BotFather](https://t.me/BotFather)**.
2. Отправьте `/newbot`.
3. Укажите имя и username (должен заканчиваться на `bot`).
4. Скопируйте **HTTP API Token** вида `123456:ABC-DEF...` — это `BOT_TOKEN`.

### Шаг B — узнайте свой CHAT_ID

1. Напишите своему боту любое сообщение (например, «привет»).
2. В браузере откройте (подставьте токен):  
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
3. В JSON найдите `"chat":{"id": 123456789}` — это `CHAT_ID` (для лички — число; для группы часто отрицательное).

Альтернатива: бот [@userinfobot](https://t.me/userinfobot) покажет ваш id.

### Шаг C — добавьте GitHub Secrets

1. Репозиторий → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**:
   - Имя: `BOT_TOKEN` → значение токена от BotFather.
   - Имя: `CHAT_ID` → ваш chat id.
3. Actions должен быть включён: **Settings** → **Actions** → **General** → Allow actions.

### Шаг D — проверьте вручную

1. **Actions** → workflow **Telegram Cron (Command Center)** → **Run workflow**.
2. Выберите `morning` или `evening` → Run.
3. Через несколько секунд сообщение должно прийти в Telegram.

Cron на бесплатных раннерах GitHub может срабатывать с задержкой до ~15 минут — это нормально.

### Локальный тест скрипта

```bash
pip install -r bot/requirements.txt
set BOT_TOKEN=...
set CHAT_ID=...
python bot/notify.py --mode morning
python bot/notify.py --mode evening
```

(В PowerShell: `$env:BOT_TOKEN="..."; $env:CHAT_ID="..."`.)

---

## Работа с Claude Code / git на ПК

```bash
git pull
# правки data/state.json или кода
git add data/state.json
git commit -m "chore: обновить прогресс монетизации"
git push
```

После push:

- сайт на Pages подхватит новый `state.json` при обновлении страницы;
- утренний/вечерний бот будет читать уже актуальные данные.

На iPhone после правок в приложении данные сами уходят в GitHub (нужен PAT в настройках). На ПК перед работой удобно сделать `git pull`.

---

## Структура проекта

```
├── index.html                 # SPA
├── css/styles.css             # тёмный премиальный UI
├── js/state.js                # state + GitHub REST sync
├── js/app.js                  # 5 вкладок UI
├── data/state.json            # единственное хранилище данных
├── bot/notify.py              # Telegram-уведомления
├── bot/requirements.txt
├── .github/workflows/telegram_cron.yml
├── manifest.webmanifest       # Add to Home Screen
└── README.md
```

---

## Безопасность

- **Не коммитьте** PAT, `BOT_TOKEN` и `CHAT_ID` в репозиторий.
- PAT в интерфейсе живёт только в `localStorage` конкретного браузера/устройства.
- Для бота используйте только **GitHub Secrets**.
- Рекомендуется fine-grained token с доступом к одному репо и правом Contents.

---

## Лицензия

Личный проект / MIT — используйте свободно для своего канала и дисциплины.
