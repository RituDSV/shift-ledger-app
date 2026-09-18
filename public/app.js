(function () {
  "use strict";

  const HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
  function hourLabel(h) {
    const to12 = (n) => {
      const hh = n % 12 === 0 ? 12 : n % 12;
      return hh + ":00 " + (n < 12 ? "AM" : "PM");
    };
    return { start: to12(h), end: to12(h + 1) };
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function monthStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  function fmtDateNice(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || "Something went wrong.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const state = {
    me: null,
    level: "UG",
    activeTab: null,
    dayCache: {},          // "level|date" -> { chairCount, hours }
    saveTimers: {},
    deptList: null,        // master: [{id,name,ug_chairs,pg_chairs,rep_...}]
    masterSub: "day"
  };

  // ================= Auth screen =================
  const authScreen = document.getElementById("authScreen");
  const appEl = document.getElementById("app");
  const authSub = document.getElementById("authSub");
  const loginForm = document.getElementById("loginForm");
  const setupForm = document.getElementById("setupForm");

  async function bootAuthScreen() {
    try {
      const me = await api("GET", "/api/auth/me");
      onSignedIn(me);
      return;
    } catch (e) {
      // not signed in — fall through to show login/setup
    }
    let status;
    try {
      status = await api("GET", "/api/auth/bootstrap-status");
    } catch (e) {
      status = { hasMaster: true };
    }
    if (status.hasMaster) {
      authSub.textContent = "Sign in to log or view work hours.";
      loginForm.style.display = "";
      setupForm.style.display = "none";
    } else {
      authSub.textContent = "Welcome — let's get this set up.";
      loginForm.style.display = "none";
      setupForm.style.display = "";
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";
    try {
      const me = await api("POST", "/api/auth/login", {
        username: document.getElementById("loginUsername").value,
        password: document.getElementById("loginPassword").value
      });
      onSignedIn(me);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("setupError");
    errEl.textContent = "";
    try {
      const me = await api("POST", "/api/auth/register", {
        name: document.getElementById("setupName").value,
        username: document.getElementById("setupUsername").value,
        password: document.getElementById("setupPassword").value
      });
      onSignedIn(me);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  function onSignedIn(me) {
    state.me = me;
    authScreen.style.display = "none";
    appEl.style.display = "";
    renderWho();
    renderTabsForRole();
  }

  function renderWho() {
    const isMaster = state.me.role === "master_admin";
    const roleLabel = isMaster ? "Master admin" : "Department rep";
    const roleClass = isMaster ? "master" : "rep";
    const deptBit = !isMaster ? `<span class="dept">· ${escapeHtml(state.me.department_name || "")}</span>` : "";
    document.getElementById("whoBox").innerHTML = `
      <span class="name">${escapeHtml(state.me.name)}</span>
      <span class="badge ${roleClass}">${roleLabel}</span>
      ${deptBit}
      <button class="signout-btn" id="signoutBtn">Sign out</button>`;
    document.getElementById("signoutBtn").addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      window.location.reload();
    });
  }

  // ================= Tabs =================
  const REP_TABS = [
    { id: "rep-log", label: "Log Hours" },
    { id: "rep-overview", label: "Day Overview" },
    { id: "rep-month", label: "Month Overview" }
  ];
  const MASTER_TABS = [
    { id: "master-overview", label: "Overview" },
    { id: "master-settings", label: "Settings" }
  ];

  function renderTabsForRole() {
    const isMaster = state.me.role === "master_admin";
    const tabs = isMaster ? MASTER_TABS : REP_TABS;
    const nav = document.getElementById("tabs");
    nav.innerHTML = tabs.map((t, i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
    nav.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    switchTab(tabs[0].id);
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    document.querySelectorAll("section.panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tabId));

    if (tabId === "rep-log") initRepLog();
    if (tabId === "rep-overview") initRepOverview();
    if (tabId === "rep-month") initRepMonth();
    if (tabId === "master-overview") initMasterOverview();
    if (tabId === "master-settings") loadDeptSettings();
  }

  // ================= Level toggle (shared UG/PG state) =================
  const levelToggleEls = ["repLevelToggle", "repOverviewLevelToggle", "repMonthLevelToggle", "masterLevelToggle"];

  function renderAllLevelToggles() {
    levelToggleEls.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = ["UG", "PG"].map((lv) => `<button data-level="${lv}" class="${lv === state.level ? "active" : ""}">${lv}</button>`).join("");
      el.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => setLevel(b.dataset.level));
      });
    });
  }

  function setLevel(level) {
    if (level === state.level) return;
    state.level = level;
    renderAllLevelToggles();
    switchTab(state.activeTab); // reload whatever's currently showing
  }

  // ================= Shared: fetch a day's hour×chair grid =================
  async function fetchDay(level, date, deptId) {
    const key = (deptId || "mine") + "|" + level + "|" + date;
    const url = deptId
      ? `/api/master/departments/${deptId}/day?level=${level}&date=${encodeURIComponent(date)}`
      : `/api/logs/day?level=${level}&date=${encodeURIComponent(date)}`;
    const data = await api("GET", url);
    state.dayCache[key] = data;
    return data;
  }

  // ================= REP: Log Hours (single hour + chairs form) =================
  const repDateInput = document.getElementById("repDate");
  const repHourSelect = document.getElementById("repHour");
  let repInited = false;

  function initRepLog() {
    renderAllLevelToggles();
    if (!repInited) {
      repInited = true;
      repDateInput.value = todayStr();
      repDateInput.max = todayStr();
      repHourSelect.innerHTML = HOURS.map((h) => {
        const l = hourLabel(h);
        return `<option value="${h}">${l.start} \u2013 ${l.end}</option>`;
      }).join("");
      repDateInput.addEventListener("change", loadRepLog);
      repHourSelect.addEventListener("change", renderRepChairs);
    }
    loadRepLog();
  }

  async function loadRepLog() {
    const wrap = document.getElementById("repChairs");
    wrap.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      await fetchDay(state.level, repDateInput.value);
      renderRepChairs();
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderRepChairs() {
    const date = repDateInput.value;
    const key = "mine|" + state.level + "|" + date;
    const data = state.dayCache[key];
    const wrap = document.getElementById("repChairs");
    if (!data) return;

    const hour = Number(repHourSelect.value);
    const chairCount = data.chairCount;
    const hourData = data.hours[hour] || {};

    if (!chairCount) {
      wrap.innerHTML = `<div class="empty-state">This department has no ${state.level} chairs configured yet. Ask the master admin to set a chair count in Settings.</div>`;
      document.getElementById("repHourTotal").style.display = "none";
      return;
    }

    let html = '<div class="chair-grid">';
    let filled = 0;
    for (let c = 1; c <= chairCount; c++) {
      const val = hourData[c] || "";
      if (val.trim()) filled++;
      html += `
        <div class="chair-field">
          <label>Chair ${c}</label>
          <input type="text" maxlength="500" placeholder="Work logged" value="${escapeHtml(val)}" data-chair="${c}">
          <div class="row-status" data-status="${c}"></div>
        </div>`;
    }
    html += "</div>";
    wrap.innerHTML = html;

    wrap.querySelectorAll("input[type=text]").forEach((inp) => {
      const chair = inp.dataset.chair;
      const statusEl = wrap.querySelector(`[data-status="${chair}"]`);
      inp.addEventListener("input", () => {
        clearTimeout(state.saveTimers[chair]);
        statusEl.textContent = "Saving…";
        statusEl.classList.add("saving");
        state.saveTimers[chair] = setTimeout(() => saveRepEntry(date, hour, Number(chair), inp.value, statusEl), 700);
      });
      inp.addEventListener("blur", () => {
        clearTimeout(state.saveTimers[chair]);
        saveRepEntry(date, hour, Number(chair), inp.value, statusEl);
      });
    });

    document.getElementById("repHourTotal").style.display = "flex";
    document.getElementById("repHourTotalVal").textContent = filled + " / " + chairCount;
  }

  async function saveRepEntry(date, hour, chair, value, statusEl) {
    try {
      await api("PUT", "/api/logs/entry", { level: state.level, date, hour, chair, task: value });
      const key = "mine|" + state.level + "|" + date;
      const data = state.dayCache[key];
      if (data) {
        data.hours[hour] = data.hours[hour] || {};
        data.hours[hour][chair] = value;
        if (Number(repHourSelect.value) === hour) {
          const filled = Object.keys(data.hours[hour]).filter((c) => (data.hours[hour][c] || "").trim()).length;
          document.getElementById("repHourTotalVal").textContent = filled + " / " + data.chairCount;
        }
      }
      if (statusEl) { statusEl.textContent = "Saved"; statusEl.classList.remove("saving"); }
    } catch (e) {
      if (statusEl) { statusEl.textContent = "Couldn't save"; statusEl.classList.remove("saving"); }
    }
  }

  // ================= REP: Day overview (full editable grid) =================
  const repOverviewDate = document.getElementById("repOverviewDate");
  let repOverviewInited = false;

  function initRepOverview() {
    renderAllLevelToggles();
    if (!repOverviewInited) {
      repOverviewInited = true;
      repOverviewDate.value = todayStr();
      repOverviewDate.max = todayStr();
      repOverviewDate.addEventListener("change", loadRepOverview);
      document.getElementById("repExportBtn").addEventListener("click", () => {
        window.location.href = "/api/logs/export";
      });
    }
    loadRepOverview();
  }

  async function loadRepOverview() {
    const wrap = document.getElementById("repOverviewGrid");
    wrap.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      const data = await fetchDay(state.level, repOverviewDate.value);
      renderGrid(wrap, data, {
        editable: true,
        onSave: (hour, chair, value) => saveRepEntry(repOverviewDate.value, hour, chair, value, null)
      });
    } catch (e) {
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  // Shared hour × chair grid renderer, used by rep overview and master drill-down.
  function renderGrid(container, data, opts) {
    opts = opts || {};
    if (!data.chairCount) {
      container.innerHTML = `<div class="empty-state">No ${data.level} chairs configured for this department yet.</div>`;
      return;
    }
    let html = '<div class="overview-grid-wrap"><table class="grid-table"><thead><tr><th class="hour-col">Hour</th>';
    for (let c = 1; c <= data.chairCount; c++) html += `<th>Chair ${c}</th>`;
    html += "</tr></thead><tbody>";
    HOURS.forEach((h) => {
      const lbl = hourLabel(h);
      html += `<tr><td class="hour-col">${lbl.start}</td>`;
      const hourData = data.hours[h] || {};
      for (let c = 1; c <= data.chairCount; c++) {
        const val = hourData[c] || "";
        html += `<td><input type="text" maxlength="500" value="${escapeHtml(val)}" data-hour="${h}" data-chair="${c}" ${opts.editable ? "" : "disabled"}></td>`;
      }
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    container.innerHTML = html;

    if (opts.editable && opts.onSave) {
      container.querySelectorAll("input[type=text]").forEach((inp) => {
        const key = inp.dataset.hour + ":" + inp.dataset.chair;
        inp.addEventListener("blur", () => {
          clearTimeout(state.saveTimers[key]);
          opts.onSave(Number(inp.dataset.hour), Number(inp.dataset.chair), inp.value);
        });
        inp.addEventListener("input", () => {
          clearTimeout(state.saveTimers[key]);
          state.saveTimers[key] = setTimeout(() => opts.onSave(Number(inp.dataset.hour), Number(inp.dataset.chair), inp.value), 700);
        });
      });
    }
  }

  // ================= REP: Month overview =================
  const repMonthInput = document.getElementById("repMonth");
  let repMonthInited = false;

  function initRepMonth() {
    renderAllLevelToggles();
    if (!repMonthInited) {
      repMonthInited = true;
      repMonthInput.value = monthStr();
      repMonthInput.addEventListener("change", loadRepMonth);
    }
    loadRepMonth();
  }

  async function loadRepMonth() {
    const target = document.getElementById("repMonthTable");
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      const data = await api("GET", `/api/logs/month?level=${state.level}&month=${repMonthInput.value}`);
      if (!data.days.length) {
        target.innerHTML = '<div class="empty-state">No hours logged yet this month.</div>';
        return;
      }
      const total = data.chairCount * HOURS.length;
      let html = '<table class="led-table"><thead><tr><th>Date</th><th>Chairs filled</th></tr></thead><tbody>';
      data.days.forEach((d) => {
        const pct = total ? Math.round((d.filled / total) * 100) : 0;
        html += `<tr><td>${fmtDateNice(d.date)}</td><td>
          <div class="progress-cell"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><span class="muted">${d.filled} / ${total}</span></div>
        </td></tr>`;
      });
      html += "</tbody></table>";
      target.innerHTML = html;
    } catch (e) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ================= MASTER: Overview (day / month / department) =================
  const masterDateInput = document.getElementById("masterDate");
  const masterMonthInput = document.getElementById("masterMonth");
  const masterDeptSelect = document.getElementById("masterDeptSelect");
  const masterDeptDate = document.getElementById("masterDeptDate");
  let masterOverviewInited = false;

  function initMasterOverview() {
    renderAllLevelToggles();
    if (!masterOverviewInited) {
      masterOverviewInited = true;
      masterDateInput.value = todayStr();
      masterMonthInput.value = monthStr();
      masterDeptDate.value = todayStr();

      masterDateInput.addEventListener("change", loadMasterDay);
      masterMonthInput.addEventListener("change", loadMasterMonth);
      masterDeptSelect.addEventListener("change", loadMasterDept);
      masterDeptDate.addEventListener("change", loadMasterDept);

      document.getElementById("masterSubtabs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-sub]");
        if (!btn) return;
        document.querySelectorAll("#masterSubtabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.masterSub = btn.dataset.sub;
        document.querySelectorAll(".master-view").forEach((v) => (v.style.display = "none"));
        document.getElementById("master-" + state.masterSub).style.display = "";
        loadActiveMasterSub();
      });

      document.getElementById("masterExportBtn").addEventListener("click", () => {
        window.location.href = "/api/master/export";
      });
    }
    loadActiveMasterSub();
  }

  function loadActiveMasterSub() {
    if (state.masterSub === "day") loadMasterDay();
    if (state.masterSub === "month") loadMasterMonth();
    if (state.masterSub === "department") loadMasterDeptList().then(loadMasterDept);
  }

  async function loadMasterDay() {
    const target = document.getElementById("masterDayTable");
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      const data = await api("GET", `/api/master/overview/day?level=${state.level}&date=${masterDateInput.value}`);
      if (!data.departments.length) {
        target.innerHTML = '<div class="empty-state">No departments have been set up yet.</div>';
        return;
      }
      let html = '<table class="led-table"><thead><tr><th>Department</th><th>Chairs filled</th></tr></thead><tbody>';
      data.departments.forEach((d) => {
        const pct = d.total ? Math.round((d.filled / d.total) * 100) : 0;
        html += `<tr><td class="emp-name">${escapeHtml(d.name)}</td><td>
          <div class="progress-cell"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><span class="muted">${d.filled} / ${d.total}</span></div>
        </td></tr>`;
      });
      html += "</tbody></table>";
      target.innerHTML = html;
    } catch (e) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadMasterMonth() {
    const target = document.getElementById("masterMonthTable");
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      const data = await api("GET", `/api/master/overview/month?level=${state.level}&month=${masterMonthInput.value}`);
      if (!data.departments.length) {
        target.innerHTML = '<div class="empty-state">No departments have been set up yet.</div>';
        return;
      }
      let html = '<table class="led-table"><thead><tr><th>Department</th><th>Days active</th><th>Chairs filled</th></tr></thead><tbody>';
      data.departments.forEach((d) => {
        html += `<tr><td class="emp-name">${escapeHtml(d.name)}</td><td>${d.activeDays}</td><td>${d.totalFilled}</td></tr>`;
      });
      html += "</tbody></table>";
      target.innerHTML = html;
    } catch (e) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadMasterDeptList() {
    if (state.deptList) return;
    try {
      const data = await api("GET", "/api/master/departments");
      state.deptList = data.departments;
      masterDeptSelect.innerHTML = state.deptList.length
        ? state.deptList.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")
        : "<option>No departments yet</option>";
    } catch (e) {
      masterDeptSelect.innerHTML = "<option>Couldn't load</option>";
    }
  }

  async function loadMasterDept() {
    const target = document.getElementById("masterDeptGrid");
    if (!masterDeptSelect.value || !state.deptList || !state.deptList.length) {
      target.innerHTML = '<div class="loading-line">Choose a department to view its log.</div>';
      return;
    }
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    try {
      const data = await fetchDay(state.level, masterDeptDate.value, masterDeptSelect.value);
      renderGrid(target, data, { editable: false });
    } catch (e) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ================= MASTER: Settings (departments & reps) =================
  const addDeptForm = document.getElementById("addDeptForm");
  addDeptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("addDeptError");
    errEl.textContent = "";
    try {
      await api("POST", "/api/master/departments", {
        name: document.getElementById("newDeptName").value,
        ugChairs: document.getElementById("newDeptUg").value,
        pgChairs: document.getElementById("newDeptPg").value
      });
      addDeptForm.reset();
      document.getElementById("newDeptUg").value = 0;
      document.getElementById("newDeptPg").value = 0;
      state.deptList = null;
      showToast("Department added.");
      loadDeptSettings();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function loadDeptSettings() {
    const target = document.getElementById("deptSettingsList");
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    let departments;
    try {
      const data = await api("GET", "/api/master/departments");
      departments = data.departments;
      state.deptList = departments;
    } catch (e) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      return;
    }

    if (!departments.length) {
      target.innerHTML = '<div class="empty-state">No departments yet — add one above.</div>';
      return;
    }

    target.innerHTML = departments.map(renderDeptCard).join("");
    wireDeptCardEvents(target, departments);
  }

  function renderDeptCard(d) {
    const repBox = d.rep_id
      ? `<div class="rep-box" data-role="rep-view">
           <span class="rep-name">${escapeHtml(d.rep_name)}</span> — <span class="muted">@${escapeHtml(d.rep_username)}</span>
           <div class="dept-actions" style="margin-top:8px;">
             <button class="btn ghost small" data-action="reset-rep" data-rep-id="${d.rep_id}">Reset password</button>
             <button class="btn danger small" data-action="remove-rep" data-rep-id="${d.rep_id}">Remove representative</button>
           </div>
         </div>`
      : `<div class="rep-box" data-role="rep-add">
           <button class="btn small" data-action="show-add-rep" data-dept-id="${d.id}">Add representative</button>
         </div>`;

    return `
      <div class="dept-card" data-dept-id="${d.id}">
        <div class="dept-card-head">
          <div>
            <h3>${escapeHtml(d.name)}</h3>
            <div class="dept-meta">UG: ${d.ug_chairs} chairs &nbsp;&middot;&nbsp; PG: ${d.pg_chairs} chairs</div>
          </div>
          <div class="dept-actions">
            <button class="btn ghost small" data-action="edit-dept">Edit</button>
            <button class="btn danger small" data-action="delete-dept">Delete</button>
          </div>
        </div>
        <div class="dept-edit-form" data-role="edit-form" style="display:none;">
          <div class="field"><label>Name</label><input type="text" data-field="name" value="${escapeHtml(d.name)}"></div>
          <div class="field field-narrow"><label>UG chairs</label><input type="number" min="0" max="200" data-field="ug" value="${d.ug_chairs}"></div>
          <div class="field field-narrow"><label>PG chairs</label><input type="number" min="0" max="200" data-field="pg" value="${d.pg_chairs}"></div>
          <button class="btn small" data-action="save-dept">Save</button>
          <button class="btn ghost small" data-action="cancel-edit">Cancel</button>
        </div>
        ${repBox}
        <div class="rep-form" data-role="add-rep-form" style="display:none;">
          <div class="field"><label>Name</label><input type="text" data-field="rep-name"></div>
          <div class="field"><label>Username</label><input type="text" data-field="rep-username"></div>
          <div class="field"><label>Password</label><input type="password" data-field="rep-password" minlength="8"></div>
          <button class="btn small" data-action="create-rep">Create</button>
          <button class="btn ghost small" data-action="cancel-add-rep">Cancel</button>
        </div>
        <div class="rep-form" data-role="reset-form" style="display:none;">
          <div class="field"><label>New password</label><input type="password" data-field="new-password" minlength="8"></div>
          <button class="btn small" data-action="confirm-reset">Set new password</button>
          <button class="btn ghost small" data-action="cancel-reset">Cancel</button>
        </div>
      </div>`;
  }

  function wireDeptCardEvents(container) {
    container.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const card = btn.closest(".dept-card");
      const deptId = card.dataset.deptId;
      const action = btn.dataset.action;

      if (action === "edit-dept") {
        card.querySelector('[data-role="edit-form"]').style.display = "flex";
        return;
      }
      if (action === "cancel-edit") {
        card.querySelector('[data-role="edit-form"]').style.display = "none";
        return;
      }
      if (action === "save-dept") {
        const form = card.querySelector('[data-role="edit-form"]');
        try {
          await api("PUT", `/api/master/departments/${deptId}`, {
            name: form.querySelector('[data-field="name"]').value,
            ugChairs: form.querySelector('[data-field="ug"]').value,
            pgChairs: form.querySelector('[data-field="pg"]').value
          });
          state.deptList = null;
          showToast("Department updated.");
          loadDeptSettings();
        } catch (err) {
          showToast(err.message);
        }
        return;
      }
      if (action === "delete-dept") {
        if (!window.confirm("Delete this department? This also removes its representative account and every log entry for it. This can't be undone.")) return;
        try {
          await api("DELETE", `/api/master/departments/${deptId}`);
          state.deptList = null;
          showToast("Department deleted.");
          loadDeptSettings();
        } catch (err) {
          showToast(err.message);
        }
        return;
      }
      if (action === "show-add-rep") {
        card.querySelector('[data-role="add-rep-form"]').style.display = "flex";
        return;
      }
      if (action === "cancel-add-rep") {
        card.querySelector('[data-role="add-rep-form"]').style.display = "none";
        return;
      }
      if (action === "create-rep") {
        const form = card.querySelector('[data-role="add-rep-form"]');
        try {
          await api("POST", "/api/master/reps", {
            departmentId: deptId,
            name: form.querySelector('[data-field="rep-name"]').value,
            username: form.querySelector('[data-field="rep-username"]').value,
            password: form.querySelector('[data-field="rep-password"]').value
          });
          showToast("Representative account created.");
          loadDeptSettings();
        } catch (err) {
          showToast(err.message);
        }
        return;
      }
      if (action === "reset-rep") {
        card.querySelector('[data-role="reset-form"]').style.display = "flex";
        return;
      }
      if (action === "cancel-reset") {
        card.querySelector('[data-role="reset-form"]').style.display = "none";
        return;
      }
      if (action === "confirm-reset") {
        const repId = btn.closest(".dept-card").querySelector('[data-action="reset-rep"]').dataset.repId;
        const form = card.querySelector('[data-role="reset-form"]');
        try {
          await api("PUT", `/api/master/reps/${repId}`, { password: form.querySelector('[data-field="new-password"]').value });
          showToast("Password updated.");
          form.style.display = "none";
        } catch (err) {
          showToast(err.message);
        }
        return;
      }
      if (action === "remove-rep") {
        if (!window.confirm("Remove this representative's login? The department itself stays — you can add a new representative anytime.")) return;
        try {
          await api("DELETE", `/api/master/reps/${btn.dataset.repId}`);
          showToast("Representative removed.");
          loadDeptSettings();
        } catch (err) {
          showToast(err.message);
        }
      }
    });
  }

  // ================= Init =================
  bootAuthScreen();
})();
