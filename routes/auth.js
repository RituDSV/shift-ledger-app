// routes/auth.js — registration and login.
//
// Registration is only open for the very first account, which becomes
// the one master admin. After that, only the master admin can create
// accounts (department representatives), from the Settings screen —
// there's no open signup for anyone else.

const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth, signToken } = require("../middleware/auth");

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// Lets the login screen know whether to show "set up the master admin"
// or a plain sign-in form. No auth required — it reveals nothing but a
// boolean.
router.get("/bootstrap-status", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'master_admin'");
    res.json({ hasMaster: rows[0].n > 0 });
  } catch (e) {
    res.status(500).json({ error: "Couldn't check setup status." });
  }
});

router.post("/register", async (req, res) => {
  const { username, password, name } = req.body || {};

  if (!username || !password || !name) {
    return res.status(400).json({ error: "Username, password, and name are all required." });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const cleanUsername = String(username).trim().toLowerCase();

  try {
    const masterRes = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'master_admin'");
    if (masterRes.rows[0].n > 0) {
      return res.status(403).json({ error: "Accounts are created by the master admin. Ask them for a login." });
    }

    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [cleanUsername]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const insertRes = await pool.query(
      "INSERT INTO users (username, password_hash, name, role, department_id) VALUES ($1, $2, $3, 'master_admin', NULL) RETURNING id",
      [cleanUsername, passwordHash, String(name).trim()]
    );
    const userId = insertRes.rows[0].id;

    const token = signToken(userId);
    res.cookie("session", token, COOKIE_OPTS);
    res.json({ id: userId, username: cleanUsername, name: String(name).trim(), role: "master_admin", department_id: null, department_name: null });
  } catch (e) {
    res.status(500).json({ error: "Couldn't create your account. Try again." });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const cleanUsername = String(username).trim().toLowerCase();

  try {
    const { rows } = await pool.query(
      `SELECT u.*, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.username = $1`,
      [cleanUsername]
    );
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const token = signToken(user.id);
    res.cookie("session", token, COOKIE_OPTS);
    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department_id: user.department_id,
      department_name: user.department_name
    });
  } catch (e) {
    res.status(500).json({ error: "Something went wrong signing you in." });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("session", COOKIE_OPTS);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
