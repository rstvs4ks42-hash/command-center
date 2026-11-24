(() => {
  const {
    STAGES,
    STAGE_CHECK,
    uid,
    todayISO,
    daysUntil,
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
    pushToGithub,
    pullFromGithub,
    onSyncStatus,
    onChange,
    onAuth,
    convertAmount,
  } = window.CC;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let calMonth = null; // Date at month start
  let selectedCalDay = null;
  let editingVideoId = null;
  let editingEventId = null;

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
    const subPct = Math.min(100, (m.subscribers / m.subscribersGoal) * 100);
    const hoursPct = Math.min(100, (m.watchHours / m.watchHoursGoal) * 100);
    const subLeft = Math.max(0, m.subscribersGoal - m.subscribers);
    const hoursLeft = Math.max(0, m.watchHoursGoal - m.watchHours);

    $("#thermo").innerHTML = `
      <div class="thermo">
        <div class="thermo-row">
          <div class="thermo-meta">
            <span>Подписчики</span>
            <strong>${m.subscribers.toLocaleString("ru-RU")} / ${m.subscribersGoal.toLocaleString("ru-RU")}</strong>
          </div>
          <div class="bar"><i style="width:${subPct}%"></i></div>
          <div class="muted">Осталось ${subLeft.toLocaleString("ru-RU")} до цели 1 000</div>
        </div>
        <div class="thermo-row">
          <div class="thermo-meta">
            <span>Часы просмотра</span>
            <strong>${m.watchHours.toLocaleString("ru-RU")} / ${m.watchHoursGoal.toLocaleString("ru-RU")}</strong>
          </div>
          <div class="bar"><i style="width:${hoursPct}%"></i></div>
          <div class="muted">Осталось ${hoursLeft.toLocaleString("ru-RU")} ч до цели 4 000</div>
        </div>
        <div class="inline-fields">
          <div class="field">
            <label>Текущие подписчики</label>
            <input type="number" id="inp-subs" min="0" value="${m.subscribers}">
          </div>
          <div class="field">
            <label>Часы просмотра</label>
            <input type="number" id="inp-hours" min="0" step="0.1" value="${m.watchHours}">
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
      card.addEventListener("click", () => openVideoModal(card.dataset.id));
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

  function videoCardHtml(v) {
    const fmt = v.format === "shorts" ? "Shorts" : "Long 8–10 мин";
    const virClass = v.virality >= 70 ? "hot" : v.virality >= 45 ? "good" : "warn";
    const checks = [
      ["idea", "Идея"],
      ["script", "Сценарий"],
      ["images", "Картинки"],
      ["edit", "Монтаж"],
      ["publish", "Публикация"],
    ];
    return `
      <div class="card" data-id="${v.id}">
        <p class="card-title">${esc(v.title)}</p>
        <div class="card-meta">
          <span class="chip">${fmt}</span>
          <span class="chip ${virClass}">🔥 ${v.virality}%</span>
          ${v.publishDate ? `<span class="chip">${v.publishDate}</span>` : ""}
        </div>
        <div class="mini-check">
          ${checks
            .map(
              ([k, label]) => `
            <label onclick="event.stopPropagation()">
              <input type="checkbox" data-vid="${v.id}" data-key="${k}" ${v.checklist?.[k] ? "checked" : ""}>
              ${label}
            </label>`
            )
            .join("")}
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
        <div class="field">
          <label>Промты / заметки</label>
          <textarea id="v-notes" placeholder="Промты для 即梦AI, идеи хука…">${esc(v?.notes || "")}</textarea>
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
      };
      updateState((st) => {
        if (editingVideoId) {
          const cur = st.videos.find((x) => x.id === editingVideoId);
          Object.assign(cur, payload);
        } else {
          st.videos.push({
            id: uid("vid"),
            checklist: { idea: true, script: false, images: false, edit: false, publish: false },
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
          <div class="cal-item-title">${esc(ev.title)}</div>
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
    $("#ev-save").onclick = () => {
      const title = $("#ev-title").value.trim();
      const note = $("#ev-note").value.trim();
      const date = $("#ev-date").value;
      const col = $("#ev-color").value || "blue";
      if (!title) return toast("Укажите заголовок");
      if (!date) return toast("Укажите дату");
      updateState((st) => {
        if (!st.calendarEvents) st.calendarEvents = [];
        if (editingEventId) {
          const cur = st.calendarEvents.find((x) => x.id === editingEventId);
          if (cur) Object.assign(cur, { title, note, date, color: col });
        } else {
          st.calendarEvents.push({
            id: uid("cev"),
            date,
            title,
            note,
            color: col,
          });
        }
      });
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
          const yesterday = (() => {
            const d = new Date(today + "T00:00:00");
            d.setDate(d.getDate() - 1);
            return d.toISOString().slice(0, 10);
          })();
          if (st.streak.lastCompleteDate === yesterday) {
            st.streak.current += 1;
          } else {
            st.streak.current = 1;
          }
          st.streak.lastCompleteDate = today;
          st.streak.best = Math.max(st.streak.best || 0, st.streak.current);
        }
      } else if (st.streak.lastCompleteDate === today) {
        // unchecked — undo today's completion
        const yesterday = (() => {
          const d = new Date(today + "T00:00:00");
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        })();
        st.streak.lastCompleteDate = st.streak.current > 1 ? yesterday : null;
        st.streak.current = Math.max(0, st.streak.current - 1);
      }
    });
  }

  function renderFocus() {
    const s = getState();
    const habits = s.habits.filter((h) => !h.archived);
    const doneCount = habits.filter((h) => habitDoneToday(h.id)).length;
    const pct = habits.length ? Math.round((doneCount / habits.length) * 100) : 0;
    const todayDone = allHabitsDoneToday();

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

    $("#habit-list").innerHTML = habits
      .map(
        (h) => `
      <div class="habit-item ${habitDoneToday(h.id) ? "done" : ""}">
        <input type="checkbox" data-habit="${h.id}" ${habitDoneToday(h.id) ? "checked" : ""}>
        <span class="grow">${esc(h.name)}</span>
        <button class="btn btn-sm btn-ghost" data-del-habit="${h.id}" title="Удалить">✕</button>
      </div>`
      )
      .join("") || `<div class="empty">Добавьте привычки</div>`;

    const today = todayISO();
    const tasks = s.tasks.filter((t) => t.date === today || (!t.done && !t.date));
    const prioOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9));

    $("#task-list").innerHTML = tasks
      .map(
        (t) => `
      <div class="task-item ${t.done ? "done" : ""}">
        <span class="prio ${t.priority}"></span>
        <div>
          <div class="task-title">${esc(t.title)}</div>
          <div class="muted">${t.priority === "high" ? "Высокий" : t.priority === "medium" ? "Средний" : "Низкий"} приоритет</div>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" data-toggle-task="${t.id}">${t.done ? "↩" : "✓"}</button>
          <button class="btn btn-sm btn-ghost" data-del-task="${t.id}">✕</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty">Нет задач на сегодня</div>`;
  }

  function bindFocus() {
    $("#habit-list").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.matches("[data-habit]")) return;
      const today = todayISO();
      updateState((st) => {
        if (!st.habitLogs[today]) st.habitLogs[today] = {};
        st.habitLogs[today][t.dataset.habit] = t.checked;
      });
      recalcStreak();
    });

    $("#habit-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-habit]");
      if (!btn) return;
      updateState((st) => {
        st.habits = st.habits.filter((h) => h.id !== btn.dataset.delHabit);
      });
      toast("Привычка удалена");
    });

    $("#btn-add-habit").onclick = () => {
      const name = $("#new-habit").value.trim();
      if (!name) return;
      updateState((st) => {
        st.habits.push({ id: uid("hab"), name, archived: false });
      });
      $("#new-habit").value = "";
      toast("Привычка добавлена");
    };

    $("#btn-add-task").onclick = () => {
      const title = $("#new-task").value.trim();
      const priority = $("#new-task-prio").value;
      if (!title) return;
      updateState((st) => {
        st.tasks.push({
          id: uid("task"),
          title,
          priority,
          done: false,
          date: todayISO(),
        });
      });
      $("#new-task").value = "";
      toast("Задача добавлена");
    };

    $("#task-list").addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-toggle-task]");
      const del = e.target.closest("[data-del-task]");
      if (toggle) {
        updateState((st) => {
          const t = st.tasks.find((x) => x.id === toggle.dataset.toggleTask);
          if (t) t.done = !t.done;
        });
      }
      if (del) {
        updateState((st) => {
          st.tasks = st.tasks.filter((x) => x.id !== del.dataset.delTask);
        });
      }
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
        <div class="stat"><span class="label">Доходы YT</span><span class="value pos">${formatMoney(incUsd, "USD")}</span></div>
        <div class="stat"><span class="label">Чистая прибыль</span><span class="value ${profit >= 0 ? "pos" : "neg"}">${formatMoney(profit, "USD")}</span></div>
      </div>
      <div class="field" style="max-width:200px">
        <label>Курс ¥ за $1</label>
        <input type="number" id="fx-rate" step="0.01" min="0.01" value="${rate}">
      </div>
    `;
    $("#fx-rate").onchange = () => {
      updateState((st) => {
        st.budget.exchangeRate = Number($("#fx-rate").value) || 7.2;
      });
    };

    $("#expense-list").innerHTML = s.budget.expenses
      .map(
        (e) => `
      <div class="list-row">
        <div>
          <div>${esc(e.name)}</div>
          <div class="muted">${e.date || ""} · ${esc(e.category || "")}</div>
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
              <button class="btn btn-sm" data-edit-sub="${sub.id}">Дата</button>
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
      if (!name || !amount) return toast("Заполните расход");
      updateState((st) => {
        st.budget.expenses.push({
          id: uid("exp"),
          name,
          amount,
          currency,
          category: "ai",
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
      if (!amount && amount !== 0) return toast("Укажите сумму");
      updateState((st) => {
        st.budget.income.push({
          id: uid("inc"),
          name,
          amount,
          currency,
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
        updateState((st) => {
          st.subscriptions = st.subscriptions.filter((x) => x.id !== del.dataset.delSub);
        });
      }
      if (edit) {
        const next = prompt("Новая дата продления (YYYY-MM-DD):");
        if (!next) return;
        updateState((st) => {
          const sub = st.subscriptions.find((x) => x.id === edit.dataset.editSub);
          if (sub) sub.renewDate = next;
        });
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
  function renderPrompts() {
    const s = getState();
    $("#prompt-list").innerHTML = s.prompts
      .map(
        (p) => `
      <div class="prompt-card">
        <div class="block-head" style="margin-bottom:6px">
          <h4>${esc(p.title)}</h4>
          <span class="chip">${esc(p.category || "")}</span>
        </div>
        <pre>${esc(p.text)}</pre>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" data-copy="${p.id}">Скопировать в 1 клик</button>
          <button class="btn btn-sm btn-ghost" data-del-prompt="${p.id}">Удалить</button>
        </div>
      </div>`
      )
      .join("") || `<div class="empty">Библиотека пуста</div>`;

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
    $("#prompt-list").addEventListener("click", async (e) => {
      const copy = e.target.closest("[data-copy]");
      const del = e.target.closest("[data-del-prompt]");
      if (copy) {
        const p = getState().prompts.find((x) => x.id === copy.dataset.copy);
        if (!p) return;
        try {
          await navigator.clipboard.writeText(p.text);
          toast("Скопировано");
        } catch {
          toast("Не удалось скопировать");
        }
      }
      if (del) {
        updateState((st) => {
          st.prompts = st.prompts.filter((x) => x.id !== del.dataset.delPrompt);
        });
      }
    });

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
      const category = $("#prm-cat").value.trim() || "custom";
      if (!title || !text) return toast("Заполните название и текст");
      updateState((st) => {
        st.prompts.push({ id: uid("prm"), title, text, category });
      });
      $("#prm-title").value = "";
      $("#prm-text").value = "";
      toast("Промт добавлен");
    };
  }

  /* ===================== SETTINGS ===================== */
  function renderSettings() {
    const c = getGithubCreds();
    $("#gh-token").value = c.token || "";
    $("#gh-owner").value = c.owner || "";
    $("#gh-repo").value = c.repo || "";
    $("#settings-updated").textContent = getState().updatedAt
      ? `Последнее обновление state: ${new Date(getState().updatedAt).toLocaleString("ru-RU")}`
      : "";
  }

  function bindSettings() {
    $("#btn-save-gh").onclick = () => {
      setGithubCreds({
        token: $("#gh-token").value.trim(),
        owner: $("#gh-owner").value.trim(),
        repo: $("#gh-repo").value.trim(),
      });
      toast("Учётные данные сохранены в браузере");
      window.CC.setSyncStatus(getGithubCreds().token ? "ok" : "idle");
    };

    $("#btn-push").onclick = async () => {
      try {
        setGithubCreds({
          token: $("#gh-token").value.trim(),
          owner: $("#gh-owner").value.trim(),
          repo: $("#gh-repo").value.trim(),
        });
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
