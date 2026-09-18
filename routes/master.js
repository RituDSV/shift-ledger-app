// routes/master.js — the master admin's world: visibility across every
// department's logs, plus the Settings screen (departments, chair
// counts, and representative accounts). The master admin can VIEW and
// EXPORT any department's data, but doesn't edit logs directly —
// editing is a representative's job for their own department.

const express = require("express");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { HOURS, DATE_RE, MONTH_RE, LEVELS, hourLabel } = require("../utils");

const router = express.Router();

router.use(requireAuth, requireRole("master_admin"));

// ---------------- Departments ----------------

router.get("/departments", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.name, d.ug_chairs, d.pg_chairs,
             u.id AS rep_id, u.username AS rep_username, u.name AS rep_name
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      ORDER BY d.name COLLATE "C"
    `);
    res.json({ departments: rows });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load departments." });
  }
});

function validChairCount(n) {
  return Number.isInteger(n) && n >= 0 && n <= 200;
}

router.post("/departments", async (req, res) => {
  const { name, ugChairs, pgChairs } = req.body || {};
  const cleanName = String(name || "").trim();
  const ug = Number(ugChairs);
  const pg = Number(pgChairs);

  if (!cleanName) return res.status(400).json({ error: "Department name is required." });
  if (!validChairCount(ug) || !validChairCount(pg)) {
    return res.status(400).json({ error: "Chair counts must be whole numbers between 0 and 200." });
  }

  try {
    const insertRes = await pool.query(
      "INSERT INTO departments (name, ug_chairs, pg_chairs) VALUES ($1, $2, $3) RETURNING id",
      [cleanName, ug, pg]
    );
    res.json({ id: insertRes.rows[0].id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A department with that name already exists." });
    res.status(500).json({ error: "Couldn't create the department." });
  }
});

router.put("/departments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, ugChairs, pgChairs } = req.body || {};
  const cleanName = String(name || "").trim();
  const ug = Number(ugChairs);
  const pg = Number(pgChairs);

  if (!cleanName) return res.status(400).json({ error: "Department name is required." });
  if (!validChairCount(ug) || !validChairCount(pg)) {
    return res.status(400).json({ error: "Chair counts must be whole numbers between 0 and 200." });
  }

  try {
    const result = await pool.query(
      "UPDATE departments SET name = $1, ug_chairs = $2, pg_chairs = $3 WHERE id = $4",
      [cleanName, ug, pg, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "No such department." });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A department with that name already exists." });
    res.status(500).json({ error: "Couldn't update the department." });
  }
});

router.delete("/departments/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query("DELETE FROM departments WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "No such department." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Couldn't delete the department." });
  }
});

// ---------------- Representatives ----------------

router.post("/reps", async (req, res) => {
  const { departmentId, username, password, name } = req.body || {};
  const deptId = Number(departmentId);
  const cleanUsername = String(username || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();

  if (!deptId || !cleanUsername || !password || !cleanName) {
    return res.status(400).json({ error: "Department, username, password, and name are all required." });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const insertRes = await pool.query(
      "INSERT INTO users (username, password_hash, name, role, department_id) VALUES ($1, $2, $3, 'department_rep', $4) RETURNING id",
      [cleanUsername, passwordHash, cleanName, deptId]
    );
    res.json({ id: insertRes.rows[0].id });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Either that username is taken, or this department already has a representative." });
    }
    if (e.code === "23503") {
      return res.status(404).json({ error: "No such department." });
    }
    res.status(500).json({ error: "Couldn't create the representative account." });
  }
});

router.put("/reps/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, username, password } = req.body || {};

  const fields = [];
  const params = [];
  let i = 1;

  if (name !== undefined) {
    fields.push(`name = $${i++}`);
    params.push(String(name).trim());
  }
  if (username !== undefined) {
    fields.push(`username = $${i++}`);
    params.push(String(username).trim().toLowerCase());
  }
  if (password) {
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    fields.push(`password_hash = $${i++}`);
    params.push(bcrypt.hashSync(password, 10));
  }

  if (!fields.length) return res.status(400).json({ error: "Nothing to update." });

  params.push(id);

  try {
    const result = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i} AND role = 'department_rep'`,
      params
    );
    if (!result.rowCount) return res.status(404).json({ error: "No such representative." });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is already taken." });
    res.status(500).json({ error: "Couldn't update that representative." });
  }
});

router.delete("/reps/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'department_rep'", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "No such representative." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Couldn't remove that representative." });
  }
});

// ---------------- Cross-department visibility ----------------

router.get("/overview/day", async (req, res) => {
  const { level, date } = req.query;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "A valid date is required." });

  try {
    const deptRes = await pool.query("SELECT id, name, ug_chairs, pg_chairs FROM departments ORDER BY name COLLATE \"C\"");
    const filledRes = await pool.query(
      "SELECT department_id, COUNT(*)::int AS filled FROM logs WHERE level = $1 AND date = $2 GROUP BY department_id",
      [level, date]
    );
    const filledMap = {};
    filledRes.rows.forEach((r) => (filledMap[r.department_id] = r.filled));

    const departments = deptRes.rows.map((d) => {
      const chairCount = level === "UG" ? d.ug_chairs : d.pg_chairs;
      return {
        id: d.id,
        name: d.name,
        chairCount,
        total: chairCount * HOURS.length,
        filled: filledMap[d.id] || 0
      };
    });

    res.json({ level, date, departments });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load the overview." });
  }
});

router.get("/overview/month", async (req, res) => {
  const { level, month } = req.query;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "A valid month is required." });

  try {
    const deptRes = await pool.query("SELECT id, name FROM departments ORDER BY name COLLATE \"C\"");
    const logsRes = await pool.query(
      "SELECT department_id, date FROM logs WHERE level = $1 AND date LIKE $2",
      [level, `${month}-%`]
    );

    const stats = {};
    logsRes.rows.forEach((r) => {
      stats[r.department_id] = stats[r.department_id] || { dates: new Set(), total: 0 };
      stats[r.department_id].dates.add(r.date);
      stats[r.department_id].total += 1;
    });

    const departments = deptRes.rows
      .map((d) => ({
        id: d.id,
        name: d.name,
        activeDays: stats[d.id] ? stats[d.id].dates.size : 0,
        totalFilled: stats[d.id] ? stats[d.id].total : 0
      }))
      .sort((a, b) => b.totalFilled - a.totalFilled);

    res.json({ level, month, departments });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load the overview." });
  }
});

router.get("/departments/:id/day", async (req, res) => {
  const id = Number(req.params.id);
  const { level, date } = req.query;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "A valid date is required." });

  try {
    const deptRes = await pool.query("SELECT id, name, ug_chairs, pg_chairs FROM departments WHERE id = $1", [id]);
    const dept = deptRes.rows[0];
    if (!dept) return res.status(404).json({ error: "No such department." });
    const chairCount = level === "UG" ? dept.ug_chairs : dept.pg_chairs;

    const { rows } = await pool.query(
      "SELECT hour, chair, task FROM logs WHERE department_id = $1 AND level = $2 AND date = $3",
      [id, level, date]
    );

    const hours = {};
    HOURS.forEach((h) => (hours[h] = {}));
    rows.forEach((r) => {
      hours[r.hour] = hours[r.hour] || {};
      hours[r.hour][r.chair] = r.task;
    });

    res.json({ department: dept.name, level, date, chairCount, hours });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load that department's log." });
  }
});

router.get("/export", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.name AS department, l.level, l.date, l.hour, l.chair, l.task
      FROM logs l
      JOIN departments d ON d.id = l.department_id
      ORDER BY d.name COLLATE "C", l.level, l.date, l.hour, l.chair
    `);

    if (!rows.length) {
      return res.status(404).json({ error: "There's nothing logged yet to export." });
    }

    const sheetRows = rows.map((r) => ({
      Department: r.department,
      Level: r.level,
      Date: r.date,
      "Hour block": hourLabel(r.hour),
      Chair: r.chair,
      "Work logged": r.task
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws["!cols"] = [{ wch: 20 }, { wch: 6 }, { wch: 12 }, { wch: 18 }, { wch: 7 }, { wch: 46 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Work Logs");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const filename = `all-departments-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: "Couldn't build the export." });
  }
});

module.exports = router;
