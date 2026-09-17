// routes/admin.js — team-wide views (admin + master admin) and the
// two things only the master admin can do: change roles and export.

const express = require("express");
const XLSX = require("xlsx");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function hourLabel(h) {
  const to12 = (n) => {
    const hh = n % 12 === 0 ? 12 : n % 12;
    return `${hh}:00 ${n < 12 ? "AM" : "PM"}`;
  };
  return `${to12(h)} – ${to12(h + 1)}`;
}

// Anyone who is admin or master_admin can view team data.
router.use(requireAuth, requireRole("admin", "master_admin"));

router.get("/users", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, role FROM users ORDER BY name");
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load the team list." });
  }
});

router.get("/day", async (req, res) => {
  const date = req.query.date;
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "A valid date is required." });

  try {
    const usersRes = await pool.query("SELECT id, name FROM users ORDER BY name");
    const logsRes = await pool.query("SELECT user_id, hour, task FROM logs WHERE date = $1", [date]);

    const byUser = {};
    logsRes.rows.forEach((r) => {
      byUser[r.user_id] = byUser[r.user_id] || {};
      byUser[r.user_id][r.hour] = r.task;
    });

    const employees = usersRes.rows.map((u) => ({
      id: u.id,
      name: u.name,
      hours: byUser[u.id] || {}
    }));

    res.json({ date, employees });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load team data." });
  }
});

router.get("/month", async (req, res) => {
  const month = req.query.month;
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "A valid month is required." });

  try {
    const usersRes = await pool.query("SELECT id, name FROM users ORDER BY name");
    const logsRes = await pool.query("SELECT user_id, date FROM logs WHERE date LIKE $1", [`${month}-%`]);

    const stats = {};
    logsRes.rows.forEach((r) => {
      stats[r.user_id] = stats[r.user_id] || { dates: new Set(), total: 0 };
      stats[r.user_id].dates.add(r.date);
      stats[r.user_id].total += 1;
    });

    const employees = usersRes.rows
      .map((u) => ({
        id: u.id,
        name: u.name,
        activeDays: stats[u.id] ? stats[u.id].dates.size : 0,
        totalHours: stats[u.id] ? stats[u.id].total : 0
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    res.json({ month, employees });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load team data." });
  }
});

router.get("/employee/:id", async (req, res) => {
  const month = req.query.month;
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "A valid month is required." });

  const userId = Number(req.params.id);

  try {
    const userRes = await pool.query("SELECT id, name FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "No such employee." });

    const logsRes = await pool.query(
      "SELECT date, hour, task FROM logs WHERE user_id = $1 AND date LIKE $2 ORDER BY date, hour",
      [userId, `${month}-%`]
    );

    const byDate = {};
    logsRes.rows.forEach((r) => {
      byDate[r.date] = byDate[r.date] || {};
      byDate[r.date][r.hour] = r.task;
    });

    const days = Object.keys(byDate)
      .sort()
      .map((date) => ({ date, hours: byDate[date] }));

    res.json({ user, month, days });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load that employee's log." });
  }
});

// ---- Master admin only from here down ----

router.post("/promote", requireRole("master_admin"), async (req, res) => {
  const { userId, role } = req.body || {};
  if (!["employee", "admin"].includes(role)) {
    return res.status(400).json({ error: "Role must be 'employee' or 'admin'." });
  }

  try {
    const targetRes = await pool.query("SELECT id, role FROM users WHERE id = $1", [Number(userId)]);
    const target = targetRes.rows[0];
    if (!target) return res.status(404).json({ error: "No such user." });
    if (target.role === "master_admin") {
      return res.status(400).json({ error: "The master admin's role can't be changed here." });
    }

    await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, target.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Couldn't update that role." });
  }
});

router.get("/export", requireRole("master_admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.name AS employee, l.date AS date, l.hour AS hour, l.task AS task
      FROM logs l
      JOIN users u ON u.id = l.user_id
      ORDER BY u.name, l.date, l.hour
    `);

    if (!rows.length) {
      return res.status(404).json({ error: "There are no logged hours to export yet." });
    }

    const sheetRows = rows.map((r) => ({
      Employee: r.employee,
      Date: r.date,
      "Hour block": hourLabel(r.hour),
      "Work logged": r.task
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 48 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Work Logs");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const filename = `work-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: "Couldn't build the export." });
  }
});

module.exports = router;
