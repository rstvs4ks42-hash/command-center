/**
 * IP-Щит — 6-уровневый сканер чистоты соединения + Claude Aegis remote.
 * Без ложных тревог на Static Residential / ISP (Soanalytics и др.).
 */
(() => {
  const BLOCKED = new Set(["CN", "HK", "MO", "RU", "BY", "IR", "KP"]);

  /** Только явные облачные хостинги — штрафуем. ISP / Soanalytics / региональные — чистые. */
  const HOSTING_RE = [
    /\bdigitalocean\b/i,
    /\bvultr\b/i,
    /\bhetzner\b/i,
    /\bovh\b/i,
    /\blinode\b/i,
    /\bamazon\s*aws\b/i,
    /\bamazonaws\b/i,
    /\baws\b/i,
    /\bgoogle\s*cloud\b/i,
    /\bgcp\b/i,
    /\bmicrosoft\s*azure\b/i,
    /\bazure\b/i,
    /\balibaba\s*cloud\b/i,
    /\balibaba\b/i,
    /\btencent\s*cloud\b/i,
    /\btencent\b/i,
    /\bcontabo\b/i,
    /\bm247\b/i,
    /\bchoopa\b/i,
  ];

  const TIMEOUT_MS = 5000;
  const WEBRTC_MS = 2500;
  let running = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fetchTimeout(url, ms = TIMEOUT_MS, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" }).finally(() =>
      clearTimeout(t)
    );
  }

  async function getJson(url) {
    const res = await fetchTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getText(url) {
    const res = await fetchTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function parseCfTrace(text) {
    const out = {};
    String(text || "")
      .split("\n")
      .forEach((line) => {
        const i = line.indexOf("=");
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
    return out;
  }

  function normalizeIp(ip) {
    return String(ip || "").trim().toLowerCase();
  }

  function normalizeCc(cc) {
    return String(cc || "").trim().toUpperCase();
  }

  function formatAsn(v) {
    if (v == null || v === "") return "";
    const s = String(v).trim();
    if (/^as\d+/i.test(s)) return s.toUpperCase();
    if (/^\d+$/.test(s)) return `AS${s}`;
    return s;
  }

  function isHostingBlob(blob) {
    const b = String(blob || "");
    return HOSTING_RE.some((re) => re.test(b));
  }

  async function quorumCheck() {
    const sources = [];
    const tasks = [
      (async () => {
        try {
          const d = await getJson("https://ipwho.is/");
          sources.push({
            name: "ipwho.is",
            ip: normalizeIp(d.ip),
            country: normalizeCc(d.country_code),
            asn: formatAsn(d.connection?.asn),
            isp: d.connection?.isp || d.connection?.org || "",
            org: d.connection?.org || "",
            city: d.city || "",
            timezone: d.timezone?.id || "",
            ok: !!d.ip,
          });
        } catch (e) {
          sources.push({ name: "ipwho.is", ok: false, error: e.message || String(e) });
        }
      })(),
      (async () => {
        try {
          const d = await getJson("https://ipapi.co/json/");
          sources.push({
            name: "ipapi.co",
            ip: normalizeIp(d.ip),
            country: normalizeCc(d.country_code || d.country),
            asn: formatAsn(d.asn),
            isp: d.org || d.org_name || "",
            org: d.org || "",
            city: d.city || "",
            timezone: d.timezone || "",
            ok: !!d.ip && !d.error,
          });
        } catch (e) {
          sources.push({ name: "ipapi.co", ok: false, error: e.message || String(e) });
        }
      })(),
      (async () => {
        try {
          const d = await getJson("https://api.ipify.org?format=json");
          sources.push({
            name: "ipify.org",
            ip: normalizeIp(d.ip),
            country: "",
            ok: !!d.ip,
          });
        } catch (e) {
          sources.push({ name: "ipify.org", ok: false, error: e.message || String(e) });
        }
      })(),
      (async () => {
        const urls = [
          "https://www.cloudflare.com/cdn-cgi/trace",
          "https://1.1.1.1/cdn-cgi/trace",
        ];
        let lastErr = "unavailable";
        for (const u of urls) {
          try {
            const text = await getText(u);
            const t = parseCfTrace(text);
            sources.push({
              name: "cloudflare/trace",
              ip: normalizeIp(t.ip),
              country: normalizeCc(t.loc),
              ok: !!t.ip,
            });
            return;
          } catch (e) {
            lastErr = e.message || String(e);
          }
        }
        sources.push({ name: "cloudflare/trace", ok: false, error: lastErr });
      })(),
    ];
    await Promise.all(tasks);

    const ok = sources.filter((s) => s.ok && s.ip);
    const ips = [...new Set(ok.map((s) => s.ip))];
    const countries = [...new Set(ok.map((s) => s.country).filter(Boolean))];
    let delta = 0;
    const notes = [];

    // Штраф только при реальном расхождении ≥2 успешных источников
    if (ok.length >= 2 && (ips.length > 1 || countries.length > 1)) {
      delta = -50;
      notes.push(
        `Расхождение маршрута: IP=[${ips.join(" | ")}] страны=[${countries.join(" | ")}]`
      );
      ok.forEach((s) => {
        notes.push(
          `· ${s.name}: IP ${s.ip || "—"}${s.country ? `, страна ${s.country}` : ""}`
        );
      });
    } else if (ok.length < 2) {
      notes.push("Недостаточно источников для кворума (≥2 успешных ответа)");
      ok.forEach((s) => {
        notes.push(`· ${s.name}: IP ${s.ip || "—"}${s.country ? `, ${s.country}` : ""}`);
      });
      sources
        .filter((s) => !s.ok)
        .forEach((s) => notes.push(`· ${s.name}: ошибка (${s.error || "—"})`));
    } else {
      notes.push(`Кворум OK: ${ok[0].ip}${ok[0].country ? ` / ${ok[0].country}` : ""}`);
      ok.forEach((s) => {
        notes.push(
          `· ${s.name}: IP ${s.ip || "—"}${s.country ? `, страна ${s.country}` : ""}`
        );
      });
    }

    const primary =
      ok.find((s) => s.name === "ipwho.is") ||
      ok.find((s) => s.name === "ipapi.co") ||
      ok[0] ||
      null;

    return { sources, ok, ips, countries, delta, notes, primary };
  }

  function geoFilter(quorum) {
    const cc = quorum.countries[0] || quorum.primary?.country || "";
    const blocked = BLOCKED.has(cc);
    if (blocked) {
      return {
        country: cc,
        blocked: true,
        forceZero: true,
        delta: 0,
        notes: [`⛔ ВХОД ЗАПРЕЩЁН: регион ${cc} заблокирован в Claude`],
      };
    }
    if (!cc) {
      return {
        country: "—",
        blocked: false,
        forceZero: false,
        delta: 0,
        notes: ["Страна IP не определена — базовые +50 не начислены"],
      };
    }
    return {
      country: cc,
      blocked: false,
      forceZero: false,
      delta: 50,
      notes: [`Страна ${cc} поддерживается Claude · +50`],
    };
  }

  function asnAnalysis(quorum) {
    const asn =
      formatAsn(quorum.ok.map((s) => s.asn).find(Boolean)) ||
      formatAsn(quorum.primary?.asn) ||
      "AS?—неизвестно";
    const isp =
      quorum.ok.map((s) => s.isp || s.org).find(Boolean) ||
      quorum.primary?.isp ||
      "неизвестно";
    const city =
      quorum.ok.map((s) => s.city).find(Boolean) ||
      quorum.primary?.city ||
      "—";
    const blob = quorum.ok
      .map((s) => `${s.asn || ""} ${s.isp || ""} ${s.org || ""}`)
      .join(" ");

    const hosting = isHostingBlob(blob);
    if (hosting) {
      return {
        asn,
        isp,
        city,
        delta: -30,
        notes: [
          `ASN: ${asn}`,
          `Провайдер: ${isp}`,
          `Город: ${city}`,
          "⚠️ Облачный хостинг / дата-центр · −30",
        ],
      };
    }
    return {
      asn,
      isp,
      city,
      delta: 30,
      notes: [
        `ASN: ${asn}`,
        `Провайдер: ${isp}`,
        `Город: ${city}`,
        "✅ Чистый ISP / Static Residential · +30",
      ],
    };
  }

  function parseIceCandidate(cand) {
    const parts = String(cand || "").split(" ");
    if (parts.length < 5) return null;
    return { ip: parts[4], raw: cand };
  }

  function isPrivateOrLocal(ip) {
    if (!ip) return true;
    if (ip.endsWith(".local")) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (/^(fc|fd)/i.test(ip)) return true;
    if (ip === "::1" || ip.startsWith("127.")) return true;
    if (ip === "0.0.0.0") return true;
    return false;
  }

  function isIpLike(ip) {
    return (
      /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || (ip.includes(":") && !ip.includes(" "))
    );
  }

  function webrtcGather() {
    return new Promise((resolve) => {
      const found = [];
      let pc;
      try {
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
          ],
        });
      } catch (e) {
        resolve({ public: [], local: [], error: e.message || String(e) });
        return;
      }

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        try {
          pc.close();
        } catch (_) {
          /* ignore */
        }
        const publicIps = [];
        const localIps = [];
        found.forEach((f) => {
          if (!isIpLike(f.ip)) return;
          if (isPrivateOrLocal(f.ip)) localIps.push(f.ip);
          else publicIps.push(f.ip);
        });
        resolve({
          public: [...new Set(publicIps)],
          local: [...new Set(localIps)],
        });
      };

      const timer = setTimeout(done, WEBRTC_MS);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !ev.candidate.candidate) {
          if (ev.candidate === null) {
            clearTimeout(timer);
            done();
          }
          return;
        }
        const parsed = parseIceCandidate(ev.candidate.candidate);
        if (parsed) found.push(parsed);
      };
      pc.createDataChannel("shield");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          done();
        });
    });
  }

  function scoreWebrtc(ice, quorumIp) {
    if (ice.error) {
      return {
        public: [],
        local: [],
        delta: 0,
        notes: [`WebRTC недоступен: ${ice.error}`],
      };
    }
    const uniqPub = ice.public || [];
    const uniqLoc = ice.local || [];
    const notes = [];
    const leak = uniqPub.filter(
      (ip) => normalizeIp(ip) !== normalizeIp(quorumIp)
    );
    let delta = 0;
    if (leak.length) {
      delta = -35;
      notes.push(
        `Посторонний публичный IP: ${leak.join(", ")} (кворум ${quorumIp || "—"}) · −35`
      );
    } else if (uniqPub.length) {
      notes.push(`Публичные ICE совпадают с кворумом: ${uniqPub.join(", ")}`);
    } else {
      notes.push("Посторонних публичных IP не найдено");
    }
    if (uniqLoc.length) {
      notes.push(`Локальные (.local / RFC1918) — без штрафа: ${uniqLoc.join(", ")}`);
    }
    return { public: uniqPub, local: uniqLoc, delta, notes };
  }

  function timezoneCheck(quorum) {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
    const cc = quorum.countries[0] || quorum.primary?.country || "";
    const notes = [];
    let delta = 0;
    // Мягкий штраф только: IP США + системный TZ Китай
    if (cc === "US" && browserTz === "Asia/Shanghai") {
      delta = -10;
      notes.push(
        `IP: США, браузер: Asia/Shanghai — переключите часовой пояс в профиле браузера · −10`
      );
    } else {
      notes.push(`Браузер: ${browserTz}, страна IP: ${cc || "—"} — OK`);
    }
    return { browserTz, delta, notes };
  }

  async function rttCheck() {
    const url = "https://www.cloudflare.com/cdn-cgi/trace";
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await fetchTimeout(`${url}?t=${Date.now()}-${i}`, 5000);
        samples.push(performance.now() - t0);
      } catch (_) {
        try {
          await fetchTimeout(`https://1.1.1.1/cdn-cgi/trace?t=${Date.now()}-${i}`, 5000);
          samples.push(performance.now() - t0);
        } catch (_) {
          samples.push(null);
        }
      }
    }
    const ok = samples.filter((x) => x != null);
    if (!ok.length) {
      return { avg: null, delta: 0, notes: ["Не удалось замерить пинг"] };
    }
    const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
    return {
      avg,
      delta: 0,
      notes: [
        `Средний пинг: ${avg.toFixed(0)} мс`,
        `Замеры: ${ok.map((x) => `${x.toFixed(0)} мс`).join(", ")}`,
      ],
    };
  }

  function scoreClass(score) {
    if (score <= 49) return "bad";
    if (score <= 74) return "mid";
    return "good";
  }

  function scoreLabel(score) {
    if (score <= 49) return "🔴 Опасно";
    if (score <= 74) return "🟡 Есть риски";
    return "🟢 Эталонная чистота";
  }

  function formatDelta(d) {
    if (d > 0) return `+${d}`;
    if (d < 0) return `${d}`;
    return "0";
  }

  function render(result) {
    const root = document.getElementById("shield-root");
    if (!root || !result) return;
    const { score, parts } = result;
    const cls = scoreClass(score);

    const rows = [
      {
        title: "1. Кворум IP (4 источника)",
        detail: parts.quorum.notes.map(esc).join("<br>"),
        delta: parts.quorum.delta,
      },
      {
        title: "2. Гео-фильтр Claude",
        detail: parts.geo.notes.map(esc).join("<br>"),
        delta: parts.geo.forceZero ? "0/100" : parts.geo.delta,
      },
      {
        title: "3. ASN / провайдер",
        detail: parts.asn.notes.map(esc).join("<br>"),
        delta: parts.asn.delta,
      },
      {
        title: "4. WebRTC",
        detail: parts.webrtc.notes.map(esc).join("<br>"),
        delta: parts.webrtc.delta,
      },
      {
        title: "5. Часовой пояс",
        detail: parts.tz.notes.map(esc).join("<br>"),
        delta: parts.tz.delta,
      },
      {
        title: "6. Пинг",
        detail: parts.rtt.notes.map(esc).join("<br>"),
        delta: parts.rtt.delta,
      },
    ];

    const banner = parts.geo.forceZero
      ? `<div class="shield-banner danger">⛔ ВХОД ЗАПРЕЩЁН: регион заблокирован в Claude</div>`
      : "";

    root.innerHTML = `
      ${banner}
      <div class="shield-score ${cls}">
        <div class="shield-score-label">Claude Trust Score</div>
        <div class="shield-score-value">${score} / 100</div>
        <div class="shield-score-tag">${scoreLabel(score)}</div>
      </div>
      <div class="shield-table">
        ${rows
          .map(
            (r) => `
          <div class="shield-row">
            <div class="shield-row-title">${esc(r.title)}</div>
            <div class="shield-row-pen">${
              typeof r.delta === "number" ? esc(formatDelta(r.delta)) : esc(r.delta)
            }</div>
            <div class="shield-row-body">${r.detail}</div>
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  async function runAudit() {
    if (running) return;
    running = true;
    const status = document.getElementById("shield-status");
    const btn = document.getElementById("btn-shield-run");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Идёт проверка (6 уровней)…";

    try {
      const [quorum, ice, rtt] = await Promise.all([
        quorumCheck(),
        webrtcGather(),
        rttCheck(),
      ]);
      const geo = geoFilter(quorum);
      const asn = asnAnalysis(quorum);
      const webrtc = scoreWebrtc(ice, quorum.ips[0] || quorum.primary?.ip || "");
      const tz = timezoneCheck(quorum);

      let score = 0;
      score += geo.delta;
      score += asn.delta;
      score += quorum.delta;
      score += webrtc.delta;
      score += tz.delta;
      // rtt: без влияния на балл
      if (geo.forceZero) score = 0;
      score = Math.max(0, Math.min(100, score));

      render({
        score,
        parts: { quorum, geo, asn, webrtc, tz, rtt },
      });
      if (status) status.textContent = `Готово · ${new Date().toLocaleTimeString("ru-RU")}`;
    } catch (e) {
      if (status) status.textContent = `Ошибка: ${e.message || e}`;
      const root = document.getElementById("shield-root");
      if (root) {
        root.innerHTML = `<div class="empty">Сбой проверки: ${esc(e.message || e)}</div>`;
      }
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  function setAegisStatus(text) {
    const el = document.getElementById("aegis-status");
    if (el) el.textContent = text || "";
  }

  function saveAegisTopicFromInput() {
    const input = document.getElementById("aegis-cmd-topic");
    if (!input || !window.CC) return;
    window.CC.setAegisCmdTopic(input.value.trim());
    input.value = window.CC.getAegisCmdTopic();
    try {
      window.CC.persistLocal();
    } catch (_) {
      /* vault may be locked — localStorage уже обновлён */
    }
  }

  async function sendAegis(cmd, btn) {
    if (!window.CC || typeof window.CC.sendAegisCommand !== "function") {
      setAegisStatus("Ошибка: state.js не загружен");
      return;
    }
    saveAegisTopicFromInput();
    const buttons = document.querySelectorAll("[data-aegis-cmd]");
    buttons.forEach((b) => {
      b.disabled = true;
    });
    if (btn) btn.classList.add("is-sending");
    setAegisStatus("Отправка…");
    try {
      const r = await window.CC.sendAegisCommand(cmd);
      if (r.ok) {
        setAegisStatus("Команда отправлена на ПК — ждите отчёт в ntfy");
      } else if (r.reason === "no-topic") {
        setAegisStatus("Укажите секретный канал команд");
      } else {
        setAegisStatus(`Ошибка отправки: ${r.reason || "сеть"}`);
      }
    } catch (e) {
      setAegisStatus(`Ошибка: ${e.message || e}`);
    } finally {
      buttons.forEach((b) => {
        b.disabled = false;
      });
      if (btn) btn.classList.remove("is-sending");
    }
  }

  function fillAegisTopic() {
    const input = document.getElementById("aegis-cmd-topic");
    if (input && window.CC) input.value = window.CC.getAegisCmdTopic();
  }

  function bootAegis() {
    const input = document.getElementById("aegis-cmd-topic");
    fillAegisTopic();
    if (input) {
      input.addEventListener("change", saveAegisTopicFromInput);
      input.addEventListener("blur", saveAegisTopicFromInput);
    }
    document.querySelectorAll("[data-aegis-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => sendAegis(btn.getAttribute("data-aegis-cmd"), btn));
    });
    if (window.CC && typeof window.CC.onAuth === "function") {
      window.CC.onAuth(() => fillAegisTopic());
    }
  }

  function boot() {
    const btn = document.getElementById("btn-shield-run");
    if (btn) btn.addEventListener("click", () => runAudit());
    bootAegis();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
