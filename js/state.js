/**
 * Personal & YouTube Command Center — state + encrypted GitHub sync
 * На GitHub уходит только AES-GCM конверт data/state.json
 */

const STATE_PATH = "data/state.json";
const LS_GITHUB = "cc_github_creds";
const LS_NTFY = "cc_ntfy_topic";
const LS_VAULT = "cc_vault_cache";
const SS_PASSWORD = "cc_app_password";
const NTFY_CLICK = "https://rstvs4ks42-hash.github.io/command-center/";

const STAGES = [
  { id: "idea", label: "💡 Идея" },
  { id: "script", label: "✍️ Сценарий" },
  { id: "images", label: "🎨 Визуал/Озвучка" },
  { id: "edit", label: "🎬 Монтаж" },
  { id: "published", label: "🚀 Опубликовано" },
];

const BUDGET_CATEGORIES = [
  { id: "ai", label: "Подписки ИИ" },
  { id: "proxy", label: "Прокси/VPN" },
  { id: "gear", label: "Техника" },
  { id: "life", label: "Жизнь/Еда" },
  { id: "income", label: "Доход" },
];

const STAGE_CHECK = {
  idea: "idea",
  script: "script",
  images: "images",
  edit: "edit",
  published: "publish",
};

const DEFAULT_STATE = {
  version: 1,
  updatedAt: new Date().toISOString(),
  monetization: {
    subscribers: 0,
    subscribersGoal: 1000,
    watchHours: 0,
    watchHoursGoal: 4000,
  },
  videos: [],
  habits: [
    { id: "hab-001", name: "1 час работы над YouTube", archived: false, time: null },
    { id: "hab-002", name: "Английский / Учёба", archived: false, time: null },
    { id: "hab-003", name: "Спорт / Активность", archived: false, time: null },
    { id: "hab-004", name: "Сон до 01:00", archived: false, time: "01:00" },
  ],
  habitLogs: {},
  streak: { current: 0, best: 0, lastCompleteDate: null },
  tasks: [],
  dailyTasks: [],
  weeklySchedule: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
  weeklyScheduleAppliedDate: null,
  calendarEvents: [],
  sentReminderIds: [],
  ntfyTopic: "",
  launchFund: {
    title: "Копилка на запуск ИИ-конвейера",
    savedCny: 0,
    goalCny: 265,
    goalUsd: 37,
  },
  budget: { exchangeRate: 7.2, expenses: [], income: [] },
  subscriptions: [
    {
      id: "sub-001",
      name: "Static IP США (IPRoyal)",
      renewDate: "",
      price: 5.4,
      currency: "USD",
      critical: true,
    },
    {
      id: "sub-002",
      name: "Claude Pro",
      renewDate: "",
      price: 20,
      currency: "USD",
      critical: false,
    },
    {
      id: "sub-003",
      name: "即梦AI",
      renewDate: "",
      price: 79,
      currency: "CNY",
      critical: false,
    },
  ],
  prompts: [
    {
      id: "prm-001",
      title: "Поиск ниши YouTube",
      category: "research",
      text: "Проанализируй 10 каналов в нише [НИША]. Для каждого укажи: средний CTR обложек, удержание 0–30 сек, частота Shorts vs Long, темы с наибольшим ростом за 90 дней. Предложи 5 идей роликов с прогнозом виральности %.",
    },
    {
      id: "prm-002",
      title: "Стилистика Paper Billions / 即梦AI",
      category: "jimeng",
      text: "Cinematic dark studio, paper money origami transforming into glowing neon figures, ultra detailed, volumetric lighting, shallow depth of field, Paper Billions aesthetic, 8k, dramatic contrast --ar 16:9",
    },
    {
      id: "prm-003",
      title: "Brainstorm кадры 即梦AI",
      category: "jimeng",
      text: "Storyboard frame [N]/ dark moody atmosphere, surreal finance metaphor, paper texture + liquid metal, soft rim light, centered composition, no text, no watermark, photoreal cinematic",
    },
    {
      id: "prm-004",
      title: "Claude Code: обновить state.json",
      category: "claude",
      text: "Расшифруй data/state.json через bot/crypto_util.py и APP_PASSWORD. Обнови [ПОЛЕ]. Зашифруй обратно тем же паролем и сделай git push.",
    },
    {
      id: "prm-005",
      title: "Хук 0–12 сек",
      category: "script",
      text: "Напиши 3 варианта хука (0–12 сек) для ролика «[НАЗВАНИЕ]». Формат: шокирующий факт → вопрос → обещание результата. Без воды, разговорный русский.",
    },
  ],
  publishChecklist: {
    hook: false,
    thumbnail: false,
    subtitles: false,
    hashtags: false,
    endScreen: false,
    description: false,
  },
};

let state = null;
let vaultEnvelope = null;
let appPassword = null;
let unlocked = false;
let syncTimer = null;
let syncStatus = "idle";
let syncListeners = [];
let changeListeners = [];
let authListeners = [];

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayISO(tzOffsetHours = 8) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const local = new Date(utc + tzOffsetHours * 3600000);
  return local.toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(todayISO() + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - today) / 86400000);
}

function getGithubCreds() {
  try {
    return JSON.parse(localStorage.getItem(LS_GITHUB) || "null") || { token: "", owner: "", repo: "" };
  } catch {
    return { token: "", owner: "", repo: "" };
  }
}

function setGithubCreds(creds) {
  localStorage.setItem(LS_GITHUB, JSON.stringify(creds));
}

function getNtfyTopic() {
  try {
    const fromLs = (localStorage.getItem(LS_NTFY) || "").trim();
    if (fromLs) return fromLs;
  } catch {
    /* ignore */
  }
  if (state && state.ntfyTopic) return String(state.ntfyTopic).trim();
  return "";
}

function setNtfyTopic(topic) {
  const t = (topic || "").trim();
  try {
    localStorage.setItem(LS_NTFY, t);
  } catch {
    /* ignore */
  }
  if (state) state.ntfyTopic = t;
}

/** ISO datetime in Asia/Shanghai (+08:00) for date YYYY-MM-DD + HH:MM */
function shanghaiIso(dateStr, timeStr) {
  const t = (timeStr || "09:00").slice(0, 5);
  return `${dateStr}T${t}:00+08:00`;
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABELS = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

function emptyWeeklySchedule() {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

/** День недели для календарной даты YYYY-MM-DD (Пн–Вс), без зависимости от TZ браузера. */
function weekdayKeyFromISO(dateStr) {
  const iso = (dateStr || todayISO()).slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0=Sun
  return WEEKDAY_KEYS[(utcDay + 6) % 7]; // mon=0 … sun=6
}

function normalizeTimeHHMM(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(":").map(Number);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function reminderKey(kind, id, dateStr, timeStr) {
  return `${kind}:${id}:${dateStr}:${timeStr}`;
}

/**
 * Планирует отложенный пуш ntfy (заголовок At: ISO+08:00).
 * Вызов: scheduleNtfyReminder(title, dateStr, timeStr, id)
 * или объект { kind, id, title, date, time }.
 * Дедуп через state.sentReminderIds.
 */
async function scheduleNtfyReminder(titleOrOpts, dateStr, timeStr, id) {
  let kind = "task";
  let title;
  let date;
  let time;
  let itemId;
  if (titleOrOpts && typeof titleOrOpts === "object" && !Array.isArray(titleOrOpts)) {
    kind = titleOrOpts.kind || "task";
    title = titleOrOpts.title;
    date = titleOrOpts.date;
    time = titleOrOpts.time;
    itemId = titleOrOpts.id;
  } else {
    title = titleOrOpts;
    date = dateStr;
    time = timeStr;
    itemId = id;
  }

  if (!date || !time) return { ok: false, reason: "no-time" };
  const tm = normalizeTimeHHMM(time);
  if (!tm) return { ok: false, reason: "bad-time" };
  const topic = getNtfyTopic();
  if (!topic) return { ok: false, reason: "no-topic" };

  const key = reminderKey(kind, itemId || "x", date, tm);
  if (!state.sentReminderIds) state.sentReminderIds = [];
  if (state.sentReminderIds.includes(key)) return { ok: true, reason: "already" };

  const at = shanghaiIso(date, tm);
  const atMs = Date.parse(at);
  // Минимум +1 минута от текущего момента (Asia/Shanghai ISO+08:00)
  if (!Number.isFinite(atMs) || atMs < Date.now() + 60_000) {
    return { ok: false, reason: "past" };
  }

  const body = `⏰ Пора (${tm}): ${title || "Без названия"}`;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: "Command Center Reminder",
        Priority: "default",
        Tags: "alarm_clock",
        At: at,
        Click: NTFY_CLICK,
        Actions: `view, Open App, ${NTFY_CLICK}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("ntfy schedule failed", res.status, text);
      return { ok: false, reason: `http-${res.status}` };
    }
    state.sentReminderIds.push(key);
    if (state.sentReminderIds.length > 400) {
      state.sentReminderIds = state.sentReminderIds.slice(-300);
    }
    await persistLocal();
    return { ok: true, reason: "scheduled", at };
  } catch (e) {
    console.error(e);
    return { ok: false, reason: e.message || "network" };
  }
}

/** Мгновенный тестовый пуш на iPhone — проверка канала ntfy. */
async function sendNtfyTestPush() {
  const topic = getNtfyTopic();
  if (!topic) return { ok: false, reason: "no-topic" };
  const body = "✅ Тест: Command Center подключён. Точные пуши HH:MM идут прямо с iPhone.";
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: "Command Center",
        Priority: "default",
        Tags: "white_check_mark",
        Click: NTFY_CLICK,
        Actions: `view, Open App, ${NTFY_CLICK}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("ntfy test failed", res.status, text);
      return { ok: false, reason: `http-${res.status}` };
    }
    return { ok: true, reason: "sent" };
  } catch (e) {
    console.error(e);
    return { ok: false, reason: e.message || "network" };
  }
}

function onSyncStatus(fn) {
  syncListeners.push(fn);
  fn(syncStatus);
}

function setSyncStatus(s) {
  syncStatus = s;
  syncListeners.forEach((fn) => fn(s));
}

function onChange(fn) {
  changeListeners.push(fn);
}

function emitChange() {
  changeListeners.forEach((fn) => fn(state));
}

function onAuth(fn) {
  authListeners.push(fn);
  fn({ unlocked, needsSetup: getAuthMode() === "setup" || getAuthMode() === "migrate" });
}

function emitAuth() {
  const mode = getAuthMode();
  authListeners.forEach((fn) =>
    fn({ unlocked, needsSetup: mode === "setup" || mode === "migrate", mode })
  );
}

function getState() {
  return state;
}

function isUnlocked() {
  return unlocked;
}

function getAuthMode() {
  if (unlocked) return "open";
  if (!vaultEnvelope) return "loading";
  if (window.CCCrypto.isInitialized(vaultEnvelope)) return "login";
  if (vaultEnvelope && vaultEnvelope.__plaintext) return "migrate";
  return "setup";
}

function setSessionPassword(password) {
  appPassword = password;
  try {
    sessionStorage.setItem(SS_PASSWORD, password);
  } catch (_) {
    /* private mode */
  }
}

function clearSessionPassword() {
  appPassword = null;
  try {
    sessionStorage.removeItem(SS_PASSWORD);
  } catch (_) {
    /* ignore */
  }
}

function readSessionPassword() {
  try {
    return sessionStorage.getItem(SS_PASSWORD) || null;
  } catch {
    return null;
  }
}

async function fetchEnvelope() {
  try {
    const res = await fetch(`${STATE_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch (_) {
    /* offline */
  }

  const cached = localStorage.getItem(LS_VAULT);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {
      /* ignore */
    }
  }

  // Миграция со старого plaintext-кэша
  const legacy = localStorage.getItem("cc_state_cache");
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      if (parsed && parsed.monetization) {
        return { __plaintext: true, data: parsed };
      }
    } catch (_) {
      /* ignore */
    }
  }

  return window.CCCrypto.emptyEnvelope();
}

function normalizeFetched(raw) {
  if (window.CCCrypto.isEnvelope(raw)) return raw;
  if (raw && raw.__plaintext) return raw;
  if (raw && raw.monetization) return { __plaintext: true, data: raw };
  return window.CCCrypto.emptyEnvelope();
}

async function loadVaultMeta() {
  vaultEnvelope = normalizeFetched(await fetchEnvelope());
  // Удаляем старый plaintext-кэш из браузера
  try {
    localStorage.removeItem("cc_state_cache");
  } catch (_) {
    /* ignore */
  }
  return vaultEnvelope;
}

function ensureDefaults() {
  if (!state.habitLogs) state.habitLogs = {};
  if (!state.streak) state.streak = { current: 0, best: 0, lastCompleteDate: null };
  if (!state.publishChecklist) {
    state.publishChecklist = {
      hook: false,
      thumbnail: false,
      subtitles: false,
      hashtags: false,
      endScreen: false,
      description: false,
    };
  }
  if (!state.budget) state.budget = { exchangeRate: 7.2, expenses: [], income: [] };
  if (!state.habits) state.habits = JSON.parse(JSON.stringify(DEFAULT_STATE.habits));
  else {
    state.habits.forEach((h) => {
      if (h.time === undefined) h.time = null;
      else h.time = normalizeTimeHHMM(h.time);
    });
  }
  if (!state.videos) state.videos = [];
  if (!state.tasks) state.tasks = [];
  if (!Array.isArray(state.calendarEvents)) state.calendarEvents = [];
  if (!Array.isArray(state.sentReminderIds)) state.sentReminderIds = [];
  // ntfyTopic: локально + в зашифрованном state.json
  if (state.ntfyTopic == null) state.ntfyTopic = "";
  else state.ntfyTopic = String(state.ntfyTopic).trim();
  try {
    const lsTopic = (localStorage.getItem(LS_NTFY) || "").trim();
    if (state.ntfyTopic) {
      if (lsTopic !== state.ntfyTopic) localStorage.setItem(LS_NTFY, state.ntfyTopic);
    } else if (lsTopic) {
      state.ntfyTopic = lsTopic;
    }
  } catch {
    /* ignore */
  }
  if (!state.weeklySchedule || typeof state.weeklySchedule !== "object") {
    state.weeklySchedule = emptyWeeklySchedule();
  } else {
    WEEKDAY_KEYS.forEach((k) => {
      if (!Array.isArray(state.weeklySchedule[k])) state.weeklySchedule[k] = [];
      state.weeklySchedule[k].forEach((item) => {
        if (!item.id) item.id = uid("ws");
        if (item.time === undefined) item.time = null;
        else item.time = normalizeTimeHHMM(item.time);
        if (!item.priority) item.priority = "normal";
        if (item.priority === "medium" || item.priority === "low") item.priority = "normal";
      });
    });
  }
  if (state.weeklyScheduleAppliedDate === undefined) state.weeklyScheduleAppliedDate = null;
  if (!state.launchFund) {
    state.launchFund = JSON.parse(JSON.stringify(DEFAULT_STATE.launchFund));
  } else {
    const fund = state.launchFund;
    if (!fund.title) fund.title = DEFAULT_STATE.launchFund.title;
    // Старый дефолт ¥320 / $45 → актуальный ¥265 / ~$37
    if (fund.goalCny === 320 && (fund.goalUsd === 45 || fund.goalUsd == null)) {
      fund.goalCny = 265;
      fund.goalUsd = 37;
    }
    if (fund.goalUsd == null && fund.goalCny) {
      const rate = state.budget?.exchangeRate || 7.2;
      fund.goalUsd = Math.round((fund.goalCny / rate) * 10) / 10;
    }
  }
  if (!state.prompts) state.prompts = JSON.parse(JSON.stringify(DEFAULT_STATE.prompts));
  if (!state.subscriptions) {
    state.subscriptions = JSON.parse(JSON.stringify(DEFAULT_STATE.subscriptions));
  } else if (Array.isArray(state.subscriptions)) {
    // Обновить устаревшие стартовые цены стандартных подписок
    const priceFixes = {
      "sub-001": { old: 15, next: 5.4, name: /iproyal|static\s*ip/i },
      "sub-003": { old: 99, next: 79, name: /即梦|jimeng/i },
    };
    state.subscriptions.forEach((sub) => {
      const fix = priceFixes[sub.id];
      if (!fix) return;
      if (Number(sub.price) === fix.old && fix.name.test(sub.name || "")) {
        sub.price = fix.next;
      }
    });
  }
  if (!state.monetization) {
    state.monetization = JSON.parse(JSON.stringify(DEFAULT_STATE.monetization));
  } else {
    if (state.monetization.subscribersGoal == null) state.monetization.subscribersGoal = 1000;
    if (state.monetization.watchHoursGoal == null) state.monetization.watchHoursGoal = 4000;
  }
  // migrate tasks → dailyTasks
  if (!Array.isArray(state.dailyTasks)) {
    state.dailyTasks = (state.tasks || []).map((t) => ({
      id: t.id || uid("dt"),
      title: t.title || "",
      date: t.date || todayISO(),
      time: t.time || null,
      priority: t.priority === "high" ? "high" : "normal",
      done: !!t.done,
    }));
  }
  state.dailyTasks.forEach((t) => {
    if (t.priority === "medium" || t.priority === "low") t.priority = "normal";
    if (t.time === undefined) t.time = null;
    else t.time = normalizeTimeHHMM(t.time);
  });
  state.calendarEvents.forEach((ev) => {
    if (ev.time === undefined) ev.time = null;
  });
  state.videos.forEach((v) => {
    if (v.hookScore == null) v.hookScore = 5;
    if (v.niche == null) v.niche = "";
    if (v.rpm == null) v.rpm = 0;
    if (!v.ready) {
      v.ready = {
        hook: !!v.checklist?.idea,
        script: !!v.checklist?.script,
        thumb: false,
        voice: false,
        render: !!v.checklist?.edit,
      };
    }
  });
  state.prompts.forEach((p) => {
    if (!Array.isArray(p.tags)) {
      p.tags = p.category ? [String(p.category)] : [];
    }
  });
}

async function persistVaultCache() {
  if (!vaultEnvelope || vaultEnvelope.__plaintext) return;
  localStorage.setItem(LS_VAULT, JSON.stringify(vaultEnvelope));
}

async function buildEncryptedEnvelope() {
  if (!appPassword) throw new Error("Сначала войдите по PIN/паролю");
  const salt = vaultEnvelope && vaultEnvelope.salt ? vaultEnvelope.salt : null;
  return window.CCCrypto.encryptState(appPassword, state, salt);
}

async function persistLocal() {
  if (!unlocked || !state) return;
  state.updatedAt = new Date().toISOString();
  vaultEnvelope = await buildEncryptedEnvelope();
  await persistVaultCache();
  emitChange();
  scheduleGithubPush();
}

function scheduleGithubPush() {
  const creds = getGithubCreds();
  if (!creds.token || !creds.owner || !creds.repo) {
    setSyncStatus("idle");
    return;
  }
  setSyncStatus("pending");
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToGithub(), 900);
}

async function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function getFileSha(creds) {
  const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${STATE_PATH}`;
  const res = await fetch(url, { headers: await githubHeaders(creds.token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub GET: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.sha;
}

function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64Utf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

async function pushToGithub(manual = false) {
  const creds = getGithubCreds();
  if (!creds.token || !creds.owner || !creds.repo) {
    if (manual) throw new Error("Укажите GitHub Token, Owner и Repo в настройках");
    setSyncStatus("idle");
    return;
  }
  if (!unlocked || !appPassword) {
    if (manual) throw new Error("Сначала войдите по PIN/паролю");
    setSyncStatus("idle");
    return;
  }

  setSyncStatus("pending");
  try {
    vaultEnvelope = await buildEncryptedEnvelope();
    await persistVaultCache();

    const sha = await getFileSha(creds);
    const body = {
      message: `chore: sync encrypted state (${new Date().toISOString()})`,
      content: toBase64Utf8(JSON.stringify(vaultEnvelope, null, 2)),
      branch: "main",
    };
    if (sha) body.sha = sha;

    const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${STATE_PATH}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: await githubHeaders(creds.token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 422) {
        body.branch = "master";
        const res2 = await fetch(url, {
          method: "PUT",
          headers: await githubHeaders(creds.token),
          body: JSON.stringify(body),
        });
        if (!res2.ok) {
          const err = await res2.text();
          throw new Error(`GitHub PUT: ${res2.status} ${err}`);
        }
      } else {
        const err = await res.text();
        throw new Error(`GitHub PUT: ${res.status} ${err}`);
      }
    }

    setSyncStatus("ok");
  } catch (e) {
    console.error(e);
    setSyncStatus("error");
    if (manual) throw e;
  }
}

async function pullFromGithub() {
  const creds = getGithubCreds();
  if (!creds.token || !creds.owner || !creds.repo) {
    throw new Error("Укажите GitHub Token, Owner и Repo в настройках");
  }
  if (!appPassword) throw new Error("Сначала войдите по PIN/паролю");

  setSyncStatus("pending");
  const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${STATE_PATH}`;
  const res = await fetch(url, { headers: await githubHeaders(creds.token) });
  if (!res.ok) {
    setSyncStatus("error");
    throw new Error(`Не удалось скачать state.json: ${res.status}`);
  }
  const data = await res.json();
  const raw = JSON.parse(fromBase64Utf8(data.content.replace(/\n/g, "")));
  const envelope = normalizeFetched(raw);

  if (envelope.__plaintext) {
    state = envelope.data;
    ensureDefaults();
    vaultEnvelope = await window.CCCrypto.encryptState(appPassword, state, null);
  } else {
    state = await window.CCCrypto.decryptState(appPassword, envelope);
    ensureDefaults();
    vaultEnvelope = envelope;
  }

  await persistVaultCache();
  unlocked = true;
  setSyncStatus("ok");
  emitAuth();
  emitChange();
  return state;
}

async function unlockWithPassword(password) {
  if (!password || password.length < 4) {
    throw new Error("Минимум 4 символа");
  }
  if (!vaultEnvelope) await loadVaultMeta();

  if (vaultEnvelope.__plaintext) {
    state = vaultEnvelope.data;
    ensureDefaults();
    setSessionPassword(password);
    vaultEnvelope = await window.CCCrypto.encryptState(password, state, null);
    await persistVaultCache();
    unlocked = true;
    emitAuth();
    emitChange();
    scheduleGithubPush();
    return state;
  }

  if (!window.CCCrypto.isInitialized(vaultEnvelope)) {
    throw new Error("Сначала создайте PIN/пароль");
  }

  state = await window.CCCrypto.decryptState(password, vaultEnvelope);
  ensureDefaults();
  setSessionPassword(password);
  unlocked = true;
  emitAuth();
  emitChange();
  return state;
}

async function setupPassword(password, confirm) {
  if (!password || password.length < 4) {
    throw new Error("Минимум 4 символа");
  }
  if (password !== confirm) {
    throw new Error("Пароли не совпадают");
  }
  if (!vaultEnvelope) await loadVaultMeta();

  if (vaultEnvelope.__plaintext) {
    state = vaultEnvelope.data;
  } else if (window.CCCrypto.isInitialized(vaultEnvelope)) {
    throw new Error("Хранилище уже создано — войдите по паролю");
  } else {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  ensureDefaults();
  setSessionPassword(password);
  vaultEnvelope = await window.CCCrypto.encryptState(password, state, null);
  await persistVaultCache();
  unlocked = true;
  emitAuth();
  emitChange();
  scheduleGithubPush();
  return state;
}

async function changePassword(oldPass, newPass, confirm) {
  if (!unlocked || !appPassword) throw new Error("Сначала войдите");
  if (oldPass !== appPassword) throw new Error("Текущий пароль неверен");
  if (!newPass || newPass.length < 4) throw new Error("Новый пароль: минимум 4 символа");
  if (newPass !== confirm) throw new Error("Пароли не совпадают");

  setSessionPassword(newPass);
  // Новый salt при смене пароля
  vaultEnvelope = await window.CCCrypto.encryptState(newPass, state, null);
  await persistVaultCache();
  scheduleGithubPush();
}

function lockApp() {
  unlocked = false;
  state = null;
  clearSessionPassword();
  emitAuth();
}

async function tryAutoUnlock() {
  const saved = readSessionPassword();
  if (!saved) return false;
  if (!vaultEnvelope) await loadVaultMeta();
  if (!window.CCCrypto.isInitialized(vaultEnvelope)) return false;
  try {
    await unlockWithPassword(saved);
    return true;
  } catch {
    clearSessionPassword();
    return false;
  }
}

function updateState(mutator) {
  if (!unlocked || !state) return;
  mutator(state);
  persistLocal();
}

function convertAmount(amount, from, to, rate) {
  const r = rate || state.budget.exchangeRate || 7.2;
  let usd = from === "USD" ? amount : amount / r;
  if (to === "USD") return usd;
  if (to === "CNY") return usd * r;
  return amount;
}

window.CC = {
  STAGES,
  STAGE_CHECK,
  BUDGET_CATEGORIES,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  DEFAULT_STATE,
  uid,
  todayISO,
  daysUntil,
  shanghaiIso,
  weekdayKeyFromISO,
  normalizeTimeHHMM,
  emptyWeeklySchedule,
  scheduleNtfyReminder,
  sendNtfyTestPush,
  getState,
  loadVaultMeta,
  unlockWithPassword,
  setupPassword,
  changePassword,
  lockApp,
  tryAutoUnlock,
  isUnlocked,
  getAuthMode,
  updateState,
  persistLocal,
  getGithubCreds,
  setGithubCreds,
  getNtfyTopic,
  setNtfyTopic,
  pushToGithub,
  pullFromGithub,
  onSyncStatus,
  onChange,
  onAuth,
  convertAmount,
  setSyncStatus,
};
