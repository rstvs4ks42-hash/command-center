/**
 * IP-Щит — 7-уровневый сканер чистоты соединения.
 * Автономный модуль: не меняет state.js / notify.py / логику других вкладок.
 */
(() => {
  const BLOCKED = new Set(["CN", "HK", "MO", "RU", "BY", "IR", "KP"]);
  const DC_KEYS = [
    "amazon", "aws", "google", "digitalocean", "vultr", "ovh", "hetzner", "linode",
    "akamai", "microsoft", "azure", "alibaba", "tencent", "oracle", "cloudflare",
    "m247", "leaseweb", "datacamp", "choopa", "contabo", "scaleway", "hostinger",
    "gcore", "zenlayer", "hosting", "datacenter", "data center", "vps", "cloud",
  ];
  const RES_KEYS = [
    "at&t", "att", "comcast", "verizon", "charter", "spectrum", "cox", "frontier",
    "centurylink", "t-mobile", "tmobile", "altice", "optimum", "residential",
    "isp", "telecom", "broadband", "cable", "fiber",
  ];

  const TIMEOUT_MS = 5000;
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
    return fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" })
      .finally(() => clearTimeout(t));
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
            asn: d.connection?.asn ? `AS${d.connection.asn}` : "",
            isp: d.connection?.isp || d.connection?.org || "",
            org: d.connection?.org || "",
            utc_offset: d.timezone?.utc || d.timezone?.offset || "",
            timezone: d.timezone?.id || "",
            raw: d,
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
            asn: d.asn || "",
            isp: d.org || d.org_name || "",
            org: d.org || "",
            utc_offset: d.utc_offset || "",
            timezone: d.timezone || "",
            raw: d,
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
          "https://cloudflare.com/cdn-cgi/trace",
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
              timezone: t.colo || "",
              ok: !!t.ip,
              raw: t,
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
    let penalty = 0;
    const notes = [];
    if (ips.length > 1 || countries.length > 1) {
      penalty = 50;
      notes.push(
        `Расхождение маршрута: IP=[${ips.join(" | ")}] страны=[${countries.join(" | ")}]`
      );
      ok.forEach((s) => {
        notes.push(`· ${s.name}: IP ${s.ip || "—"}${s.country ? `, страна ${s.country}` : ""}`);
      });
    } else if (ok.length < 2) {
      notes.push("Недостаточно источников для кворума (нужно ≥2 успешных ответа)");
    } else {
      notes.push(`Кворум OK: ${ok[0].ip}${ok[0].country ? ` / ${ok[0].country}` : ""}`);
    }

    const primary =
      ok.find((s) => s.name === "ipwho.is") ||
      ok.find((s) => s.name === "ipapi.co") ||
      ok[0] ||
      null;

    return { sources, ok, ips, countries, penalty, notes, primary };
  }

  function geoFilter(quorum) {
    const cc = quorum.countries[0] || quorum.primary?.country || "";
    const blocked = BLOCKED.has(cc);
    return {
      country: cc || "—",
      blocked,
      penalty: blocked ? 100 : 0, // force zero handled later
      forceZero: blocked,
      notes: blocked
        ? [`⛔ Регион ${cc} в чёрном списке Anthropic Claude`]
        : [`Страна IP: ${cc || "не определена"} — не в чёрном списке`],
    };
  }

  function asnAnalysis(quorum) {
    const blob = quorum.ok
      .map((s) => `${s.asn || ""} ${s.isp || ""} ${s.org || ""}`)
      .join(" ")
      .toLowerCase();
    const asn =
      quorum.ok.map((s) => s.asn).find((a) => a) ||
      quorum.primary?.asn ||
      "AS?—неизвестно";
    const isp =
      quorum.ok.map((s) => s.isp || s.org).find((x) => x) || "неизвестно";

    const isDc = DC_KEYS.some((k) => blob.includes(k));
    const isRes = RES_KEYS.some((k) => blob.includes(k));
    let verdict = "⚠️ Не удалось уверенно классифицировать провайдера";
    let penalty = 15;
    if (isDc && !isRes) {
      verdict = "⚠️ Дата-центр / Хостинг (Высокий риск бана)";
      penalty = 35;
    } else if (isRes && !isDc) {
      verdict = "✅ Домашний провайдер (ISP / Residential)";
      penalty = 0;
    } else if (isRes && isDc) {
      verdict = "🟡 Смешанные признаки ISP + hosting — проверьте вручную";
      penalty = 20;
    }
    return {
      asn,
      isp,
      verdict,
      penalty,
      notes: [`ASN: ${asn}`, `ISP/ORG: ${isp}`, verdict],
    };
  }

  function parseIceCandidate(cand) {
    // candidate: foundation component protocol priority ip port typ ...
    const parts = String(cand || "").split(" ");
    if (parts.length < 5) return null;
    const ip = parts[4];
    const typIdx = parts.indexOf("typ");
    const typ = typIdx >= 0 ? parts[typIdx + 1] : "";
    return { ip, typ, raw: cand };
  }

  function isPrivateIp(ip) {
    if (!ip) return false;
    if (ip.endsWith(".local")) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (/^fc|fd/i.test(ip)) return true; // ULA IPv6
    if (ip === "::1" || ip.startsWith("127.")) return true;
    return false;
  }

  function isIpLike(ip) {
    return (
      /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ||
      (ip.includes(":") && !ip.includes(" "))
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
        resolve({ public: [], local: [], all: [], error: e.message || String(e) });
        return;
      }

      const done = () => {
        try {
          pc.close();
        } catch (_) {
          /* ignore */
        }
        const publicIps = [];
        const localIps = [];
        found.forEach((f) => {
          if (!isIpLike(f.ip)) return;
          if (isPrivateIp(f.ip)) localIps.push(f.ip);
          else publicIps.push(f.ip);
        });
        resolve({
          public: [...new Set(publicIps)],
          local: [...new Set(localIps)],
          all: found,
        });
      };

      const timer = setTimeout(done, 3000);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !ev.candidate.candidate) return;
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
        all: [],
        penalty: 0,
        notes: [`WebRTC недоступен: ${ice.error}`],
      };
    }
    const uniqPub = ice.public || [];
    const uniqLoc = ice.local || [];
    let penalty = 0;
    const notes = [];
    const leak = uniqPub.filter((ip) => normalizeIp(ip) !== normalizeIp(quorumIp));
    if (leak.length) {
      penalty += 40;
      notes.push(`Критическая утечка WebRTC: ${leak.join(", ")} (кворум ${quorumIp || "—"})`);
    } else if (uniqPub.length) {
      notes.push(`Публичные ICE совпадают с кворумом: ${uniqPub.join(", ")}`);
    } else {
      notes.push("Публичных ICE-адресов не обнаружено");
    }
    if (uniqLoc.length) {
      penalty += 10;
      notes.push(`Локальные/незамаскированные адреса: ${uniqLoc.join(", ")}`);
    }
    return { public: uniqPub, local: uniqLoc, all: ice.all || [], penalty, notes };
  }

  function timezoneCheck(quorum) {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
    const browserOffsetMin = -new Date().getTimezoneOffset(); // minutes east of UTC
    let ipOffsetMin = null;
    const offStr =
      quorum.primary?.utc_offset ||
      quorum.ok.map((s) => s.utc_offset).find(Boolean) ||
      "";
    // formats: +0800, +08:00, 8, -5
    const m = String(offStr).match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      ipOffsetMin = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
    }
    const ipTz = quorum.primary?.timezone || quorum.ok.map((s) => s.timezone).find(Boolean) || "—";
    let penalty = 0;
    const notes = [];
    if (ipOffsetMin == null) {
      notes.push(
        `Браузер: ${browserTz} (UTC${browserOffsetMin >= 0 ? "+" : ""}${browserOffsetMin / 60}), IP timezone: ${ipTz} (utc_offset неизвестен)`
      );
    } else {
      const diff = Math.abs(browserOffsetMin - ipOffsetMin);
      const brH = browserOffsetMin / 60;
      const ipH = ipOffsetMin / 60;
      notes.push(
        `Браузер: UTC${brH >= 0 ? "+" : ""}${brH} (${browserTz}), IP: UTC${ipH >= 0 ? "+" : ""}${ipH} (${ipTz}) — расхождение ${Math.round(diff / 60)} ч (${diff} мин)`
      );
      if (diff > 60) penalty = 20;
    }
    return { browserTz, browserOffsetMin, ipTz, ipOffsetMin, penalty, notes };
  }

  function localeCheck(quorumCountry) {
    const webdriver = !!navigator.webdriver;
    const langs = [...(navigator.languages || [navigator.language || ""])];
    const hw = navigator.hardwareConcurrency || "?";
    const mem = navigator.deviceMemory || "?";
    let penalty = 0;
    const notes = [];
    if (webdriver) {
      penalty += 30;
      notes.push("navigator.webdriver = true (признак автоматизации)");
    } else {
      notes.push("navigator.webdriver = false");
    }
    notes.push(`languages: ${langs.join(", ") || "—"}`);
    const onlyZhOrRu =
      langs.length > 0 &&
      langs.every((l) => /^zh/i.test(l) || /^ru/i.test(l)) &&
      !langs.some((l) => /^en/i.test(l));
    if (quorumCountry === "US" && onlyZhOrRu) {
      penalty += 10;
      notes.push("Языки только zh/ru без en-US при американском IP (−10)");
    }
    notes.push(`hardwareConcurrency=${hw}, deviceMemory=${mem}`);
    return { webdriver, langs, hw, mem, penalty, notes };
  }

  async function rttCheck() {
    const url = "https://www.cloudflare.com/cdn-cgi/trace";
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await fetchTimeout(url + `?t=${Date.now()}-${i}`, 5000, { method: "GET" });
        samples.push(performance.now() - t0);
      } catch (_) {
        try {
          await fetchTimeout(`https://1.1.1.1/cdn-cgi/trace?t=${Date.now()}-${i}`, 5000);
          samples.push(performance.now() - t0);
        } catch (e2) {
          samples.push(null);
        }
      }
    }
    const ok = samples.filter((x) => x != null);
    if (!ok.length) {
      return { avg: null, jitter: null, samples, penalty: 5, notes: ["Не удалось замерить RTT"] };
    }
    const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
    const jitter =
      ok.length > 1
        ? Math.max(...ok) - Math.min(...ok)
        : 0;
    return {
      avg,
      jitter,
      samples: ok,
      penalty: avg > 400 ? 10 : avg > 200 ? 5 : 0,
      notes: [
        `Средний RTT: ${avg.toFixed(0)} мс`,
        `Джиттер: ${jitter.toFixed(0)} мс`,
        `Замеры: ${ok.map((x) => x.toFixed(0) + "мс").join(", ")}`,
      ],
    };
  }

  function scoreClass(score) {
    if (score <= 49) return "bad";
    if (score <= 79) return "mid";
    return "good";
  }

  function scoreLabel(score) {
    if (score <= 49) return "🔴 Опасно";
    if (score <= 79) return "🟡 Есть риски";
    return "🟢 Эталонная чистота";
  }

  function buildFixes(parts, score) {
    if (score >= 85) return [];
    const fixes = [];
    if (parts.geo.forceZero) {
      fixes.push("Смените выход прокси/VPN на разрешённую страну (напр. US) — текущий регион блокирует Claude.");
    }
    if (parts.quorum.penalty) {
      fixes.push("Отключите Split-Tunneling: весь трафик браузера должен идти через один выходной IP.");
    }
    if (parts.asn.penalty) {
      fixes.push("Используйте резидентский Static IP (ISP), не дата-центр / VPS hosting.");
    }
    if (parts.webrtc.penalty >= 40) {
      fixes.push("Отключите WebRTC в браузере / расширении VPN (утечка реального IP).");
    } else if (parts.webrtc.penalty >= 10) {
      fixes.push("Скройте локальные ICE-адреса (WebRTC leak shield).");
    }
    if (parts.tz.penalty) {
      fixes.push("Выровняйте часовой пояс системы/браузера под страну IP.");
    }
    if (parts.locale.webdriver) {
      fixes.push("Отключите automation / webdriver флаги (не используйте управляемый ChromeDriver).");
    }
    if (parts.locale.penalty >= 10 && !parts.locale.webdriver) {
      fixes.push("Добавьте en-US в языки браузера (navigator.languages) при US IP.");
    }
    if (parts.rtt.penalty) {
      fixes.push("Проверьте стабильность канала: высокий RTT/джиттер может палиться антифродом.");
    }
    if (!fixes.length) fixes.push("Перепроверьте VPN/прокси и повторите аудит.");
    return fixes;
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
        penalty: parts.quorum.penalty,
      },
      {
        title: "2. Гео-фильтр Claude",
        detail: parts.geo.notes.map(esc).join("<br>"),
        penalty: parts.geo.forceZero ? "FORCE 0" : parts.geo.penalty,
      },
      {
        title: "3. ASN / ISP",
        detail: parts.asn.notes.map(esc).join("<br>"),
        penalty: parts.asn.penalty,
      },
      {
        title: "4. WebRTC",
        detail: parts.webrtc.notes.map(esc).join("<br>") +
          (parts.webrtc.public.length
            ? `<br>Public: ${esc(parts.webrtc.public.join(", "))}`
            : "") +
          (parts.webrtc.local.length
            ? `<br>Local: ${esc(parts.webrtc.local.join(", "))}`
            : ""),
        penalty: parts.webrtc.penalty,
      },
      {
        title: "5. Часовой пояс",
        detail: parts.tz.notes.map(esc).join("<br>"),
        penalty: parts.tz.penalty,
      },
      {
        title: "6. Locale & Automation",
        detail: parts.locale.notes.map(esc).join("<br>"),
        penalty: parts.locale.penalty,
      },
      {
        title: "7. RTT / джиттер",
        detail: parts.rtt.notes.map(esc).join("<br>"),
        penalty: parts.rtt.penalty,
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
            <div class="shield-row-body">${r.detail}</div>
            <div class="shield-row-pen">−${esc(r.penalty)}</div>
          </div>`
          )
          .join("")}
      </div>
      ${
        result.fixes.length
          ? `<div class="block" style="margin-top:12px">
        <h3 style="margin:0 0 8px;font-size:14px">Что исправить прямо сейчас</h3>
        <ul class="shield-fixes">
          ${result.fixes.map((f) => `<li>${esc(f)}</li>`).join("")}
        </ul>
      </div>`
          : ""
      }
    `;
  }

  async function runAudit() {
    if (running) return;
    running = true;
    const status = document.getElementById("shield-status");
    const btn = document.getElementById("btn-shield-run");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Идёт глубокий аудит (7 проверок)…";

    try {
      // Параллельно: кворум IP, WebRTC ICE, RTT; остальное — мгновенный анализ по результатам
      const [quorum, ice, rtt] = await Promise.all([
        quorumCheck(),
        webrtcGather(),
        rttCheck(),
      ]);
      const geo = geoFilter(quorum);
      const asn = asnAnalysis(quorum);
      const webrtc = scoreWebrtc(ice, quorum.ips[0] || quorum.primary?.ip || "");
      const tz = timezoneCheck(quorum);
      const locale = localeCheck(quorum.countries[0] || quorum.primary?.country || "");

      let score = 100;
      score -= quorum.penalty;
      score -= asn.penalty;
      score -= webrtc.penalty;
      score -= tz.penalty;
      score -= locale.penalty;
      score -= rtt.penalty;
      if (geo.forceZero) score = 0;
      score = Math.max(0, Math.min(100, score));

      const parts = { quorum, geo, asn, webrtc, tz, locale, rtt };
      const fixes = buildFixes(parts, score);
      render({ score, parts, fixes });
      if (status) status.textContent = `Готово · ${new Date().toLocaleTimeString("ru-RU")}`;
    } catch (e) {
      if (status) status.textContent = `Ошибка аудита: ${e.message || e}`;
      const root = document.getElementById("shield-root");
      if (root) {
        root.innerHTML = `<div class="empty">Сбой аудита: ${esc(e.message || e)}</div>`;
      }
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  function boot() {
    const btn = document.getElementById("btn-shield-run");
    if (btn) btn.addEventListener("click", () => runAudit());

    document.querySelectorAll(".tab-btn").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab === "shield") runAudit();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
