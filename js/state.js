/**
 * Personal & YouTube Command Center — state + GitHub sync
 * Source of truth: data/state.json (also mirrored in memory / localStorage cache)
 */

const STATE_PATH = "data/state.json";
const LS_GITHUB = "cc_github_creds";
const LS_CACHE = "cc_state_cache";

const STAGES = [
  { id: "idea", label: "Идея" },
  { id: "script", label: "Сценарий/Голос" },
  { id: "images", label: "Картинки 即梦AI" },
  { id: "edit", label: "Монтаж Remotion" },
  { id: "published", label: "Опубликовано" },
];

const STAGE_CHECK = {
  idea: "idea",
  script: "script",
  images: "images",
  edit: "edit",
  published: "publish",
};

let state = null;
let syncTimer = null;
let syncStatus = "idle"; // idle | pending | ok | error
let syncListeners = [];
let changeListeners = [];

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

function getState() {
  return state;
}

async function loadState() {
  // Prefer live file from Pages / local server
  try {
    const res = await fetch(`${STATE_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      state = await res.json();
      localStorage.setItem(LS_CACHE, JSON.stringify(state));
      ensureDefaults();
      return state;
    }
  } catch (_) {
    /* offline / file:// */
  }

  const cached = localStorage.getItem(LS_CACHE);
  if (cached) {
    state = JSON.parse(cached);
    ensureDefaults();
    return state;
  }

  throw new Error("Не удалось загрузить data/state.json");
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
}

function persistLocal() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(LS_CACHE, JSON.stringify(state));
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

  setSyncStatus("pending");
  try {
    const sha = await getFileSha(creds);
    const body = {
      message: `chore: sync state.json (${new Date().toISOString()})`,
      content: toBase64Utf8(JSON.stringify(state, null, 2)),
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
      // retry with master
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
  setSyncStatus("pending");
  const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${STATE_PATH}`;
  const res = await fetch(url, { headers: await githubHeaders(creds.token) });
  if (!res.ok) {
    setSyncStatus("error");
    throw new Error(`Не удалось скачать state.json: ${res.status}`);
  }
  const data = await res.json();
  state = JSON.parse(fromBase64Utf8(data.content.replace(/\n/g, "")));
  ensureDefaults();
  localStorage.setItem(LS_CACHE, JSON.stringify(state));
  setSyncStatus("ok");
  emitChange();
  return state;
}

function updateState(mutator) {
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
  uid,
  todayISO,
  daysUntil,
  getState,
  loadState,
  updateState,
  persistLocal,
  getGithubCreds,
  setGithubCreds,
  pushToGithub,
  pullFromGithub,
  onSyncStatus,
  onChange,
  convertAmount,
  setSyncStatus,
};
