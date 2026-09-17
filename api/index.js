// api/index.js — Vercel serverless entry point.
//
// Vercel doesn't run a persistent server; it calls the function this
// file exports once per incoming request (reusing "warm" instances
// when it can). This wraps the same Express app used everywhere else,
// with two differences from server.js:
//   1. No static file serving or app.listen() — Vercel serves the
//      /public folder itself, and manages the request lifecycle.
//   2. The Postgres schema is ensured lazily on first use per warm
//      instance, instead of once before a long-lived listen() call.
//
// vercel.json rewrites every /api/* request to this one function, so
// the Express routers mounted in expressApp.js still see the full
// original path (e.g. /api/logs/mine) and route it themselves.

require("dotenv").config();
const { createApp } = require("../expressApp");
const { initSchema } = require("../db");

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}

async function ensureSchemaMiddleware(req, res, next) {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    schemaReady = null; // don't cache a failure — let the next request retry
    res.status(500).json({ error: "Database isn't reachable. Check DATABASE_URL." });
  }
}

const app = createApp({ preMiddleware: [ensureSchemaMiddleware] });

module.exports = app;
