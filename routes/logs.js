// routes/logs.js — an employee reading and writing their own hours.
// Every route here is scoped to req.user.id, so there's no way for
// one signed-in user to read or edit another's log through this file.

const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const VALID_HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/mine", requireAuth, async (req, res) => {
  const date = req.query.date;
  if (!DATE_RE.test(date || "")) {
    return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT hour, task FROM logs WHERE user_id = $1 AND date = $2",
      [req.user.id, date]
    );
    const hours = {};
    rows.forEach((r) => (hours[r.hour] = r.task));
    res.json({ date, hours });
  } catch (e) {
    res.status(500).json({ error: "Couldn't load your hours." });
  }
});

router.put("/mine", requireAuth, async (req, res) => {
  const { date, hour, task } = req.body || {};
  const hourNum = Number(hour);

  if (!DATE_RE.test(date || "")) {
    return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required." });
  }
  if (!VALID_HOURS.includes(hourNum)) {
    return res.status(400).json({ error: "Hour must be one of the 8am–4pm blocks." });
  }

  const cleanTask = String(task || "").trim().slice(0, 500);

  try {
    if (!cleanTask) {
      await pool.query(
        "DELETE FROM logs WHERE user_id = $1 AND date = $2 AND hour = $3",
        [req.user.id, date, hourNum]
      );
      return res.json({ ok: true, cleared: true });
    }

    await pool.query(
      `INSERT INTO logs (user_id, date, hour, task, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, date, hour)
       DO UPDATE SET task = EXCLUDED.task, updated_at = EXCLUDED.updated_at`,
      [req.user.id, date, hourNum, cleanTask]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Couldn't save that entry. Try again." });
  }
});

module.exports = router;
