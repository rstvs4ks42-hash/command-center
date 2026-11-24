# Personal & YouTube Command Center

Бессерверное веб-приложение для ведения YouTube-конвейера, привычек, бюджета и подписок.  
Работает **24/7 бесплатно** на **GitHub Pages + GitHub Actions** и шлёт **пуш-уведомления в Telegram** на iPhone — даже когда ноутбук выключен.

Единый источник правды: файл [`data/state.json`](data/state.json) — в публичном репозитории хранится **только зашифрованный конверт** (AES-256-GCM + PBKDF2-SHA256). Расшифровка в браузере по личному PIN и в GitHub Actions по секрету `APP_PASSWORD`.

---

## Что внутри

| Вкладка | Возможности |
|--------|-------------|
| **Конвейер YouTube** | Термометр монетизации (1000 подписчиков / 4000 часов), канбан `[Идея → Сценарий/Голос → 即梦AI → Remotion → Опубликовано]`, календарь публикаций |
| **Фокус и дисциплина** | Привычки, серия дней (Streak), быстрые задачи с приоритетами |
| **Бюджет и подписки** | Расходы ¥/$ с курсом, доходы YouTube, ROI, обратный отсчёт до продления IPRoyal / Claude Pro / 即梦AI |
| **Банк промтов** | Карточки с копированием в 1 клик + чек-лист перед публикацией |
| **Настройки** | GitHub PAT + Owner + Repo в `localStorage`, смена PIN, автосинхронизация зашифрованного `state.json` |

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

### 3. Создайте PIN и включите шифрование

1. Откройте сайт — появится экран **«Создайте PIN / пароль»** (минимум 4 символа).
2. Запомните PIN: им же шифруются данные и им же должен быть секрет `APP_PASSWORD`.
3. После входа данные в памяти расшифрованы; на GitHub уходит только шифротекст.

### 4. Настройте синхронизацию с телефона / ПК

1. Создайте **Personal Access Token**:  
   GitHub → Settings → Developer settings → Personal access tokens.  
   - Fine-grained: доступ к репозиторию, permission **Contents: Read and write**.  
   - Или classic с правом `repo`.
2. Откройте сайт → вкладка **Синхр.**  
3. Вставьте **Token**, **Owner** (логин), **Repo** (имя репозитория) → **Сохранить в браузере**.  
4. Нажмите **Отправить state.json** для проверки.

Токен хранится **только в localStorage браузера** и не попадает в git.  
PIN на время вкладки лежит в `sessionStorage` (после закрытия Safari нужно войти снова).

Любое изменение данных на сайте с задержкой ~1 с само загружает **зашифрованный** `data/state.json` в репозиторий.

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
   - Имя: `APP_PASSWORD` → **тот же PIN/пароль**, что вы задали в приложении.
3. Actions должен быть включён: **Settings** → **Actions** → **General** → Allow actions.

> Если смените PIN в настройках приложения — сразу обновите секрет `APP_PASSWORD`, иначе бот перестанет читать данные.

### Шаг D — проверьте вручную

1. **Actions** → workflow **Telegram Cron (Command Center)** → **Run workflow**.
2. Выберите `morning` или `evening` → Run.
3. Через несколько секунд сообщение должно прийти в Telegram.

Cron на бесплатных раннерах GitHub может срабатывать с задержкой до ~15 минут — это нормально.

### Локальный тест скрипта

```bash
pip install -r bot/requirements.txt
# PowerShell:
$env:BOT_TOKEN="..."
$env:CHAT_ID="..."
$env:APP_PASSWORD="ваш-пин"
python bot/notify.py --mode morning
python bot/notify.py --mode evening
```

---

## Шифрование `data/state.json`

Формат файла в репозитории:

```json
{
  "v": 1,
  "alg": "AES-GCM",
  "kdf": "PBKDF2-SHA256",
  "iter": 250000,
  "initialized": true,
  "salt": "<base64>",
  "iv": "<base64>",
  "ct": "<base64 ciphertext>"
}
```

- Браузер: Web Crypto API (`js/crypto.js`)
- Бот: `cryptography` (`bot/crypto_util.py`) + секрет `APP_PASSWORD`

Пока `initialized: false` — хранилище пустое, приложение предложит создать PIN.

---

## Работа с Claude Code / git на ПК

Файл в git **зашифрован**. Для правок на ПК:

```bash
git pull
pip install -r bot/requirements.txt
$env:APP_PASSWORD="ваш-пин"
python -c "from pathlib import Path; from bot.crypto_util import load_and_decrypt; import json; print(json.dumps(load_and_decrypt(Path('data/state.json')), ensure_ascii=False, indent=2))"
```

Удобнее вносить изменения через веб-приложение (оно само шифрует и пушит).  
Если правите plaintext локально — зашифруйте обратно тем же PIN перед `git push` (через UI или свой скрипт на базе `bot/crypto_util.py`).

---

## Структура проекта

```
├── index.html                 # SPA + экран входа
├── css/styles.css
├── js/crypto.js               # AES-GCM / PBKDF2 (Web Crypto)
├── js/state.js                # state + encrypted GitHub sync
├── js/app.js                  # 5 вкладок + lock screen
├── data/state.json            # зашифрованный конверт (не plaintext)
├── bot/notify.py              # Telegram-уведомления
├── bot/crypto_util.py         # расшифровка для бота / CLI
├── bot/requirements.txt
├── .github/workflows/telegram_cron.yml
├── manifest.webmanifest
└── README.md
```

---

## Безопасность

- **Не коммитьте** PAT, `BOT_TOKEN`, `CHAT_ID`, `APP_PASSWORD` и plaintext-данные.
- В публичном `data/state.json` видны только salt/iv/ciphertext — не задачи и не бюджет.
- PAT в интерфейсе живёт только в `localStorage` устройства.
- PIN — в `sessionStorage` до закрытия вкладки; для бота — только GitHub Secret `APP_PASSWORD`.
- Рекомендуется fine-grained token с доступом к одному репо и правом Contents.

---

## Лицензия

Личный проект / MIT — используйте свободно для своего канала и дисциплины.
