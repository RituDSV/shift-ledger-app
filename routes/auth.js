// routes/auth.js — registration and login.
// The very first person to register becomes the one master admin.
// Everyone after that registers as a plain employee; a master admin
// can promote someone to admin later from the Team tab.

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
    const existing = await pool.query("SELECT id FROM users WHERE username = $1", [cleanUsername]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    const countRes = await pool.query("SELECT COUNT(*)::int AS n FROM users");
    const role = countRes.rows[0].n === 0 ? "master_admin" : "employee";

    const passwordHash = bcrypt.hashSync(password, 10);
    const insertRes = await pool.query(
      "INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id",
      [cleanUsername, passwordHash, String(name).trim(), role]
    );
    const userId = insertRes.rows[0].id;

    const token = signToken(userId);
    res.cookie("session", token, COOKIE_OPTS);
    res.json({ id: userId, username: cleanUsername, name: String(name).trim(), role });
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
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [cleanUsername]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const token = signToken(user.id);
    res.cookie("session", token, COOKIE_OPTS);
    res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
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
