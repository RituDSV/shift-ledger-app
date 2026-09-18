// routes/logs.js — a department representative reading, writing, and
// exporting THEIR OWN department's chair logs. Every query here is
// scoped to req.user.department_id, so there's no way for one rep to
// see or edit another department's data through this file.

const express = require("express");
const XLSX = require("xlsx");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { HOURS, DATE_RE, MONTH_RE, LEVELS, hourLabel } = require("../utils");

const router = express.Router();

router.use(requireAuth, requireRole("department_rep"));

function chairCountFor(user, level) {
  return level === "UG" ? user.ug_chairs : user.pg_chairs;
}

async function loadOwnDepartment(req) {
  const { rows } = await pool.query(
    "SELECT id, name, ug_chairs, pg_chairs FROM departments WHERE id = $1",
    [req.user.department_id]
  );
  return rows[0];
}

// Full hour × chair grid for one date + level — used for both the
// hour-by-hour entry form and the day-overview grid on the frontend.
router.get("/day", async (req, res) => {
  const { level, date } = req.query;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "A valid date is required." });

  try {
    const dept = await loadOwnDepartment(req);
    if (!dept) return res.status(404).json({ error: "Your department no longer exists. Contact the master admin." });
    const chairCount = chairCountFor(dept, level);

    const { rows } = await pool.query(
      "SELECT hour, chair, task FROM logs WHERE department_id = $1 AND level = $2 AND date = $3",
      [dept.id, level, date]
    );

    const hours = {};
    HOURS.forEach((h) => (hours[h] = {}));
    rows.forEach((r) => {
      hours[r.hour] = hours[r.hour] || {};
      hours[r.hour][r.chair] = r.task;
    });

    res.json({ department: dept.name, level, date, chairCount, hours });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load that day's log." });
  }
});

router.put("/entry", async (req, res) => {
  const { level, date, hour, chair, task } = req.body || {};
  const hourNum = Number(hour);
  const chairNum = Number(chair);

  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!DATE_RE.test(date || "")) return res.status(400).json({ error: "A valid date is required." });
  if (!HOURS.includes(hourNum)) return res.status(400).json({ error: "Hour must be one of the 8am–4pm blocks." });

  try {
    const dept = await loadOwnDepartment(req);
    if (!dept) return res.status(404).json({ error: "Your department no longer exists." });
    const chairCount = chairCountFor(dept, level);
    if (!Number.isInteger(chairNum) || chairNum < 1 || chairNum > chairCount) {
      return res.status(400).json({ error: `Chair must be between 1 and ${chairCount}.` });
    }

    const cleanTask = String(task || "").trim().slice(0, 500);

    if (!cleanTask) {
      await pool.query(
        "DELETE FROM logs WHERE department_id = $1 AND level = $2 AND date = $3 AND hour = $4 AND chair = $5",
        [dept.id, level, date, hourNum, chairNum]
      );
      return res.json({ ok: true, cleared: true });
    }

    await pool.query(
      `INSERT INTO logs (department_id, level, date, hour, chair, task, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (department_id, level, date, hour, chair)
       DO UPDATE SET task = EXCLUDED.task, updated_at = EXCLUDED.updated_at`,
      [dept.id, level, date, hourNum, chairNum, cleanTask]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Couldn't save that entry. Try again." });
  }
});

router.get("/month", async (req, res) => {
  const { level, month } = req.query;
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });
  if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "A valid month is required." });

  try {
    const dept = await loadOwnDepartment(req);
    if (!dept) return res.status(404).json({ error: "Your department no longer exists." });
    const chairCount = chairCountFor(dept, level);

    const { rows } = await pool.query(
      "SELECT date, COUNT(*)::int AS filled FROM logs WHERE department_id = $1 AND level = $2 AND date LIKE $3 GROUP BY date ORDER BY date",
      [dept.id, level, `${month}-%`]
    );

    res.json({ department: dept.name, level, month, chairCount, days: rows });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load that month's summary." });
  }
});

router.get("/export", async (req, res) => {
  const level = req.query.level;
  if (level && !LEVELS.includes(level)) return res.status(400).json({ error: "Level must be UG or PG." });

  try {
    const dept = await loadOwnDepartment(req);
    if (!dept) return res.status(404).json({ error: "Your department no longer exists." });

    const params = [dept.id];
    let where = "WHERE department_id = $1";
    if (level) {
      params.push(level);
      where += " AND level = $2";
    }

    const { rows } = await pool.query(
      `SELECT level, date, hour, chair, task FROM logs ${where} ORDER BY level, date, hour, chair`,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ error: "There's nothing logged yet to export." });
    }

    const sheetRows = rows.map((r) => ({
      Department: dept.name,
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

    const filename = `${dept.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: "Couldn't build the export." });
  }
});

module.exports = router;
