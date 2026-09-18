// middleware/auth.js — reads the httpOnly session cookie, verifies it,
// and loads the current user (including their department, if any) onto
// req.user for downstream routes.

const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and set one before starting the server.");
  process.exit(1);
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: "Not signed in." });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Your session expired. Please sign in again." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.name, u.role, u.department_id, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: "Account not found." });
    req.user = rows[0];
    next();
  } catch (e) {
    res.status(500).json({ error: "Couldn't verify your session. Try again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to this." });
    }
    next();
  };
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

module.exports = { requireAuth, requireRole, signToken };
