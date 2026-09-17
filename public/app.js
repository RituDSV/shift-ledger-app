(function () {
  "use strict";

  const HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
  function hourLabel(h) {
    const to12 = (n) => {
      const hh = n % 12 === 0 ? 12 : n % 12;
      const ampm = n < 12 ? "AM" : "PM";
      return hh + ":00 " + ampm;
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
    showToast._t = setTimeout(() => t.classList.remove("show"), 2200);
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
    mineDate: todayStr(),
    mineHours: {},
    saveTimers: {},
    userList: null
  };

  // ---------------- Auth screen ----------------
  const authScreen = document.getElementById("authScreen");
  const appEl = document.getElementById("app");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const authToggle = document.getElementById("authToggle");
  const authSub = document.getElementById("authSub");

  let showingLogin = true;
  authToggle.addEventListener("click", () => {
    showingLogin = !showingLogin;
    loginForm.style.display = showingLogin ? "" : "none";
    registerForm.style.display = showingLogin ? "none" : "";
    authToggle.textContent = showingLogin
      ? "I don't have an account — create one"
      : "I already have an account — sign in";
    authSub.textContent = showingLogin ? "Sign in to log your hours." : "Create an account to start logging hours.";
  });

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

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("regError");
    errEl.textContent = "";
    try {
      const me = await api("POST", "/api/auth/register", {
        name: document.getElementById("regName").value,
        username: document.getElementById("regUsername").value,
        password: document.getElementById("regPassword").value
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
    initAppForUser();
  }

  function renderWho() {
    const roleLabel = state.me.role === "master_admin" ? "Master admin" : state.me.role === "admin" ? "Admin" : "Employee";
    const roleClass = state.me.role === "master_admin" ? "master" : state.me.role === "admin" ? "admin" : "employee";
    document.getElementById("whoBox").innerHTML = `
      <span class="name">${escapeHtml(state.me.name)}</span>
      <span class="badge ${roleClass}">${roleLabel}</span>
      <button class="signout-btn" id="signoutBtn">Sign out</button>`;
    document.getElementById("signoutBtn").addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      window.location.reload();
    });
  }

  // ---------------- Tabs ----------------
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("panel-mine").classList.toggle("active", tab === "mine");
    document.getElementById("panel-team").classList.toggle("active", tab === "team");
    if (tab === "team") loadTeamDay();
  });

  document.getElementById("teamSubtabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sub]");
    if (!btn) return;
    document.querySelectorAll("#teamSubtabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const sub = btn.dataset.sub;
    document.querySelectorAll(".team-view").forEach((v) => (v.style.display = "none"));
    document.getElementById("team-" + sub).style.display = "";
    if (sub === "day") loadTeamDay();
    if (sub === "month") loadTeamMonth();
    if (sub === "employee") loadTeamEmployeeList();
    if (sub === "roles") loadRoles();
  });

  // ---------------- My Hours ----------------
  const mineDateInput = document.getElementById("mineDate");
  mineDateInput.max = todayStr();
  mineDateInput.addEventListener("change", () => {
    state.mineDate = mineDateInput.value || todayStr();
    loadMine();
  });

  async function loadMine() {
    const wrap = document.getElementById("mineLedger");
    wrap.innerHTML = '<div class="loading-line">Loading your log&hellip;</div>';
    try {
      const data = await api("GET", "/api/logs/mine?date=" + encodeURIComponent(state.mineDate));
      state.mineHours = data.hours || {};
    } catch (e) {
      state.mineHours = {};
    }
    renderMineLedger();
  }

  function renderMineLedger() {
    const wrap = document.getElementById("mineLedger");
    const isToday = state.mineDate === todayStr();
    const curHour = new Date().getHours();
    let html = "";
    let filled = 0;
    HOURS.forEach((h) => {
      const lbl = hourLabel(h);
      const val = state.mineHours[h] || "";
      if (val.trim()) filled++;
      const isCurrent = isToday && curHour === h;
      html += `
        <div class="ledger-row${isCurrent ? " current-hour" : ""}">
          <div class="time">${lbl.start}<small>to ${lbl.end}</small></div>
          <input type="text" maxlength="500" placeholder="What did you work on?" value="${escapeHtml(val)}" data-hour="${h}">
          <div class="row-status" data-hour-status="${h}"></div>
        </div>`;
    });
    wrap.innerHTML = html;

    wrap.querySelectorAll('input[type="text"]').forEach((inp) => {
      inp.addEventListener("input", () => {
        const h = inp.dataset.hour;
        clearTimeout(state.saveTimers[h]);
        const statusEl = wrap.querySelector(`[data-hour-status="${h}"]`);
        statusEl.textContent = "Saving…";
        statusEl.classList.add("saving");
        state.saveTimers[h] = setTimeout(() => saveHour(h, inp.value, statusEl), 700);
      });
      inp.addEventListener("blur", () => {
        const h = inp.dataset.hour;
        clearTimeout(state.saveTimers[h]);
        const statusEl = wrap.querySelector(`[data-hour-status="${h}"]`);
        saveHour(h, inp.value, statusEl);
      });
    });

    document.getElementById("mineTotal").style.display = "flex";
    document.getElementById("mineTotalVal").textContent = filled + " / 8";
  }

  async function saveHour(hour, value, statusEl) {
    try {
      await api("PUT", "/api/logs/mine", { date: state.mineDate, hour: Number(hour), task: value });
      state.mineHours[hour] = value;
      const filled = HOURS.reduce((n, h) => n + ((state.mineHours[h] || "").trim() ? 1 : 0), 0);
      document.getElementById("mineTotalVal").textContent = filled + " / 8";
      if (statusEl) { statusEl.textContent = "Saved"; statusEl.classList.remove("saving"); }
    } catch (e) {
      if (statusEl) { statusEl.textContent = "Couldn't save"; statusEl.classList.remove("saving"); }
    }
  }

  // ---------------- Team: by day ----------------
  const teamDateInput = document.getElementById("teamDate");
  teamDateInput.value = todayStr();
  teamDateInput.addEventListener("change", loadTeamDay);

  async function loadTeamDay() {
    const target = document.getElementById("teamDayTable");
    target.innerHTML = '<div class="loading-line">Loading team data&hellip;</div>';
    const date = teamDateInput.value || todayStr();
    let data;
    try { data = await api("GET", "/api/admin/day?date=" + encodeURIComponent(date)); }
    catch (e) { target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

    if (!data.employees.length) {
      target.innerHTML = '<div class="empty-state">No one has registered yet.</div>';
      return;
    }

    let html = `<table class="led-table"><thead><tr><th>Employee</th>${HOURS.map((h) => `<th class="hour-cell">${h}</th>`).join("")}<th>Total</th></tr></thead><tbody>`;
    data.employees.forEach((emp) => {
      const filled = HOURS.filter((h) => (emp.hours[h] || "").trim()).length;
      html += `<tr><td class="emp-name">${escapeHtml(emp.name)}</td>`;
      HOURS.forEach((h) => {
        const val = emp.hours[h] || "";
        html += `<td class="hour-cell"><span class="hour-dot${val.trim() ? " filled" : ""}" title="${escapeHtml(val || "Not logged")}"></span></td>`;
      });
      html += `<td class="muted">${filled} / 8</td></tr>`;
    });
    html += "</tbody></table>";
    target.innerHTML = html;
  }

  // ---------------- Team: by month ----------------
  const teamMonthInput = document.getElementById("teamMonth");
  teamMonthInput.value = monthStr();
  teamMonthInput.addEventListener("change", loadTeamMonth);

  async function loadTeamMonth() {
    const target = document.getElementById("teamMonthTable");
    target.innerHTML = '<div class="loading-line">Loading team data&hellip;</div>';
    const month = teamMonthInput.value || monthStr();
    let data;
    try { data = await api("GET", "/api/admin/month?month=" + encodeURIComponent(month)); }
    catch (e) { target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

    if (!data.employees.length) {
      target.innerHTML = '<div class="empty-state">No one has registered yet.</div>';
      return;
    }

    let html = `<table class="led-table"><thead><tr><th>Employee</th><th>Days worked</th><th>Total hours</th></tr></thead><tbody>`;
    data.employees.forEach((emp) => {
      html += `<tr><td class="emp-name">${escapeHtml(emp.name)}</td><td>${emp.activeDays}</td><td>${emp.totalHours}</td></tr>`;
    });
    html += "</tbody></table>";
    target.innerHTML = html;
  }

  // ---------------- Team: by employee ----------------
  const empSelect = document.getElementById("teamEmpSelect");
  const empMonthInput = document.getElementById("teamEmpMonth");
  empMonthInput.value = monthStr();
  empSelect.addEventListener("change", loadTeamEmployeeDetail);
  empMonthInput.addEventListener("change", loadTeamEmployeeDetail);

  async function loadTeamEmployeeList() {
    const users = await fetchUserList();
    if (!users.length) {
      empSelect.innerHTML = "<option>No employees yet</option>";
      return;
    }
    empSelect.innerHTML = users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
    loadTeamEmployeeDetail();
  }

  async function loadTeamEmployeeDetail() {
    const target = document.getElementById("teamEmpTable");
    const uid = empSelect.value;
    if (!uid) { target.innerHTML = '<div class="loading-line">Choose an employee to see their log.</div>'; return; }
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    const month = empMonthInput.value || monthStr();
    let data;
    try { data = await api("GET", `/api/admin/employee/${uid}?month=${encodeURIComponent(month)}`); }
    catch (e) { target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

    if (!data.days.length) {
      target.innerHTML = '<div class="empty-state">No hours logged for this month.</div>';
      return;
    }

    let html = `<table class="led-table"><thead><tr><th>Date</th><th>Hours logged</th><th></th></tr></thead><tbody>`;
    data.days.forEach((day) => {
      const filled = HOURS.filter((h) => (day.hours[h] || "").trim()).length;
      const detailRows = HOURS
        .filter((h) => (day.hours[h] || "").trim())
        .map((h) => {
          const lbl = hourLabel(h);
          return `<div><b>${lbl.start}</b> — ${escapeHtml(day.hours[h])}</div>`;
        })
        .join("");
      html += `<tr><td>${fmtDateNice(day.date)}</td><td>${filled} / 8</td>
        <td><details class="day-detail"><summary>View</summary><div class="detail-hours">${detailRows}</div></details></td></tr>`;
    });
    html += "</tbody></table>";
    target.innerHTML = html;
  }

  async function fetchUserList() {
    if (state.userList) return state.userList;
    const data = await api("GET", "/api/admin/users");
    state.userList = data.users;
    return state.userList;
  }

  // ---------------- Team: manage roles (master admin only) ----------------
  async function loadRoles() {
    const target = document.getElementById("rolesTable");
    target.innerHTML = '<div class="loading-line">Loading&hellip;</div>';
    const users = await fetchUserList();
    let html = `<table class="led-table"><thead><tr><th>Person</th><th>Role</th></tr></thead><tbody>`;
    users.forEach((u) => {
      if (u.role === "master_admin") {
        html += `<tr><td class="emp-name">${escapeHtml(u.name)}</td><td class="muted">Master admin</td></tr>`;
        return;
      }
      html += `<tr><td class="emp-name">${escapeHtml(u.name)}</td><td>
        <div class="role-pill-group">
          <button class="role-pill${u.role === "employee" ? " current" : ""}" data-uid="${u.id}" data-role="employee">Employee</button>
          <button class="role-pill${u.role === "admin" ? " current" : ""}" data-uid="${u.id}" data-role="admin">Admin</button>
        </div>
      </td></tr>`;
    });
    html += "</tbody></table>";
    target.innerHTML = html;

    target.querySelectorAll(".role-pill").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("POST", "/api/admin/promote", { userId: Number(btn.dataset.uid), role: btn.dataset.role });
          state.userList = null;
          showToast("Role updated.");
          loadRoles();
        } catch (e) {
          showToast(e.message);
        }
      });
    });
  }

  // ---------------- Export (master admin only) ----------------
  function renderExportButton() {
    if (state.me.role !== "master_admin") return;
    const box = document.getElementById("exportBox");
    box.innerHTML = `<button class="btn export" id="exportBtn">Export to Excel</button>`;
    document.getElementById("exportBtn").addEventListener("click", () => {
      window.location.href = "/api/admin/export";
    });
  }

  // ---------------- Init ----------------
  function initAppForUser() {
    mineDateInput.value = state.mineDate;
    if (state.me.role === "admin" || state.me.role === "master_admin") {
      document.getElementById("teamTabBtn").style.display = "";
    }
    if (state.me.role === "master_admin") {
      document.getElementById("rolesSubBtn").style.display = "";
    }
    renderExportButton();
    loadMine();
  }

  async function bootstrap() {
    try {
      const me = await api("GET", "/api/auth/me");
      onSignedIn(me);
    } catch (e) {
      // Not signed in — show the auth screen (already visible by default).
    }
  }

  bootstrap();
})();
