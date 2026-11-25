(() => {
  const {
    STAGES,
    STAGE_CHECK,
    BUDGET_CATEGORIES,
    WEEKDAY_KEYS,
    WEEKDAY_LABELS,
    uid,
    todayISO,
    daysUntil,
    scheduleNtfyReminder,
    weekdayKeyFromISO,
    normalizeTimeHHMM,
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
    getGithubCreds,
    setGithubCreds,
    getNtfyTopic,
    setNtfyTopic,
    sendNtfyTestPush,
    pushToGithub,
    pullFromGithub,
    onSyncStatus,
    onChange,
    onAuth,
    convertAmount,
  } = window.CC;

  let focusTimer = null;
  let focusLeftSec = 0;
  let focusTotalSec = 0;
  let focusWidgetTick = null;
  let promptQuery = "";
  let selectedWeekDay = null;
  let weekEditorOpen = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let calMonth = null; // Date at month start
  let selectedCalDay = null;
  let editingVideoId = null;
  let editingEventId = null;
  let editingSubId = null;

  const EVENT_COLORS = [
    { id: "blue", label: "Синий", hex: "#5b8cff" },
    { id: "green", label: "Зелёный", hex: "#3ecf8e" },
    { id: "amber", label: "Янтарный", hex: "#f5a524" },
    { id: "red", label: "Красный", hex: "#ff6b6b" },
    { id: "violet", label: "Фиолетовый", hex: "#a78bfa" },
  ];

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatMoney(n, currency) {
    const v = Number(n) || 0;
    const sym = currency === "CNY" ? "¥" : "$";
    return `${sym}${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;
  }

  /* -------- Tabs -------- */
  function initTabs() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.remove("active"));
        $$(".panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $(`#panel-${btn.dataset.tab}`).classList.add("active");
      });
    });
  }

  /* -------- Sync pill -------- */
  function initSyncPill() {
    onSyncStatus((s) => {
      const pill = $("#sync-pill");
      const label = $("#sync-label");
      pill.classList.remove("ok", "pending", "error");
      if (s === "ok") {
        pill.classList.add("ok");
        label.textContent = "Синхронизировано с GitHub";
      } else if (s === "pending") {
        pill.classList.add("pending");
        label.textContent = "Синхронизация…";
      } else if (s === "error") {
        pill.classList.add("error");
        label.textContent = "Ошибка синхронизации";
      } else {
        label.textContent = "Локально (нет PAT)";
      }
    });
  }

  /* ===================== YOUTUBE ===================== */
  function renderYoutube() {
    const s = getState();
    const m = s.monetization;
    const subGoal = m.subscribersGoal || 1000;
    const hoursGoal = m.watchHoursGoal || 4000;
    const subPct = Math.min(100, (m.subscribers / subGoal) * 100);
    const hoursPct = Math.min(100, (m.watchHours / hoursGoal) * 100);
    const subLeft = Math.max(0, subGoal - m.subscribers);
    const hoursLeft = Math.max(0, hoursGoal - m.watchHours);

    const monoChip = $("#panel-youtube .block-head .chip");
    if (monoChip) {
      monoChip.textContent = `${subGoal.toLocaleString("ru-RU")} / ${hoursGoal.toLocaleString("ru-RU")}`;
    }

    $("#thermo").innerHTML = `
      <div class="thermo">
        <div class="thermo-row">
          <div class="thermo-meta">
            <span>Подписчики</span>
            <strong>${m.subscribers.toLocaleString("ru-RU")} / ${subGoal.toLocaleString("ru-RU")}</strong>
          </div>
          <div class="bar"><i style="width:${subPct}%"></i></div>
          <div class="muted">Осталось ${subLeft.toLocaleString("ru-RU")} до цели ${subGoal.toLocaleString("ru-RU")}</div>
        </div>
        <div class="thermo-row">
          <div class="thermo-meta">
            <span>Часы просмотра</span>
            <strong>${m.watchHours.toLocaleString("ru-RU")} / ${hoursGoal.toLocaleString("ru-RU")}</strong>
          </div>
          <div class="bar"><i style="width:${hoursPct}%"></i></div>
          <div class="muted">Осталось ${hoursLeft.toLocaleString("ru-RU")} ч до цели ${hoursGoal.toLocaleString("ru-RU")}</div>
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Текущие подписчики</label>
            <input type="number" id="inp-subs" min="0" value="${m.subscribers}">
          </div>
          <div class="field">
            <label>Цель подписчиков</label>
            <input type="number" id="inp-subs-goal" min="1" value="${subGoal}">
          </div>
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Часы просмотра</label>
            <input type="number" id="inp-hours" min="0" step="0.1" value="${m.watchHours}">
          </div>
          <div class="field">
            <label>Цель часов</label>
            <input type="number" id="inp-hours-goal" min="1" step="0.1" value="${hoursGoal}">
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" id="btn-save-mono">Сохранить прогресс</button>
        </div>
      </div>
    `;

    $("#btn-save-mono").onclick = () => {
      updateState((st) => {
        st.monetization.subscribers = Number($("#inp-subs").value) || 0;
        st.monetization.watchHours = Number($("#inp-hours").value) || 0;
        st.monetization.subscribersGoal = Math.max(1, Number($("#inp-subs-goal").value) || 1000);
        st.monetization.watchHoursGoal = Math.max(1, Number($("#inp-hours-goal").value) || 4000);
      });
      toast("Прогресс монетизации сохранён");
    };

    renderKanban();
    renderCalendar();
  }

  function renderKanban() {
    const s = getState();
    const root = $("#kanban");
    root.innerHTML = STAGES.map((stage) => {
      const cards = s.videos.filter((v) => v.stage === stage.id);
      return `
        <div class="kanban-col" data-stage="${stage.id}">
          <h4>${esc(stage.label)} <em>${cards.length}</em></h4>
          <div class="kanban-drop" data-stage="${stage.id}">
            ${cards.map(videoCardHtml).join("") || `<div class="empty">Пусто</div>`}
          </div>
        </div>
      `;
    }).join("");

    $$(".card", root).forEach((card) => {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", card.dataset.id);
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("click", (e) => {
        if (e.target.closest("button, label, input")) return;
        openVideoModal(card.dataset.id);
      });
    });
    $$("[data-advance]", root).forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        updateState((st) => {
          const v = st.videos.find((x) => x.id === btn.dataset.advance);
          if (!v) return;
          v.stage = nextStageId(v.stage);
          const key = STAGE_CHECK[v.stage];
          if (key && v.checklist) v.checklist[key] = true;
        });
        toast("Этап сдвинут");
      };
    });
    $$("[data-to-plan]", root).forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const v = getState().videos.find((x) => x.id === btn.dataset.toPlan);
        if (!v) return;
        updateState((st) => {
          if (!st.dailyTasks) st.dailyTasks = [];
          st.dailyTasks.push({
            id: uid("dt"),
            title: `YouTube: ${v.title}`,
            date: todayISO(),
            time: null,
            priority: "high",
            done: false,
          });
        });
        toast("Добавлено в план на сегодня");
      };
    });

    $$(".kanban-drop", root).forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.style.outline = "1px dashed rgba(91,140,255,.5)";
      });
      zone.addEventListener("dragleave", () => {
        zone.style.outline = "";
      });
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.style.outline = "";
        const id = e.dataTransfer.getData("text/plain");
        const stage = zone.dataset.stage;
        updateState((st) => {
          const v = st.videos.find((x) => x.id === id);
          if (!v) return;
          v.stage = stage;
          const key = STAGE_CHECK[stage];
          if (key && v.checklist) v.checklist[key] = true;
          if (stage === "published" && !v.publishDate) {
            v.publishDate = todayISO();
          }
        });
        toast("Стадия обновлена");
      });
    });
  }

  function nextStageId(cur) {
    const ids = STAGES.map((s) => s.id);
    const i = ids.indexOf(cur);
    return ids[Math.min(ids.length - 1, i + 1)];
  }

  function videoCardHtml(v) {
    const fmt = v.format === "shorts" ? "Shorts" : "Long";
    const virClass = v.virality >= 70 ? "hot" : v.virality >= 45 ? "good" : "warn";
    const ready = v.ready || {};
    const readyItems = [
      ["hook", "Хук"],
      ["script", "Сценарий"],
      ["thumb", "Обложка"],
      ["voice", "Озвучка"],
      ["render", "Рендер"],
    ];
    return `
      <div class="card" data-id="${v.id}">
        <p class="card-title">${esc(v.title)}</p>
        <div class="card-meta">
          <span class="chip">${fmt}</span>
          <span class="chip ${virClass}">хук ${v.hookScore ?? 5}/10</span>
          <span class="chip">🔥 ${v.virality}%</span>
          ${v.niche ? `<span class="chip">${esc(v.niche)}</span>` : ""}
          ${v.rpm ? `<span class="chip">RPM $${esc(v.rpm)}</span>` : ""}
        </div>
        <div class="mini-check">
          ${readyItems
            .map(
              ([k, label]) => `
            <label onclick="event.stopPropagation()">
              <input type="checkbox" data-vid-ready="${v.id}" data-rkey="${k}" ${ready[k] ? "checked" : ""}>
              ${label}
            </label>`
            )
            .join("")}
        </div>
        <div class="btn-row" style="margin-top:8px" onclick="event.stopPropagation()">
          <button type="button" class="btn btn-sm" data-advance="${v.id}">Этап →</button>
          <button type="button" class="btn btn-sm btn-primary" data-to-plan="${v.id}">⚡ В план на сегодня</button>
        </div>
      </div>
    `;
  }

  function bindKanbanChecks() {
    $("#kanban").addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches('input[type="checkbox"][data-vid]')) {
        updateState((st) => {
          const v = st.videos.find((x) => x.id === t.dataset.vid);
          if (v) {
            if (!v.checklist) v.checklist = {};
            v.checklist[t.dataset.key] = t.checked;
          }
        });
      }
      if (t.matches("input[data-vid-ready]")) {
        updateState((st) => {
          const v = st.videos.find((x) => x.id === t.dataset.vidReady);
          if (!v) return;
          if (!v.ready) v.ready = {};
          v.ready[t.dataset.rkey] = t.checked;
        });
      }
    });
  }

  function openVideoModal(id) {
    const s = getState();
    const v = id ? s.videos.find((x) => x.id === id) : null;
    editingVideoId = id || null;
    const modal = $("#modal");
    $("#modal-title").textContent = v ? "Редактировать ролик" : "Новый ролик";
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Название</label>
          <input id="v-title" value="${esc(v?.title || "")}" placeholder="Название ролика">
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Формат</label>
            <select id="v-format">
              <option value="long" ${!v || v.format === "long" ? "selected" : ""}>Long 8–10 мин</option>
              <option value="shorts" ${v?.format === "shorts" ? "selected" : ""}>Shorts</option>
            </select>
          </div>
          <div class="field">
            <label>Прогноз виральности %</label>
            <input type="number" id="v-virality" min="0" max="100" value="${v?.virality ?? 50}">
          </div>
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Стадия</label>
            <select id="v-stage">
              ${STAGES.map(
                (st) =>
                  `<option value="${st.id}" ${v?.stage === st.id ? "selected" : ""}>${esc(st.label)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="field">
            <label>Дата публикации</label>
            <input type="date" id="v-date" value="${v?.publishDate || ""}">
          </div>
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Оценка хука 1–10</label>
            <input type="number" id="v-hook" min="1" max="10" value="${v?.hookScore ?? 5}">
          </div>
          <div class="field">
            <label>Ниша</label>
            <input id="v-niche" value="${esc(v?.niche || "")}" placeholder="finance / ai">
          </div>
          <div class="field">
            <label>RPM $</label>
            <input type="number" id="v-rpm" min="0" step="0.1" value="${v?.rpm ?? 0}">
          </div>
        </div>
        <div class="field">
          <label>Сценарий / хук / промты</label>
          <textarea id="v-notes" placeholder="Хук 0–12 сек, сценарий, промты 即梦AI…">${esc(v?.notes || "")}</textarea>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="v-save">Сохранить</button>
          ${v ? `<button class="btn btn-danger" id="v-del">Удалить</button>` : ""}
          <button class="btn btn-ghost" id="v-cancel">Отмена</button>
        </div>
      </div>
    `;
    modal.classList.add("open");
    $("#v-cancel").onclick = closeModal;
    $("#v-save").onclick = () => {
      const payload = {
        title: $("#v-title").value.trim() || "Без названия",
        format: $("#v-format").value,
        virality: Math.max(0, Math.min(100, Number($("#v-virality").value) || 0)),
        stage: $("#v-stage").value,
        publishDate: $("#v-date").value || null,
        notes: $("#v-notes").value,
        hookScore: Math.max(1, Math.min(10, Number($("#v-hook").value) || 5)),
        niche: $("#v-niche").value.trim(),
        rpm: Number($("#v-rpm").value) || 0,
      };
      updateState((st) => {
        if (editingVideoId) {
          const cur = st.videos.find((x) => x.id === editingVideoId);
          Object.assign(cur, payload);
        } else {
          st.videos.push({
            id: uid("vid"),
            checklist: { idea: true, script: false, images: false, edit: false, publish: false },
            ready: { hook: false, script: false, thumb: false, voice: false, render: false },
            ...payload,
          });
        }
      });
      closeModal();
      toast("Ролик сохранён");
    };
    if (v) {
      $("#v-del").onclick = () => {
        if (!confirm("Удалить ролик?")) return;
        updateState((st) => {
          st.videos = st.videos.filter((x) => x.id !== editingVideoId);
        });
        closeModal();
        toast("Удалено");
      };
    }
  }

  function closeModal() {
    $("#modal").classList.remove("open");
    editingVideoId = null;
    editingEventId = null;
    editingSubId = null;
  }

  function defaultLaunchFund(rate = 7.2) {
    const goalCny = 265;
    return {
      title: "Копилка на запуск ИИ-конвейера",
      savedCny: 0,
      goalCny,
      goalUsd: Math.round((goalCny / rate) * 10) / 10,
    };
  }

  function openFundEditModal() {
    const s = getState();
    const rate = s.budget?.exchangeRate || 7.2;
    const fund = s.launchFund || defaultLaunchFund(rate);
    const goalCny = fund.goalCny || 265;
    const goalUsd = Math.round((goalCny / rate) * 10) / 10;
    $("#modal-title").textContent = "Редактировать копилку";
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Название цели</label>
          <input id="fund-title" value="${esc(fund.title || "Копилка на запуск ИИ-конвейера")}" placeholder="Название цели">
        </div>
        <div class="field">
          <label>Целевая сумма ¥</label>
          <input type="number" id="fund-goal-cny" min="1" step="1" value="${goalCny}">
        </div>
        <div class="muted" id="fund-goal-usd-hint">≈ $${goalUsd} по курсу ${rate}</div>
        <div class="btn-row">
          <button class="btn btn-primary" id="fund-goal-save">Сохранить</button>
          <button class="btn btn-ghost" id="fund-goal-cancel">Отмена</button>
        </div>
      </div>
    `;
    $("#modal").classList.add("open");
    const syncUsdHint = () => {
      const cny = Math.max(1, Number($("#fund-goal-cny").value) || 0);
      const usd = Math.round((cny / rate) * 10) / 10;
      $("#fund-goal-usd-hint").textContent = `≈ $${usd} по курсу ${rate}`;
    };
    $("#fund-goal-cny").oninput = syncUsdHint;
    $("#fund-goal-cancel").onclick = closeModal;
    $("#fund-goal-save").onclick = () => {
      const title = $("#fund-title").value.trim() || "Копилка";
      const nextGoal = Math.max(1, Number($("#fund-goal-cny").value) || 265);
      updateState((st) => {
        const r = st.budget?.exchangeRate || 7.2;
        if (!st.launchFund) st.launchFund = defaultLaunchFund(r);
        st.launchFund.title = title;
        st.launchFund.goalCny = nextGoal;
        st.launchFund.goalUsd = Math.round((nextGoal / r) * 10) / 10;
      });
      closeModal();
      toast("Цель копилки обновлена");
    };
  }

  function openSubEditModal(id) {
    const s = getState();
    const sub = s.subscriptions.find((x) => x.id === id);
    if (!sub) return;
    editingSubId = id;
    $("#modal-title").textContent = "Изменить подписку";
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Сервис</label>
          <input id="sub-edit-name" value="${esc(sub.name || "")}" placeholder="Название сервиса">
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Цена</label>
            <input type="number" id="sub-edit-price" min="0" step="0.01" value="${sub.price ?? 0}">
          </div>
          <div class="field">
            <label>Валюта</label>
            <select id="sub-edit-cur">
              <option value="USD" ${sub.currency === "USD" ? "selected" : ""}>$ USD</option>
              <option value="CNY" ${sub.currency === "CNY" ? "selected" : ""}>¥ CNY</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Дата продления</label>
          <input type="date" id="sub-edit-date" value="${sub.renewDate || ""}">
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="sub-edit-save">Сохранить</button>
          <button class="btn btn-ghost" id="sub-edit-cancel">Отмена</button>
        </div>
      </div>
    `;
    $("#modal").classList.add("open");
    $("#sub-edit-cancel").onclick = closeModal;
    $("#sub-edit-save").onclick = () => {
      const name = $("#sub-edit-name").value.trim();
      if (!name) return toast("Укажите название");
      const price = Number($("#sub-edit-price").value) || 0;
      const currency = $("#sub-edit-cur").value;
      const renewDate = $("#sub-edit-date").value || "";
      updateState((st) => {
        const cur = st.subscriptions.find((x) => x.id === editingSubId);
        if (!cur) return;
        cur.name = name;
        cur.price = price;
        cur.currency = currency;
        cur.renewDate = renewDate;
        cur.critical = /ip|proxy|iproyal/i.test(name);
      });
      closeModal();
      toast("Подписка обновлена");
    };
  }

  /* Calendar */
  function colorHex(id) {
    return EVENT_COLORS.find((c) => c.id === id)?.hex || EVENT_COLORS[0].hex;
  }

  function dayMarks(s) {
    const marks = {};
    (s.videos || []).forEach((v) => {
      if (!v.publishDate) return;
      if (!marks[v.publishDate]) marks[v.publishDate] = { videos: [], events: [] };
      marks[v.publishDate].videos.push(v);
    });
    (s.calendarEvents || []).forEach((ev) => {
      if (!ev.date) return;
      if (!marks[ev.date]) marks[ev.date] = { videos: [], events: [] };
      marks[ev.date].events.push(ev);
    });
    return marks;
  }

  function renderDayPanel(day, marks) {
    const root = $("#cal-events");
    if (!day) {
      root.innerHTML = `<div class="empty">Выберите дату в календаре</div>`;
      return;
    }
    const bucket = marks[day] || { videos: [], events: [] };
    const videosHtml = bucket.videos
      .map(
        (v) => `
      <div class="cal-item cal-item-video">
        <div>
          <div class="cal-item-title">▶ ${esc(v.title)}</div>
          <div class="muted">Публикация ролика</div>
        </div>
        <button type="button" class="btn btn-sm" data-open-video="${v.id}">Открыть</button>
      </div>`
      )
      .join("");

    const eventsHtml = bucket.events
      .map(
        (ev) => `
      <div class="cal-item" style="border-left:3px solid ${colorHex(ev.color)}">
        <div class="grow">
          <div class="cal-item-title">${esc(ev.title)}${ev.time ? ` · ⏰ ${esc(ev.time)}` : ""}</div>
          ${ev.note ? `<div class="cal-item-note">${esc(ev.note)}</div>` : ""}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-sm" data-edit-event="${ev.id}">Изменить</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-event="${ev.id}">Удалить</button>
        </div>
      </div>`
      )
      .join("");

    const empty =
      !bucket.videos.length && !bucket.events.length
        ? `<div class="empty">Нет событий и публикаций на ${day}</div>`
        : "";

    root.innerHTML = `
      <div class="cal-day-panel">
        <div class="block-head" style="margin-bottom:10px">
          <h3 style="margin:0;font-size:14px">День ${day}</h3>
          <span class="chip">${bucket.events.length + bucket.videos.length} записей</span>
        </div>
        ${empty}
        ${eventsHtml}
        ${videosHtml}
        <button type="button" class="btn btn-primary btn-add-event" id="btn-add-cal-event">+ Добавить событие на эту дату</button>
      </div>`;

    $$("#cal-events [data-open-video]").forEach((b) => {
      b.onclick = () => openVideoModal(b.dataset.openVideo);
    });
    $$("#cal-events [data-edit-event]").forEach((b) => {
      b.onclick = () => openEventModal(b.dataset.editEvent, day);
    });
    $$("#cal-events [data-del-event]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("Удалить событие?")) return;
        updateState((st) => {
          st.calendarEvents = (st.calendarEvents || []).filter((x) => x.id !== b.dataset.delEvent);
        });
        toast("Событие удалено");
      };
    });
    const addBtn = $("#btn-add-cal-event");
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEventModal(null, day);
      };
    }
  }

  function openEventModal(id, day) {
    const s = getState();
    const ev = id ? (s.calendarEvents || []).find((x) => x.id === id) : null;
    editingEventId = id || null;
    const dateVal = ev?.date || day || selectedCalDay || todayISO();
    const color = ev?.color || "blue";
    $("#modal-title").textContent = ev ? "Редактировать событие" : "Новое событие";
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Дата</label>
          <input type="date" id="ev-date" value="${esc(dateVal)}">
        </div>
        <div class="field">
          <label>Заголовок</label>
          <input id="ev-title" value="${esc(ev?.title || "")}" placeholder="Дедлайн / встреча / напоминание" autocomplete="off">
        </div>
        <div class="field">
          <label>Заметка / текст</label>
          <textarea id="ev-note" placeholder="Подробности, чек-лист, ссылки…">${esc(ev?.note || "")}</textarea>
        </div>
        <div class="field">
          <label>Напоминание (HH:MM, Asia/Shanghai) — необязательно</label>
          <input type="time" id="ev-time" value="${esc(ev?.time || "")}">
        </div>
        <div class="field">
          <label>Цветная метка</label>
          <div class="color-picks" id="ev-colors">
            ${EVENT_COLORS.map(
              (c) => `
              <button type="button" class="color-pick ${c.id === color ? "active" : ""}" data-color="${c.id}" style="--c:${c.hex}" title="${esc(c.label)}" aria-label="${esc(c.label)}"></button>`
            ).join("")}
          </div>
          <input type="hidden" id="ev-color" value="${esc(color)}">
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="ev-save">Сохранить</button>
          ${ev ? `<button type="button" class="btn btn-danger" id="ev-del">Удалить</button>` : ""}
          <button type="button" class="btn btn-ghost" id="ev-cancel">Отмена</button>
        </div>
      </div>`;
    $("#modal").classList.add("open");

    $$("#ev-colors .color-pick").forEach((btn) => {
      btn.onclick = () => {
        $$("#ev-colors .color-pick").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        $("#ev-color").value = btn.dataset.color;
      };
    });
    $("#ev-cancel").onclick = closeModal;
    $("#ev-save").onclick = async () => {
      const title = $("#ev-title").value.trim();
      const note = $("#ev-note").value.trim();
      const date = $("#ev-date").value;
      const time = ($("#ev-time").value || "").slice(0, 5) || null;
      const col = $("#ev-color").value || "blue";
      if (!title) return toast("Укажите заголовок");
      if (!date) return toast("Укажите дату");
      let eventId = editingEventId;
      updateState((st) => {
        if (!st.calendarEvents) st.calendarEvents = [];
        if (editingEventId) {
          const cur = st.calendarEvents.find((x) => x.id === editingEventId);
          if (cur) Object.assign(cur, { title, note, date, time, color: col });
        } else {
          eventId = uid("cev");
          st.calendarEvents.push({
            id: eventId,
            date,
            title,
            note,
            time,
            color: col,
          });
        }
      });
      if (time) {
        const r = await scheduleNtfyReminder({ kind: "event", id: eventId, title, date, time });
        if (r.ok && r.reason === "scheduled") toast(`Напоминание ntfy на ${time}`);
        else if (!r.ok && r.reason === "no-topic") toast("Укажите ntfy topic в Настройках");
      }
      selectedCalDay = date;
      closeModal();
      toast("Событие сохранено");
    };
    if (ev) {
      $("#ev-del").onclick = () => {
        if (!confirm("Удалить событие?")) return;
        updateState((st) => {
          st.calendarEvents = (st.calendarEvents || []).filter((x) => x.id !== editingEventId);
        });
        closeModal();
        toast("Удалено");
      };
    }
  }

  function renderCalendar() {
    const s = getState();
    if (!calMonth) {
      const t = todayISO();
      calMonth = new Date(t + "T00:00:00");
      calMonth.setDate(1);
    }
    if (!selectedCalDay) selectedCalDay = todayISO();

    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const monthNames = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ];
    $("#cal-label").textContent = `${monthNames[month]} ${year}`;

    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayISO();
    const marks = dayMarks(s);

    let html = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      .map((d) => `<div class="cal-dow">${d}</div>`)
      .join("");

    for (let i = 0; i < firstDow; i++) html += `<button type="button" class="cal-day muted" disabled></button>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const has = marks[iso] && (marks[iso].videos.length || marks[iso].events.length);
      const cls = [
        "cal-day",
        iso === today ? "today" : "",
        has ? "has-event" : "",
        marks[iso]?.events?.length ? "has-note" : "",
        selectedCalDay === iso ? "selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      html += `<button type="button" class="${cls}" data-day="${iso}" aria-label="${iso}">${d}</button>`;
    }
    $("#calendar").innerHTML = html;

    $$("#calendar .cal-day[data-day]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        selectedCalDay = btn.dataset.day;
        renderCalendar();
      };
    });

    renderDayPanel(selectedCalDay, marks);
  }

  /* ===================== FOCUS ===================== */
  function habitDoneToday(habitId) {
    const logs = getState().habitLogs[todayISO()] || {};
    return !!logs[habitId];
  }

  function allHabitsDoneToday() {
    const habits = getState().habits.filter((h) => !h.archived);
    if (!habits.length) return false;
    return habits.every((h) => habitDoneToday(h.id));
  }

  function shiftISODate(iso, deltaDays) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    return dt.toISOString().slice(0, 10);
  }

  function shanghaiNowMinutes() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + 8 * 3600000);
    return local.getHours() * 60 + local.getMinutes();
  }

  function timeToMinutes(hhmm) {
    const tm = normalizeTimeHHMM(hhmm);
    if (!tm) return null;
    const [h, m] = tm.split(":").map(Number);
    return h * 60 + m;
  }

  function recalcStreak() {
    updateState((st) => {
      const today = todayISO();
      const habits = st.habits.filter((h) => !h.archived);
      const done =
        habits.length > 0 && habits.every((h) => !!(st.habitLogs[today] || {})[h.id]);

      if (done) {
        if (st.streak.lastCompleteDate === today) {
          /* already counted */
        } else {
          const yesterday = shiftISODate(today, -1);
          if (st.streak.lastCompleteDate === yesterday) {
            st.streak.current += 1;
          } else {
            st.streak.current = 1;
          }
          st.streak.lastCompleteDate = today;
          st.streak.best = Math.max(st.streak.best || 0, st.streak.current);
        }
      } else if (st.streak.lastCompleteDate === today) {
        const yesterday = shiftISODate(today, -1);
        st.streak.lastCompleteDate = st.streak.current > 1 ? yesterday : null;
        st.streak.current = Math.max(0, st.streak.current - 1);
      }
    });
  }

  function fmtTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function playTimerDone() {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (_) {
      /* ignore */
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 500);
    } catch (_) {
      /* ignore */
    }
  }

  function dayProductivity(s) {
    const today = todayISO();
    const tasks = (s.dailyTasks || []).filter((t) => t.date === today);
    const habits = (s.habits || []).filter((h) => !h.archived);
    const total = tasks.length + habits.length;
    if (!total) return { pct: 0, done: 0, total: 0 };
    const done =
      tasks.filter((t) => t.done).length + habits.filter((h) => habitDoneToday(h.id)).length;
    return { pct: Math.round((done / total) * 100), done, total };
  }

  function nextScheduledItem(s) {
    const today = todayISO();
    const nowMin = shanghaiNowMinutes();
    const items = [];
    (s.dailyTasks || []).forEach((t) => {
      if (t.date !== today || t.done || !t.time) return;
      const mins = timeToMinutes(t.time);
      if (mins == null) return;
      items.push({ title: t.title, time: t.time, mins, kind: "task" });
    });
    (s.habits || []).forEach((h) => {
      if (h.archived || !h.time || habitDoneToday(h.id)) return;
      const mins = timeToMinutes(h.time);
      if (mins == null) return;
      items.push({ title: h.name, time: h.time, mins, kind: "habit" });
    });
    items.sort((a, b) => a.mins - b.mins);
    const upcoming = items.find((i) => i.mins >= nowMin);
    return upcoming || null;
  }

  function ensureFocusWidgetTick() {
    if (focusWidgetTick) return;
    focusWidgetTick = setInterval(() => {
      if (!$("#panel-focus")?.classList.contains("active")) return;
      if (!isUnlocked()) return;
      renderFocusWidgetsOnly();
    }, 30000);
  }

  function renderFocusWidgetsOnly() {
    const el = $("#focus-widgets");
    if (!el || !isUnlocked()) return;
    const s = getState();
    const next = nextScheduledItem(s);
    const prod = dayProductivity(s);
    const nowMin = shanghaiNowMinutes();
    let nextHtml = `<div class="muted">Нет дел с указанным временем</div>`;
    if (next) {
      const left = Math.max(0, next.mins - nowMin);
      const hh = String(Math.floor(left / 60)).padStart(2, "0");
      const mm = String(left % 60).padStart(2, "0");
      nextHtml = `
        <div class="value">⏰ ${esc(next.time)} — ${esc(next.title)}</div>
        <div class="muted">Через ${left} мин (${hh}:${mm}) · ${next.kind === "habit" ? "привычка" : "план"}</div>`;
    }
    el.innerHTML = `
      <div class="focus-widgets">
        <div class="focus-widget">
          <div class="label">⏱ Следующее по расписанию</div>
          ${nextHtml}
        </div>
        <div class="focus-widget">
          <div class="label">Продуктивность дня</div>
          <div class="value">${prod.pct}%</div>
          <div class="muted">${prod.done} / ${prod.total} пунктов</div>
          <div class="prod-bar"><i style="width:${prod.pct}%"></i></div>
        </div>
      </div>`;
  }

  async function scheduleTaskReminders(tasks) {
    const date = todayISO();
    let scheduled = 0;
    let noTopic = false;
    for (const t of tasks) {
      if (!t?.time || t.done) continue;
      const r = await scheduleNtfyReminder({
        kind: "task",
        id: t.id,
        title: t.title,
        date: t.date || date,
        time: t.time,
      });
      if (r.ok && r.reason === "scheduled") scheduled += 1;
      if (r.reason === "no-topic") noTopic = true;
    }
    return { scheduled, noTopic };
  }

  async function scheduleTodayHabitReminders() {
    const s = getState();
    const today = todayISO();
    let scheduled = 0;
    let noTopic = false;
    for (const h of (s.habits || []).filter((x) => !x.archived && x.time)) {
      if (habitDoneToday(h.id)) continue;
      const r = await scheduleNtfyReminder({
        kind: "habit",
        id: h.id,
        title: h.name,
        date: today,
        time: h.time,
      });
      if (r.ok && r.reason === "scheduled") scheduled += 1;
      if (r.reason === "no-topic") noTopic = true;
    }
    return { scheduled, noTopic };
  }

  async function applyWeeklyScheduleToToday({ force = false } = {}) {
    const today = todayISO();
    const key = weekdayKeyFromISO(today);
    const created = [];
    updateState((st) => {
      if (!st.weeklySchedule) st.weeklySchedule = {};
      WEEKDAY_KEYS.forEach((k) => {
        if (!Array.isArray(st.weeklySchedule[k])) st.weeklySchedule[k] = [];
      });
      if (!st.dailyTasks) st.dailyTasks = [];
      const template = st.weeklySchedule[key] || [];
      const existingToday = st.dailyTasks.filter((t) => t.date === today);
      if (!force && st.weeklyScheduleAppliedDate === today) return;
      if (!force && existingToday.length > 0) {
        st.weeklyScheduleAppliedDate = today;
        return;
      }
      template.forEach((item) => {
        const title = (item.title || "").trim();
        if (!title) return;
        const time = normalizeTimeHHMM(item.time);
        const exists = st.dailyTasks.some(
          (t) =>
            t.date === today &&
            t.title === title &&
            (t.time || null) === time &&
            !t.done
        );
        if (exists && !force) return;
        if (
          force &&
          st.dailyTasks.some(
            (t) => t.date === today && t.fromSchedule === item.id && !t.done
          )
        ) {
          return;
        }
        const row = {
          id: uid("dt"),
          title,
          time,
          priority: item.priority === "high" ? "high" : "normal",
          done: false,
          date: today,
          fromSchedule: item.id || null,
        };
        st.dailyTasks.push(row);
        created.push(row);
      });
      st.weeklyScheduleAppliedDate = today;
    });
    const habitRes = await scheduleTodayHabitReminders();
    if (created.length) {
      const { scheduled, noTopic } = await scheduleTaskReminders(created);
      if (force) {
        if (noTopic || habitRes.noTopic) toast("Укажите ntfy topic в Настройках");
        else if (scheduled || habitRes.scheduled)
          toast(`Расписание: ${created.length}, пушей: ${scheduled + habitRes.scheduled}`);
        else toast(`Загружено пунктов: ${created.length}`);
      } else if (noTopic || habitRes.noTopic) {
        toast("Укажите ntfy topic в Настройках");
      }
    } else if (force) {
      toast("Шаблон пуст или уже в плане");
    }
    return created.length;
  }

  function renderWeekDaySwitcher() {
    const todayKey = weekdayKeyFromISO(todayISO());
    if (!selectedWeekDay || !WEEKDAY_KEYS.includes(selectedWeekDay)) {
      selectedWeekDay = todayKey;
    }
    $("#week-days").innerHTML = WEEKDAY_KEYS.map((k) => {
      const cls = [
        "week-day-btn",
        k === selectedWeekDay ? "active" : "",
        k === todayKey ? "today-mark" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-week-day="${k}">${WEEKDAY_LABELS[k]}</button>`;
    }).join("");
  }

  function renderWeekScheduleEditor() {
    const editor = $("#week-schedule-editor");
    if (!editor) return;
    editor.hidden = !weekEditorOpen;
    if (!weekEditorOpen) return;
    const s = getState();
    const day = selectedWeekDay || weekdayKeyFromISO(todayISO());
    const items = [...((s.weeklySchedule && s.weeklySchedule[day]) || [])];
    items.sort((a, b) => (timeToMinutes(a.time) ?? 9999) - (timeToMinutes(b.time) ?? 9999));
    const copyOptions = WEEKDAY_KEYS.filter((k) => k !== day)
      .map((k) => `<option value="${k}">${WEEKDAY_LABELS[k]}</option>`)
      .join("");

    editor.innerHTML = `
      <div class="muted" style="margin:0 0 8px">Шаблон: <strong>${WEEKDAY_LABELS[day]}</strong> · время Asia/Shanghai</div>
      <div id="ws-list">
        ${
          items
            .map(
              (it) => `
          <div class="ws-item">
            <span class="muted">${it.time ? esc(it.time) : "—:—"}</span>
            <div>
              <div style="font-weight:600">${it.priority === "high" ? "🔥 " : ""}${esc(it.title)}</div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-sm" data-ws-edit="${it.id}">✎</button>
              <button type="button" class="btn btn-sm btn-ghost" data-ws-del="${it.id}">✕</button>
            </div>
          </div>`
            )
            .join("") || `<div class="empty">Нет пунктов на ${WEEKDAY_LABELS[day]}</div>`
        }
      </div>
      <div class="form-grid" style="margin-top:10px">
        <div class="field"><input id="ws-new-title" placeholder="Напр. Уроки / YouTube / Турники" autocomplete="off"></div>
        <div class="inline-fields">
          <div class="field"><label>Время</label><input type="time" id="ws-new-time"></div>
          <div class="field"><label>Приоритет</label>
            <select id="ws-new-prio">
              <option value="normal">⚡ Обычное</option>
              <option value="high">🔥 Главное</option>
            </select>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-ws-add">+ В шаблон ${WEEKDAY_LABELS[day]}</button>
      </div>
      <div class="inline-fields" style="margin-top:10px;align-items:end">
        <div class="field">
          <label>Копировать ${WEEKDAY_LABELS[day]} →</label>
          <select id="ws-copy-to">${copyOptions}</select>
        </div>
        <button type="button" class="btn btn-sm" id="btn-ws-copy">Копировать день</button>
      </div>`;

    $("#btn-ws-add").onclick = async () => {
      const title = $("#ws-new-title").value.trim();
      const time = normalizeTimeHHMM($("#ws-new-time").value);
      const priority = $("#ws-new-prio").value === "high" ? "high" : "normal";
      if (!title) return toast("Укажите название");
      const id = uid("ws");
      updateState((st) => {
        if (!st.weeklySchedule[day]) st.weeklySchedule[day] = [];
        st.weeklySchedule[day].push({ id, title, time, priority });
      });
      $("#ws-new-title").value = "";
      $("#ws-new-time").value = "";
      const todayKey = weekdayKeyFromISO(todayISO());
      if (time && day === todayKey) {
        const r = await scheduleNtfyReminder({
          kind: "task",
          id,
          title,
          date: todayISO(),
          time,
        });
        if (r.ok && r.reason === "scheduled") toast(`Шаблон + пуш на ${time}`);
        else if (r.reason === "no-topic") toast("Укажите ntfy topic в Синхр.");
        else toast("Пункт шаблона добавлен");
      } else toast("Пункт шаблона добавлен");
    };

    $("#btn-ws-copy").onclick = () => {
      const to = $("#ws-copy-to").value;
      if (!to || to === day) return;
      updateState((st) => {
        const src = JSON.parse(JSON.stringify(st.weeklySchedule[day] || []));
        st.weeklySchedule[to] = src.map((x) => ({
          ...x,
          id: uid("ws"),
        }));
      });
      toast(`Скопировано: ${WEEKDAY_LABELS[day]} → ${WEEKDAY_LABELS[to]}`);
    };

    $$("#ws-list [data-ws-del]").forEach((btn) => {
      btn.onclick = () => {
        updateState((st) => {
          st.weeklySchedule[day] = (st.weeklySchedule[day] || []).filter(
            (x) => x.id !== btn.dataset.wsDel
          );
        });
      };
    });

    $$("#ws-list [data-ws-edit]").forEach((btn) => {
      btn.onclick = () => openWeekItemModal(day, btn.dataset.wsEdit);
    });
  }

  function openWeekItemModal(dayKey, itemId) {
    const s = getState();
    const item = (s.weeklySchedule?.[dayKey] || []).find((x) => x.id === itemId);
    if (!item) return;
    $("#modal-title").textContent = `Шаблон · ${WEEKDAY_LABELS[dayKey]}`;
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field"><label>Дело</label><input id="ws-edit-title" value="${esc(item.title || "")}"></div>
        <div class="inline-fields">
          <div class="field"><label>Время HH:MM</label><input type="time" id="ws-edit-time" value="${item.time || ""}"></div>
          <div class="field"><label>Приоритет</label>
            <select id="ws-edit-prio">
              <option value="normal" ${item.priority !== "high" ? "selected" : ""}>⚡ Обычное</option>
              <option value="high" ${item.priority === "high" ? "selected" : ""}>🔥 Главное</option>
            </select>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="ws-edit-save">Сохранить</button>
          <button class="btn btn-ghost" id="ws-edit-cancel">Отмена</button>
        </div>
      </div>`;
    $("#modal").classList.add("open");
    $("#ws-edit-cancel").onclick = closeModal;
    $("#ws-edit-save").onclick = async () => {
      const title = $("#ws-edit-title").value.trim();
      if (!title) return toast("Укажите название");
      const tm = normalizeTimeHHMM($("#ws-edit-time").value);
      updateState((st) => {
        const cur = (st.weeklySchedule[dayKey] || []).find((x) => x.id === itemId);
        if (!cur) return;
        cur.title = title;
        cur.time = tm;
        cur.priority = $("#ws-edit-prio").value === "high" ? "high" : "normal";
      });
      closeModal();
      const todayKey = weekdayKeyFromISO(todayISO());
      if (tm && dayKey === todayKey) {
        const r = await scheduleNtfyReminder({
          kind: "task",
          id: itemId,
          title,
          date: todayISO(),
          time: tm,
        });
        if (r.ok && r.reason === "scheduled") toast(`Пуш шаблона на ${tm}`);
        else if (r.reason === "no-topic") toast("Укажите ntfy topic в Синхр.");
        else toast("Пункт шаблона обновлён");
      } else toast("Пункт шаблона обновлён");
    };
  }

  function openTaskEditModal(taskId) {
    const t = (getState().dailyTasks || []).find((x) => x.id === taskId);
    if (!t) return;
    $("#modal-title").textContent = "Редактировать задачу";
    $("#modal-body").innerHTML = `
      <div class="form-grid">
        <div class="field"><label>Заголовок</label><input id="task-edit-title" value="${esc(t.title || "")}"></div>
        <div class="inline-fields">
          <div class="field"><label>Время HH:MM</label><input type="time" id="task-edit-time" value="${t.time || ""}"></div>
          <div class="field"><label>Приоритет</label>
            <select id="task-edit-prio">
              <option value="normal" ${t.priority !== "high" ? "selected" : ""}>⚡ Обычное</option>
              <option value="high" ${t.priority === "high" ? "selected" : ""}>🔥 Главное</option>
            </select>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="task-edit-save">Сохранить</button>
          <button class="btn btn-ghost" id="task-edit-cancel">Отмена</button>
        </div>
      </div>`;
    $("#modal").classList.add("open");
    $("#task-edit-cancel").onclick = closeModal;
    $("#task-edit-save").onclick = async () => {
      const title = $("#task-edit-title").value.trim() || t.title;
      const tm = normalizeTimeHHMM($("#task-edit-time").value);
      const priority = $("#task-edit-prio").value === "high" ? "high" : "normal";
      updateState((st) => {
        const cur = (st.dailyTasks || []).find((x) => x.id === taskId);
        if (!cur) return;
        cur.title = title;
        cur.time = tm;
        cur.priority = priority;
      });
      closeModal();
      if (tm) {
        const r = await scheduleNtfyReminder({
          kind: "task",
          id: taskId,
          title,
          date: t.date || todayISO(),
          time: tm,
        });
        if (r.ok && r.reason === "scheduled") toast(`Пуш на ${tm}`);
        else if (r.reason === "no-topic") toast("Укажите ntfy topic в Настройках");
        else toast("Задача обновлена");
      } else toast("Задача обновлена");
    };
  }

  function renderFocusTimer() {
    const el = $("#focus-timer");
    if (!el) return;
    const running = !!focusTimer;
    el.innerHTML = `
      <div class="timer-display">${fmtTimer(focusLeftSec || focusTotalSec || 0)}</div>
      <div class="btn-row" style="margin:10px 0">
        <button type="button" class="btn btn-sm" data-ft="25" ${running ? "disabled" : ""}>25 мин</button>
        <button type="button" class="btn btn-sm" data-ft="45" ${running ? "disabled" : ""}>45 мин</button>
        <button type="button" class="btn btn-sm" data-ft="60" ${running ? "disabled" : ""}>60 мин</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="ft-toggle">${running ? "Стоп" : "Старт"}</button>
        <button type="button" class="btn btn-ghost" id="ft-reset">Сброс</button>
      </div>
      <p class="muted" style="margin-top:8px">После 60 мин привычка «1 час работы над YouTube» отметится сама</p>`;
    $$("#focus-timer [data-ft]").forEach((b) => {
      b.onclick = () => {
        if (focusTimer) return;
        focusTotalSec = Number(b.dataset.ft) * 60;
        focusLeftSec = focusTotalSec;
        renderFocusTimer();
      };
    });
    $("#ft-reset").onclick = () => {
      clearInterval(focusTimer);
      focusTimer = null;
      focusLeftSec = focusTotalSec;
      renderFocusTimer();
    };
    $("#ft-toggle").onclick = () => {
      if (focusTimer) {
        clearInterval(focusTimer);
        focusTimer = null;
        renderFocusTimer();
        return;
      }
      if (!focusLeftSec) {
        focusTotalSec = 25 * 60;
        focusLeftSec = focusTotalSec;
      }
      focusTimer = setInterval(() => {
        focusLeftSec -= 1;
        if (focusLeftSec <= 0) {
          clearInterval(focusTimer);
          focusTimer = null;
          focusLeftSec = 0;
          playTimerDone();
          if (focusTotalSec >= 3600) {
            const today = todayISO();
            updateState((st) => {
              const hab = (st.habits || []).find((h) => /youtube/i.test(h.name) || /1 час/i.test(h.name));
              if (hab) {
                if (!st.habitLogs[today]) st.habitLogs[today] = {};
                st.habitLogs[today][hab.id] = true;
              }
            });
            recalcStreak();
            toast("60 мин! YouTube-привычка отмечена");
          } else {
            toast("Фокус завершён");
          }
        }
        renderFocusTimer();
      }, 1000);
      renderFocusTimer();
    };
  }

  function renderFocus() {
    const s = getState();
    const habits = s.habits.filter((h) => !h.archived);
    const doneCount = habits.filter((h) => habitDoneToday(h.id)).length;
    const pct = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;
    const todayDone = allHabitsDoneToday();

    // Автоподстановка шаблона при первом открытии дня
    if (s.weeklyScheduleAppliedDate !== todayISO()) {
      applyWeeklyScheduleToToday({ force: false });
    }

    $("#streak-block").innerHTML = `
      <div class="streak-hero">
        <div class="streak-ring" style="--p:${pct}">
          <strong>${s.streak.current || 0}</strong>
        </div>
        <div>
          <div style="font-weight:700;font-size:16px;">Серия: ${s.streak.current || 0} дн.</div>
          <div class="muted">Рекорд: ${s.streak.best || 0} · Сегодня: ${doneCount}/${habits.length}</div>
          <div style="margin-top:6px">
            <span class="chip ${todayDone ? "good" : "warn"}">${todayDone ? "✓ День закрыт" : "Есть незакрытые привычки"}</span>
          </div>
        </div>
      </div>
    `;

    renderFocusWidgetsOnly();
    ensureFocusWidgetTick();
    renderWeekDaySwitcher();
    renderWeekScheduleEditor();
    renderFocusTimer();

    $("#habit-list").innerHTML = habits
      .map(
        (h) => `
      <div class="habit-item ${habitDoneToday(h.id) ? "done" : ""}">
        <input type="checkbox" data-habit="${h.id}" ${habitDoneToday(h.id) ? "checked" : ""}>
        <input class="habit-rename grow" data-rename="${h.id}" value="${esc(h.name)}">
        <input type="time" class="habit-time" data-habit-time="${h.id}" value="${h.time || ""}" title="Время пуша HH:MM">
        <button type="button" class="btn btn-sm btn-ghost" data-del-habit="${h.id}" title="Удалить">✕</button>
      </div>`
      )
      .join("") || `<div class="empty">Добавьте привычки</div>`;

    const today = todayISO();
    const tasks = (s.dailyTasks || []).filter((t) => t.date === today);
    const prioOrder = { high: 0, normal: 1 };
    tasks.sort((a, b) => {
      const ta = timeToMinutes(a.time);
      const tb = timeToMinutes(b.time);
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      return (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9);
    });

    $("#task-list").innerHTML = tasks
      .map(
        (t) => `
      <div class="task-item ${t.done ? "done" : ""}">
        <span class="prio ${t.priority === "high" ? "high" : "medium"}"></span>
        <div class="grow">
          <div class="task-title">${t.priority === "high" ? "🔥 " : "⚡ "}${esc(t.title)}</div>
          <div class="muted">${t.time ? `⏰ ${esc(t.time)} · ` : ""}${t.priority === "high" ? "Главное" : "Обычное"}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-sm" data-toggle-task="${t.id}">${t.done ? "↩" : "✓"}</button>
          <button type="button" class="btn btn-sm" data-edit-task="${t.id}">✎</button>
          <button type="button" class="btn btn-sm btn-ghost" data-del-task="${t.id}">✕</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty">План на сегодня пуст — загрузите шаблон недели</div>`;
  }

  function bindFocus() {
    $("#week-days").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-week-day]");
      if (!btn) return;
      selectedWeekDay = btn.dataset.weekDay;
      weekEditorOpen = true;
      renderWeekDaySwitcher();
      renderWeekScheduleEditor();
    });

    $("#btn-week-setup").onclick = () => {
      weekEditorOpen = !weekEditorOpen;
      if (!selectedWeekDay) selectedWeekDay = weekdayKeyFromISO(todayISO());
      renderWeekScheduleEditor();
      if (weekEditorOpen) {
        $("#week-schedule-block")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    $("#btn-load-schedule").onclick = async () => {
      await applyWeeklyScheduleToToday({ force: true });
    };

    $("#habit-list").addEventListener("change", async (e) => {
      const t = e.target;
      if (t.matches("[data-habit]")) {
        const today = todayISO();
        updateState((st) => {
          if (!st.habitLogs[today]) st.habitLogs[today] = {};
          st.habitLogs[today][t.dataset.habit] = t.checked;
        });
        recalcStreak();
        return;
      }
      if (t.matches("[data-rename]")) {
        const name = t.value.trim();
        if (!name) return;
        updateState((st) => {
          const h = st.habits.find((x) => x.id === t.dataset.rename);
          if (h) h.name = name;
        });
        return;
      }
      if (t.matches("[data-habit-time]")) {
        const id = t.dataset.habitTime;
        const tm = normalizeTimeHHMM(t.value);
        let habitName = "";
        updateState((st) => {
          const h = st.habits.find((x) => x.id === id);
          if (h) {
            h.time = tm;
            habitName = h.name;
          }
        });
        if (tm && habitName) {
          const r = await scheduleNtfyReminder({
            kind: "habit",
            id,
            title: habitName,
            date: todayISO(),
            time: tm,
          });
          if (r.ok && r.reason === "scheduled") toast(`Пуш привычки на ${tm}`);
          else if (r.reason === "no-topic") toast("Укажите ntfy topic в Настройках");
        }
      }
    });

    $("#habit-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-habit]");
      if (!btn) return;
      updateState((st) => {
        st.habits = st.habits.filter((h) => h.id !== btn.dataset.delHabit);
      });
      toast("Привычка удалена");
    });

    $("#btn-add-habit").onclick = async () => {
      const name = $("#new-habit").value.trim();
      if (!name) return;
      const time = normalizeTimeHHMM($("#new-habit-time")?.value);
      const id = uid("hab");
      updateState((st) => {
        st.habits.push({ id, name, archived: false, time });
      });
      $("#new-habit").value = "";
      if ($("#new-habit-time")) $("#new-habit-time").value = "";
      if (time) {
        const r = await scheduleNtfyReminder({
          kind: "habit",
          id,
          title: name,
          date: todayISO(),
          time,
        });
        if (r.ok && r.reason === "scheduled") toast(`Привычка + пуш ${time}`);
        else if (r.reason === "no-topic") toast("Укажите ntfy topic в Настройках");
        else toast("Привычка добавлена");
      } else toast("Привычка добавлена");
    };

    $("#btn-add-task").onclick = async () => {
      const title = $("#new-task").value.trim();
      const priority = $("#new-task-prio").value === "high" ? "high" : "normal";
      const time = normalizeTimeHHMM($("#new-task-time").value);
      if (!title) return;
      const id = uid("dt");
      const date = todayISO();
      updateState((st) => {
        if (!st.dailyTasks) st.dailyTasks = [];
        st.dailyTasks.push({ id, title, priority, done: false, date, time });
      });
      $("#new-task").value = "";
      $("#new-task-time").value = "";
      if (time) {
        const r = await scheduleNtfyReminder({ kind: "task", id, title, date, time });
        if (r.ok && r.reason === "scheduled") toast(`В плане · пуш на ${time}`);
        else if (r.reason === "no-topic") toast("Укажите ntfy topic в Синхр.");
        else toast("В плане");
      } else toast("В плане");
    };

    $("#btn-carry-tasks").onclick = async () => {
      const today = todayISO();
      const yesterday = shiftISODate(today, -1);
      const moved = [];
      updateState((st) => {
        (st.dailyTasks || []).forEach((t) => {
          if (!t.done && t.date === yesterday) {
            t.date = today;
            moved.push(t);
          }
        });
      });
      if (moved.length) {
        await scheduleTaskReminders(moved);
        toast(`Перенесено со вчера: ${moved.length}`);
      } else {
        toast("Со вчера невыполненных нет");
      }
    };

    $("#task-list").addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-toggle-task]");
      const del = e.target.closest("[data-del-task]");
      const edit = e.target.closest("[data-edit-task]");
      if (toggle) {
        updateState((st) => {
          const t = (st.dailyTasks || []).find((x) => x.id === toggle.dataset.toggleTask);
          if (t) t.done = !t.done;
        });
      }
      if (del) {
        updateState((st) => {
          st.dailyTasks = (st.dailyTasks || []).filter((x) => x.id !== del.dataset.delTask);
        });
      }
      if (edit) openTaskEditModal(edit.dataset.editTask);
    });
  }

  /* ===================== BUDGET ===================== */
  function renderBudget() {
    const s = getState();
    const rate = s.budget.exchangeRate || 7.2;
    let expUsd = 0;
    let expCny = 0;
    s.budget.expenses.forEach((e) => {
      expUsd += convertAmount(e.amount, e.currency, "USD", rate);
      expCny += convertAmount(e.amount, e.currency, "CNY", rate);
    });
    let incUsd = 0;
    s.budget.income.forEach((i) => {
      incUsd += convertAmount(i.amount, i.currency, "USD", rate);
    });
    const profit = incUsd - expUsd;

    $("#budget-stats").innerHTML = `
      <div class="stat-row">
        <div class="stat"><span class="label">Расходы</span><span class="value neg">${formatMoney(expUsd, "USD")}</span><div class="muted">≈ ¥${expCny.toFixed(0)}</div></div>
        <div class="stat"><span class="label">Доходы</span><span class="value pos">${formatMoney(incUsd, "USD")}</span></div>
        <div class="stat"><span class="label">Чистая прибыль</span><span class="value ${profit >= 0 ? "pos" : "neg"}">${formatMoney(profit, "USD")}</span></div>
      </div>
      <div class="field" style="max-width:200px">
        <label>Курс ¥ за $1</label>
        <input type="number" id="fx-rate" step="0.01" min="0.01" value="${rate}">
      </div>
    `;
    $("#fx-rate").onchange = () => {
      updateState((st) => {
        const rateNext = Number($("#fx-rate").value) || 7.2;
        st.budget.exchangeRate = rateNext;
        if (st.launchFund?.goalCny) {
          st.launchFund.goalUsd = Math.round((st.launchFund.goalCny / rateNext) * 10) / 10;
        }
      });
    };

    const fund = s.launchFund || defaultLaunchFund(rate);
    const goalCny = fund.goalCny || 265;
    const saved = fund.savedCny || 0;
    const left = Math.max(0, goalCny - saved);
    const fundPct = Math.min(100, goalCny > 0 ? (saved / goalCny) * 100 : 0);
    const goalUsdApprox = Math.round((goalCny / rate) * 10) / 10;
    const savedUsdApprox = Math.round((saved / rate) * 10) / 10;
    const fundTitle = fund.title || "Копилка на запуск ИИ-конвейера";
    $("#launch-fund-block").innerHTML = `
      <div class="block-head">
        <h3>🎯 ${esc(fundTitle)}</h3>
        <div class="btn-row" style="gap:8px;flex-wrap:wrap">
          <span class="chip">цель ¥${goalCny} / ~$${goalUsdApprox}</span>
          <button type="button" class="btn btn-sm" id="btn-fund-edit">Изменить</button>
        </div>
      </div>
      <div class="thermo-row">
        <div class="thermo-meta"><span>Накоплено</span><strong>¥${saved.toFixed(0)} / ¥${goalCny}</strong></div>
        <div class="bar"><i style="width:${fundPct}%"></i></div>
        <div class="muted">≈ $${savedUsdApprox} · осталось ¥${left.toFixed(0)}</div>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <div class="field" style="flex:1"><input type="number" id="fund-amount" step="1" placeholder="¥ сумма"></div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-fund-add">+ В копилку</button>
        <button type="button" class="btn btn-sm" id="btn-fund-set">Задать</button>
        <button type="button" class="btn btn-sm" id="btn-fund-sub">− Расход</button>
        <button type="button" class="btn btn-sm" id="btn-fund-reset">Сброс</button>
      </div>`;
    const ensureFund = (st) => {
      if (!st.launchFund) st.launchFund = defaultLaunchFund(st.budget?.exchangeRate || 7.2);
      return st.launchFund;
    };
    $("#btn-fund-edit").onclick = () => openFundEditModal();
    $("#btn-fund-add").onclick = () => {
      const add = Number($("#fund-amount").value) || 0;
      if (add <= 0) return toast("Укажите сумму > 0");
      updateState((st) => {
        const f = ensureFund(st);
        f.savedCny = (f.savedCny || 0) + add;
      });
      toast("Добавлено в копилку");
    };
    $("#btn-fund-set").onclick = () => {
      const raw = $("#fund-amount").value;
      if (raw === "" || raw == null) return toast("Укажите точную сумму");
      const next = Math.max(0, Number(raw) || 0);
      updateState((st) => {
        ensureFund(st).savedCny = next;
      });
      toast("Накоплено обновлено");
    };
    $("#btn-fund-sub").onclick = () => {
      const sub = Number($("#fund-amount").value) || 0;
      if (sub <= 0) return toast("Укажите сумму расхода > 0");
      updateState((st) => {
        const f = ensureFund(st);
        f.savedCny = Math.max(0, (f.savedCny || 0) - sub);
      });
      toast("Расход списан из копилки");
    };
    $("#btn-fund-reset").onclick = () => {
      if (!confirm("Обнулить накопленную сумму?")) return;
      updateState((st) => {
        ensureFund(st).savedCny = 0;
      });
      toast("Копилка обнулена");
    };

    const catLabel = (id) => BUDGET_CATEGORIES.find((c) => c.id === id)?.label || id || "";

    $("#expense-list").innerHTML = s.budget.expenses
      .map(
        (e) => `
      <div class="list-row">
        <div>
          <div>${esc(e.name)}</div>
          <div class="muted">${e.date || ""} · ${esc(catLabel(e.category))}</div>
        </div>
        <div style="text-align:right">
          <strong>${formatMoney(e.amount, e.currency)}</strong>
          <div class="muted">≈ ${formatMoney(convertAmount(e.amount, e.currency, e.currency === "USD" ? "CNY" : "USD", rate), e.currency === "USD" ? "CNY" : "USD")}</div>
          <button class="btn btn-sm btn-ghost" data-del-exp="${e.id}">✕</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty">Нет расходов</div>`;

    $("#income-list").innerHTML = s.budget.income
      .map(
        (i) => `
      <div class="list-row">
        <div>
          <div>${esc(i.name)}</div>
          <div class="muted">${i.date || ""}</div>
        </div>
        <div style="text-align:right">
          <strong>${formatMoney(i.amount, i.currency)}</strong>
          <button class="btn btn-sm btn-ghost" data-del-inc="${i.id}">✕</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty">Нет доходов</div>`;

    $("#subs-list").innerHTML = s.subscriptions
      .map((sub) => {
        const days = daysUntil(sub.renewDate);
        const urgent = days !== null && days <= 3;
        const label =
          days === null
            ? "—"
            : days < 0
              ? `${Math.abs(days)} дн. просрочено`
              : days === 0
                ? "Сегодня"
                : `${days} дн.`;
        return `
        <div class="sub-card ${urgent ? "urgent" : ""}">
          <div>
            <div style="font-weight:650">${esc(sub.name)}</div>
            <div class="muted">${formatMoney(sub.price, sub.currency)} · до ${sub.renewDate || "—"}</div>
            <div class="btn-row" style="margin-top:8px">
              <button class="btn btn-sm" data-edit-sub="${sub.id}">Изменить</button>
              <button class="btn btn-sm btn-ghost" data-del-sub="${sub.id}">✕</button>
            </div>
          </div>
          <div style="text-align:right">
            <div class="countdown">${label}</div>
            <div class="muted">до платежа</div>
          </div>
        </div>`;
      })
      .join("") || `<div class="empty">Нет подписок</div>`;
  }

  function bindBudget() {
    $("#btn-add-exp").onclick = () => {
      const name = $("#exp-name").value.trim();
      const amount = Number($("#exp-amount").value);
      const currency = $("#exp-cur").value;
      const category = $("#exp-cat")?.value || "ai";
      if (!name || !amount) return toast("Заполните расход");
      updateState((st) => {
        st.budget.expenses.push({
          id: uid("exp"),
          name,
          amount,
          currency,
          category,
          date: todayISO(),
        });
      });
      $("#exp-name").value = "";
      $("#exp-amount").value = "";
      toast("Расход добавлен");
    };

    $("#btn-add-inc").onclick = () => {
      const name = $("#inc-name").value.trim() || "YouTube";
      const amount = Number($("#inc-amount").value);
      const currency = $("#inc-cur").value;
      const category = $("#inc-cat")?.value || "income";
      if (!amount && amount !== 0) return toast("Укажите сумму");
      updateState((st) => {
        st.budget.income.push({
          id: uid("inc"),
          name,
          amount,
          currency,
          category,
          date: todayISO(),
        });
      });
      $("#inc-amount").value = "";
      toast("Доход добавлен");
    };

    $("#expense-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-exp]");
      if (!btn) return;
      updateState((st) => {
        st.budget.expenses = st.budget.expenses.filter((x) => x.id !== btn.dataset.delExp);
      });
    });

    $("#income-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-inc]");
      if (!btn) return;
      updateState((st) => {
        st.budget.income = st.budget.income.filter((x) => x.id !== btn.dataset.delInc);
      });
    });

    $("#subs-list").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-sub]");
      const edit = e.target.closest("[data-edit-sub]");
      if (del) {
        if (!confirm("Удалить подписку?")) return;
        updateState((st) => {
          st.subscriptions = st.subscriptions.filter((x) => x.id !== del.dataset.delSub);
        });
      }
      if (edit) {
        openSubEditModal(edit.dataset.editSub);
      }
    });

    $("#btn-add-sub").onclick = () => {
      const name = $("#sub-name").value.trim();
      const renewDate = $("#sub-date").value;
      const price = Number($("#sub-price").value) || 0;
      const currency = $("#sub-cur").value;
      if (!name || !renewDate) return toast("Укажите название и дату");
      updateState((st) => {
        st.subscriptions.push({
          id: uid("sub"),
          name,
          renewDate,
          price,
          currency,
          critical: /ip|proxy|iproyal/i.test(name),
        });
      });
      $("#sub-name").value = "";
      $("#sub-date").value = "";
      $("#sub-price").value = "";
      toast("Подписка добавлена");
    };
  }

  /* ===================== PROMPTS ===================== */
  const YT_US_FACTORY_PRESETS = [
    {
      id: "yt-us-factory-01",
      title: "01. Оценка ниши (US Tier-1 RPM)",
      category: "youtube-завод",
      tags: ["youtube-завод", "ниша", "us"],
      text: "Я хочу запустить американский YouTube-канал без лица в стиле минималистичной белой доски и 2D-персонажа в нише: [НИША]. Оцени нишу для рынка США по 5 факторам от 1 до 10: 1) Потолок дохода (RPM в США, спонсоры, партнёрки); 2) Объём поискового спроса (хватит ли тем на 2–3 видео в неделю); 3) Конкуренция; 4) Долговечность (вечнозелёный или тренды); 5) Сложность анимации. В конце дай итог из 50, вердикт в одну строку, главный риск и один незанятый угол для старта.",
    },
    {
      id: "yt-us-factory-02",
      title: "02. ДНК конкурента (Разбор формулы)",
      category: "youtube-завод",
      tags: ["youtube-завод", "конкурент", "us"],
      text: "Проанализируй американский YouTube-канал: [НАЗВАНИЕ/ССЫЛКА]. Вытащи формулу: 1) Средняя длина видео, темп смены кадров и структура от начала до конца; 2) Формула названий (разбери 10 топ-видео и повторяющиеся триггеры); 3) Стратегия обложек (цвета, главный объект, текст, эмоция); 4) Главный пробел — тема, которую зрители просят в комментариях, но автор не даёт.",
    },
    {
      id: "yt-us-factory-03",
      title: "03. Генератор названий (High CTR US)",
      category: "youtube-завод",
      tags: ["youtube-завод", "названия", "ctr"],
      text: "Напиши 10 кликабельных названий на естественном американском английском (строго без штампов ИИ) + перевод на русский для видео на тему: [КОНЦЕПЦИЯ ВИДЕО]. Микс: 2 с разрывом любопытства, 3 списка с цифрами, 2 с высокими ставками, 1 история кейса и 2 контрастных. Длина 6–12 слов, минимум 3 начинаются с цифры. Выбери 1 лучшее, объясни почему победит по CTR и опиши обложку.",
    },
    {
      id: "yt-us-factory-04",
      title: "04. Хук на первую минуту (0–60 сек)",
      category: "youtube-завод",
      tags: ["youtube-завод", "хук", "сценарий"],
      text: "Напиши первые 60 секунд закадрового сценария на разговорном американском английском (+ перевод на русский) для видео: [НАЗВАНИЕ]. Строго без клише ИИ (запрещены delve, unlock, game-changer, tapestry). Структура: 0–5 сек — самый сильный факт под обложку (без приветствий); 5–20 сек — усиление цифрой/поворотом; 20–40 сек — план, что зритель узнает к концу; 40–60 сек — второй мини-хук.",
    },
    {
      id: "yt-us-factory-05",
      title: "05. Полный сценарий + Раскадровка доски",
      category: "youtube-завод",
      tags: ["youtube-завод", "сценарий", "раскадровка"],
      text: "Напиши полный сценарий на 8 минут на разговорном американском английском (+ перевод на русский) для видео: [НАЗВАНИЕ]. Без воды и штампов ИИ. 4 фазы: 0–1 мин хук; 1–3 мин завязка и риск/выгода зрителя; 3–7 мин основная часть с поворотом в середине и мини-хуком каждые 90 сек; 7–8 мин развязка и неожиданный финальный факт без просьб подписаться. Пиши для уха, а не для глаза: кульминацию и самый сильный поворот ставь на отметке 70% длительности видео, а в конце мягко переводи зрителя на следующую смежную тему. Разбей на блоки по 10–15 сек и в [VISUAL: ...] укажи, что рисовать на белой доске и какую эмоцию показать 2D-персонажу.",
    },
    {
      id: "yt-us-factory-06",
      title: "06. ТЗ на обложку + Промт для 即梦AI",
      category: "youtube-завод",
      tags: ["youtube-завод", "обложка", "jimeng"],
      text: "Составь ТЗ на обложку для YouTube-видео: [НАЗВАНИЕ]. Укажи: 1) Фон и контраст; 2) Главный объект и масштаб; 3) Текст на обложке (2–4 слова на английском); 4) Главную эмоцию и палитру из 2–3 цветов с HEX-кодами; 5) 2 A/B-варианта. В конце напиши готовый промт на английском и китайском языке для генерации этой обложки в 即梦AI (Jimeng AI) в формате 16:9.",
    },
    {
      id: "yt-us-factory-07",
      title: "07. Адаптация текста под озвучку (Edge-TTS)",
      category: "youtube-завод",
      tags: ["youtube-завод", "озвучка", "edge-tts"],
      text: "Подготовь мой английский сценарий для озвучки через Edge-TTS (голос en-US-AndrewNeural): 1) Убери все [VISUAL: ...], оставив чистый текст диктора; 2) Замени все числа, проценты, даты и сокращения на слова ($1,500 -> fifteen hundred dollars); 3) Расставь короткие паузы через запятые и многоточия перед важными фактами.",
    },
    {
      id: "yt-us-factory-08",
      title: "08. Маскот-персонаж для 即梦AI (6 эмоций)",
      category: "youtube-завод",
      tags: ["youtube-завод", "маскот", "jimeng"],
      text: "Создай мастер-промт на английском и китайском для 即梦AI (Jimeng AI), чтобы сгенерировать 2D-персонажа моего канала в стиле минималистичной векторной графики на белом фоне (#FFFFFF) с жирным чёрным контуром (стиль After Skool). Выдай 6 промтов с сохранением внешности для 6 эмоций: 1) Объясняет у схемы; 2) Удивлён; 3) Предупреждает; 4) Задумался; 5) Радуется; 6) Показывает на ошибку / крестик.",
    },
    {
      id: "yt-us-factory-09",
      title: "09. Сборка ролика в Claude Code + Remotion",
      category: "youtube-завод",
      tags: ["youtube-завод", "remotion", "код"],
      text: "У меня есть voiceover.mp3, таймкоды субтитров и сценарий с [VISUAL: ...]. Напиши модульный код на React + TypeScript для Remotion (1920x1080, 30 fps) в стиле белой доски (#FFFFFF): плавное рукописное появление текста, стрелки, графики, выделение цифр жёлтым маркером и смена спрайтов 2D-персонажа из public/mascot/ строго по таймкодам аудио.",
    },
    {
      id: "yt-us-factory-10",
      title: "10. SEO-пакет США (Описание, Теги, Комментарий)",
      category: "youtube-завод",
      tags: ["youtube-завод", "seo", "us"],
      text: "Подготовь SEO-упаковку на американском английском для видео: [НАЗВАНИЕ]. Выдай: 1) Первые 2 строки описания с ключами США; 2) Таймкоды глав (Chapters); 3) 15 поисковых тегов США; 4) Вовлекающий вопрос для закреплённого комментария.",
    },
    {
      id: "yt-us-factory-11",
      title: "11. Контент-план на 30 дней (Стратегия старта)",
      category: "youtube-завод",
      tags: ["youtube-завод", "план", "стратегия"],
      text: "Составь план выкладки на 30 дней (3 видео в неделю = 12 видео) для нового канала в нише: [НИША]. Первые 4 видео раскрывают тему канала, далее чередуй вечнозелёный поиск США и виральные темы. Укажи день, название (+ перевод), формат, главный запрос и задачу. Выдели 1 ролик с лучшим шансом на залёт.",
    },
    {
      id: "yt-us-factory-12",
      title: "12. Доктор удержания (Разбор аналитики)",
      category: "youtube-завод",
      tags: ["youtube-завод", "аналитика", "удержание"],
      text: "Вот статистика моего видео из YouTube Studio (CTR, средняя длительность, точки падения графика удержания): [ВСТАВИТЬ ЦИФРЫ]. Разбери: 1) Почему зрители ушли в этих точках; 2) Стоит ли менять название/обложку; 3) Дай 3 конкретных правила для следующего ролика.",
    },
    {
      id: "yt-us-factory-13",
      title: "13. Нарезка 3 YouTube Shorts из длинного видео",
      category: "youtube-завод",
      tags: ["youtube-завод", "shorts", "нарезка"],
      text: "Возьми мой 8-минутный сценарий: [СЦЕНАРИЙ]. Выдели 3 острых отрывка по 40–50 сек для вертикальных YouTube Shorts (1080x1920), переливающих зрителей на длинное видео. Для каждого напиши: 1) Фразу-крючок (0–3 сек); 2) Текст на американском английском + перевод; 3) Финальную связку-переход на основной ролик.",
    },
    {
      id: "yt-us-factory-14",
      title: "14. Нативная реклама / Спонсорская вставка (Ad Read)",
      category: "youtube-завод",
      tags: ["youtube-завод", "реклама", "спонсор"],
      text: "Вплети в середину сценария (на 3-й минуте) 45-секундную нативную рекламу продукта: [НАЗВАНИЕ И СУТЬ]. Сделай плавный мостик от темы видео к решению проблемы через продукт (на разговорном американском английском + перевод), чтобы зрители не перематывали.",
    },
    {
      id: "yt-us-factory-15",
      title: "15. Умный Арт-директор Remotion (Автовыбор стиля)",
      category: "youtube-завод",
      tags: ["youtube-завод", "remotion", "стиль"],
      text: "Проанализируй тему и сценарий моего ролика: [ВСТАВИТЬ ТЕМУ ИЛИ СЦЕНАРИЙ]. Самостоятельно выбери самый подходящий визуальный стиль из 4 вариантов под психологию американской аудитории этой ниши:\n1) Финансы, деньги, технологии, психология или тайны -> «Белые и неоновые линии (#00F0FF) на глубоком чёрном фоне (#0A0A0A)» (эффект премиальной аналитики);\n2) Сложные схемы, графики роста, разборы ошибок или пошаговые стратегии -> «Светящийся скетч-маркер на тёмном стекле (#0D1117)»;\n3) Обучение, наука, история, разбор книг или гайды -> «Мел на тёмно-зелёной грифельной доске (#14281D) с текстурой меловой линии и жёлтыми акцентами»;\n4) Широкие истории, сравнения, лайфхаки или динамичный сторителлинг -> «Плоский вектор на чистом белом фоне (#FFFFFF) с жирным чёрным контуром (стиль After Skool)».\n\nСначала в 2 строках объясни, почему выбрал именно этот стиль для данного ролика (если я не указал свой вариант принудительно), а затем создай единый файл темы и стилей для Remotion (1920x1080, 30 fps): палитру цветов, шрифты, плавные SVG-анимации рисования линий и адаптацию контраста для всех сцен.",
    },
    {
      id: "yt-us-factory-16",
      title: "16. Поиск узкой подниши с голодной аудиторией",
      category: "youtube-завод",
      tags: ["youtube-завод", "подниша", "стратегия"],
      text: "Действуй как стратег американского YouTube без лица. Я хочу построить канал вокруг широкой темы: [ШИРОКАЯ ТЕМА]. Дай 5 конкретных узких подниш внутри неё для рынка США, где есть голодная аудитория и слабая конкуренция. По каждой покажи: 1) Ядро зрителя; 2) 3 запроса, которые они ищут чаще всего; 3) 2 американских канала, которые там уже выигрывают. Отранжируй все 5 по скорости роста нового канала в стиле белой доски / 2D-анимации и назови 1 лучшую поднишу с аргументами.",
    },
    {
      id: "yt-us-factory-17",
      title: "17. Банк на 30 идей с таблицей оценок",
      category: "youtube-завод",
      tags: ["youtube-завод", "идеи", "оценка"],
      text: "Собери систему оценки идей для американского YouTube-канала в нише: [НИША]. Оценивай каждую идею от 1 до 10 по 4 факторам: 1) Любопытство (разрыв знаний); 2) Ясность с 1-й секунды; 3) Размер аудитории США; 4) Простота визуализации на белой доске. Сгенерируй 30 идей видео на английском (+ перевод на русский), оцени каждую в таблице, отсортируй от лучших к худшим и назови 5 идей, которые нужно снимать первыми.",
    },
  ];
  const YT_US_FACTORY_IDS = new Set(YT_US_FACTORY_PRESETS.map((p) => p.id));

  function clonePreset(p) {
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      tags: [...(p.tags || [])],
      text: p.text,
      presetPack: "yt-us-factory",
    };
  }

  function matchPromptQuery(p, q) {
    if (!q) return true;
    const tags = (p.tags || []).join(" ");
    return `${p.title} ${p.category || ""} ${tags} ${p.text}`.toLowerCase().includes(q);
  }

  /** Добавляет отсутствующие пресеты и синхронизирует текст/заголовок встроенного пакета; личные не трогает. */
  function ensureYtFactoryPresets() {
    if (!isUnlocked()) return;
    const have = new Map((getState().prompts || []).map((p) => [p.id, p]));
    const missing = [];
    const outdated = [];
    YT_US_FACTORY_PRESETS.forEach((preset) => {
      const cur = have.get(preset.id);
      if (!cur) missing.push(preset);
      else if (cur.title !== preset.title || cur.text !== preset.text) outdated.push(preset);
    });
    if (!missing.length && !outdated.length) return;
    updateState((st) => {
      if (!st.prompts) st.prompts = [];
      outdated.forEach((preset) => {
        const i = st.prompts.findIndex((p) => p.id === preset.id);
        if (i >= 0) st.prompts[i] = clonePreset(preset);
      });
      missing
        .slice()
        .reverse()
        .forEach((p) => st.prompts.unshift(clonePreset(p)));
    });
  }

  /** Перезаписывает только id пакета; личные промты не удаляет. */
  function restoreYtFactoryPresets() {
    updateState((st) => {
      if (!st.prompts) st.prompts = [];
      YT_US_FACTORY_PRESETS.forEach((preset) => {
        const i = st.prompts.findIndex((p) => p.id === preset.id);
        const next = clonePreset(preset);
        if (i >= 0) st.prompts[i] = next;
        else st.prompts.unshift(next);
      });
    });
    toast("Пресеты восстановлены");
  }

  function promptCardHtml(p, { preset = false } = {}) {
    return `
      <div class="prompt-card${preset ? " is-preset" : ""}">
        <div class="block-head" style="margin-bottom:6px">
          <h4>${esc(p.title)}</h4>
          <span class="chip">${esc((p.tags || [p.category]).filter(Boolean).join(", "))}</span>
        </div>
        <pre>${esc(p.text)}</pre>
        <div class="btn-row">
          <button type="button" class="btn btn-primary btn-sm" data-copy="${esc(p.id)}">Скопировать</button>
          ${
            preset
              ? ""
              : `<button type="button" class="btn btn-sm" data-edit-prompt="${esc(p.id)}">Изменить</button>
          <button type="button" class="btn btn-sm btn-ghost" data-del-prompt="${esc(p.id)}">Удалить</button>`
          }
        </div>
      </div>`;
  }

  function findPromptById(id) {
    return (
      (getState().prompts || []).find((x) => x.id === id) ||
      YT_US_FACTORY_PRESETS.find((x) => x.id === id) ||
      null
    );
  }

  function renderPrompts() {
    ensureYtFactoryPresets();
    const s = getState();
    const q = (promptQuery || ($("#prm-search")?.value || "")).trim().toLowerCase();
    const all = s.prompts || [];

    const pack = YT_US_FACTORY_PRESETS.map((base) => {
      const saved = all.find((p) => p.id === base.id);
      return saved || clonePreset(base);
    }).filter((p) => matchPromptQuery(p, q));

    const personal = all
      .filter((p) => !YT_US_FACTORY_IDS.has(p.id))
      .filter((p) => matchPromptQuery(p, q));

    const packRoot = $("#preset-pack-list");
    if (packRoot) {
      packRoot.innerHTML =
        pack.map((p) => promptCardHtml(p, { preset: true })).join("") ||
        `<div class="empty">Ничего не найдено в пакете</div>`;
    }

    $("#prompt-list").innerHTML =
      personal.map((p) => promptCardHtml(p, { preset: false })).join("") ||
      `<div class="empty">${q ? "Ничего не найдено" : "Пока нет личных промтов — добавьте ниже"}</div>`;

    const items = [
      ["hook", "Хук 0–12 сек"],
      ["thumbnail", "Обложка (thumbnail)"],
      ["subtitles", "Субтитры"],
      ["hashtags", "Хештеги"],
      ["endScreen", "Конечная заставка"],
      ["description", "Описание + таймкоды"],
    ];
    const pc = s.publishChecklist;
    const done = items.filter(([k]) => pc[k]).length;
    $("#publish-check").innerHTML = `
      <div class="muted" style="margin-bottom:8px">Готовность: ${done}/${items.length}</div>
      <div class="check-grid">
        ${items
          .map(
            ([k, label]) => `
          <label class="check-item">
            <input type="checkbox" data-pc="${k}" ${pc[k] ? "checked" : ""}>
            <span>${label}</span>
          </label>`
          )
          .join("")}
      </div>
    `;
  }

  function bindPrompts() {
    $("#prm-search")?.addEventListener("input", () => {
      promptQuery = $("#prm-search").value;
      renderPrompts();
    });

    $("#btn-restore-presets")?.addEventListener("click", () => {
      restoreYtFactoryPresets();
    });

    const onPromptClick = async (e) => {
      const copy = e.target.closest("[data-copy]");
      const del = e.target.closest("[data-del-prompt]");
      const edit = e.target.closest("[data-edit-prompt]");
      if (copy) {
        const p = findPromptById(copy.dataset.copy);
        if (!p) return;
        try {
          await navigator.clipboard.writeText(p.text);
          toast("Скопировано!");
        } catch {
          toast("Не удалось скопировать");
        }
      }
      if (del) {
        if (YT_US_FACTORY_IDS.has(del.dataset.delPrompt)) return;
        updateState((st) => {
          st.prompts = st.prompts.filter((x) => x.id !== del.dataset.delPrompt);
        });
      }
      if (edit) {
        if (YT_US_FACTORY_IDS.has(edit.dataset.editPrompt)) return;
        const p = getState().prompts.find((x) => x.id === edit.dataset.editPrompt);
        if (!p) return;
        const title = prompt("Название", p.title);
        if (title == null) return;
        const tags = prompt("Теги через запятую", (p.tags || []).join(", "));
        if (tags == null) return;
        const text = prompt("Текст промта", p.text);
        if (text == null) return;
        updateState((st) => {
          const cur = st.prompts.find((x) => x.id === p.id);
          if (!cur) return;
          cur.title = title.trim() || cur.title;
          cur.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
          cur.category = cur.tags[0] || cur.category || "custom";
          cur.text = text;
        });
        toast("Промт обновлён");
      }
    };

    $("#preset-pack-list")?.addEventListener("click", onPromptClick);
    $("#prompt-list").addEventListener("click", onPromptClick);

    $("#publish-check").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.matches("[data-pc]")) return;
      updateState((st) => {
        st.publishChecklist[t.dataset.pc] = t.checked;
      });
    });

    $("#btn-add-prompt").onclick = () => {
      const title = $("#prm-title").value.trim();
      const text = $("#prm-text").value.trim();
      const tags = ($("#prm-cat").value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (!title || !text) return toast("Заполните название и текст");
      updateState((st) => {
        st.prompts.push({
          id: uid("prm"),
          title,
          text,
          tags,
          category: tags[0] || "custom",
        });
      });
      $("#prm-title").value = "";
      $("#prm-text").value = "";
      $("#prm-cat").value = "";
      toast("Промт добавлен");
    };
  }

  /* ===================== SETTINGS ===================== */
  function renderSettings() {
    const c = getGithubCreds();
    $("#gh-token").value = c.token || "";
    $("#gh-owner").value = c.owner || "";
    $("#gh-repo").value = c.repo || "";
    if ($("#ntfy-topic")) $("#ntfy-topic").value = getNtfyTopic();
    $("#settings-updated").textContent = getState().updatedAt
      ? `Последнее обновление state: ${new Date(getState().updatedAt).toLocaleString("ru-RU")}`
      : "";
  }

  function bindSettings() {
    $("#btn-save-gh").onclick = async () => {
      setGithubCreds({
        token: $("#gh-token").value.trim(),
        owner: $("#gh-owner").value.trim(),
        repo: $("#gh-repo").value.trim(),
      });
      if ($("#ntfy-topic")) setNtfyTopic($("#ntfy-topic").value.trim());
      try {
        await window.CC.persistLocal();
      } catch (_) {
        /* vault may be locked — localStorage уже обновлён */
      }
      toast("Учётные данные и ntfy topic сохранены");
      window.CC.setSyncStatus(getGithubCreds().token ? "ok" : "idle");
    };

    if ($("#btn-ntfy-test")) {
      $("#btn-ntfy-test").onclick = async () => {
        if ($("#ntfy-topic")) setNtfyTopic($("#ntfy-topic").value.trim());
        const r = await sendNtfyTestPush();
        if (r.ok) toast("Тестовый пуш отправлен — проверьте iPhone");
        else if (r.reason === "no-topic") toast("Сначала укажите ntfy topic");
        else toast(`Ошибка пуша: ${r.reason || "сеть"}`);
      };
    }

        $("#btn-push").onclick = async () => {
      try {
        setGithubCreds({
          token: $("#gh-token").value.trim(),
          owner: $("#gh-owner").value.trim(),
          repo: $("#gh-repo").value.trim(),
        });
        if ($("#ntfy-topic")) setNtfyTopic($("#ntfy-topic").value.trim());
        await pushToGithub(true);
        toast("Зашифрованный state отправлен");
      } catch (e) {
        toast(e.message || "Ошибка push");
      }
    };

    $("#btn-pull").onclick = async () => {
      try {
        setGithubCreds({
          token: $("#gh-token").value.trim(),
          owner: $("#gh-owner").value.trim(),
          repo: $("#gh-repo").value.trim(),
        });
        await pullFromGithub();
        toast("Загружено и расшифровано");
      } catch (e) {
        toast(e.message || "Ошибка pull");
      }
    };

    $("#btn-change-pin").onclick = async () => {
      try {
        await changePassword(
          $("#pin-old").value,
          $("#pin-new").value,
          $("#pin-new2").value
        );
        $("#pin-old").value = "";
        $("#pin-new").value = "";
        $("#pin-new2").value = "";
        toast("PIN/пароль изменён — не забудьте обновить секрет APP_PASSWORD");
      } catch (e) {
        toast(e.message || "Не удалось сменить пароль");
      }
    };

    $("#btn-lock").onclick = () => {
      lockApp();
      showLockScreen();
    };
  }

  function showLockScreen() {
    const gate = $("#lock-gate");
    const app = $("#app-root");
    gate.hidden = false;
    app.classList.add("app-blurred");
    app.setAttribute("aria-hidden", "true");

    const mode = getAuthMode();
    const title = $("#lock-title");
    const sub = $("#lock-sub");
    const setupFields = $("#lock-setup-fields");
    const loginFields = $("#lock-login-fields");
    const err = $("#lock-error");
    err.textContent = "";

    if (mode === "setup" || mode === "migrate") {
      title.textContent = mode === "migrate" ? "Защитите данные PIN-кодом" : "Создайте PIN / пароль";
      sub.textContent =
        mode === "migrate"
          ? "Старый plaintext будет зашифрован AES-GCM перед отправкой на GitHub. Тот же пароль укажите в секрете APP_PASSWORD."
          : "Этот PIN шифрует data/state.json. Укажите его же в GitHub Secret APP_PASSWORD для бота (ntfy).";
      setupFields.hidden = false;
      loginFields.hidden = true;
      $("#lock-pass1")?.focus();
    } else {
      title.textContent = "Вход в Command Center";
      sub.textContent = "Введите личный PIN или пароль для расшифровки данных.";
      setupFields.hidden = true;
      loginFields.hidden = false;
      $("#lock-pass")?.focus();
    }
  }

  function hideLockScreen() {
    $("#lock-gate").hidden = true;
    $("#app-root").classList.remove("app-blurred");
    $("#app-root").removeAttribute("aria-hidden");
  }

  function bindLockScreen() {
    $("#lock-form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#lock-error");
      err.textContent = "";
      const btn = $("#lock-btn-login");
      btn.disabled = true;
      try {
        await unlockWithPassword($("#lock-pass").value);
        $("#lock-pass").value = "";
        hideLockScreen();
        renderAll();
        toast("Данные расшифрованы");
      } catch (ex) {
        err.textContent = ex.message || "Ошибка входа";
      } finally {
        btn.disabled = false;
      }
    });

    $("#lock-form-setup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#lock-error");
      err.textContent = "";
      const btn = $("#lock-btn-setup");
      btn.disabled = true;
      try {
        await setupPassword($("#lock-pass1").value, $("#lock-pass2").value);
        $("#lock-pass1").value = "";
        $("#lock-pass2").value = "";
        hideLockScreen();
        renderAll();
        toast("Шифрование включено");
      } catch (ex) {
        err.textContent = ex.message || "Ошибка настройки";
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* -------- Full re-render -------- */
  function renderAll() {
    renderYoutube();
    renderFocus();
    renderBudget();
    renderPrompts();
    renderSettings();
  }

  async function boot() {
    initTabs();
    initSyncPill();
    bindKanbanChecks();
    bindFocus();
    bindBudget();
    bindPrompts();
    bindSettings();
    bindLockScreen();

    $("#btn-add-video").onclick = () => openVideoModal(null);
    $("#header-lock").onclick = () => {
      lockApp();
      showLockScreen();
    };
    $("#cal-prev").onclick = () => {
      calMonth.setMonth(calMonth.getMonth() - 1);
      renderCalendar();
    };
    $("#cal-next").onclick = () => {
      calMonth.setMonth(calMonth.getMonth() + 1);
      renderCalendar();
    };
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") closeModal();
    });

    onChange(() => {
      if (isUnlocked()) renderAll();
    });
    onAuth(({ unlocked: ok }) => {
      if (!ok) showLockScreen();
      else hideLockScreen();
    });

    try {
      await loadVaultMeta();
    } catch (e) {
      $("#lock-error").textContent = e.message || "Ошибка загрузки хранилища";
      showLockScreen();
      return;
    }

    const auto = await tryAutoUnlock();
    if (auto) {
      hideLockScreen();
      renderAll();
    } else {
      showLockScreen();
    }

    const creds = getGithubCreds();
    if (creds.token && creds.owner && creds.repo && isUnlocked()) {
      window.CC.setSyncStatus("ok");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
