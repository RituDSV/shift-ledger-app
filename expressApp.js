// expressApp.js — builds the Express app (JSON/cookie parsing + the
// /api/* routers) but does NOT start a server and does NOT serve
// static files. Both entry points build on this:
//   - server.js    (local dev, Docker, Render, Railway) adds static
//                   file serving and a listener on top of this.
//   - api/index.js (Vercel) leaves static serving out entirely —
//                   Vercel serves the /public folder itself,
//                   automatically, outside of this function.

const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const logsRoutes = require("./routes/logs");
const masterRoutes = require("./routes/master");

function createApp({ preMiddleware = [] } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(cookieParser());

  // Hook for anything that must run before the routers — e.g. Vercel's
  // lazy "make sure the schema exists" check.
  preMiddleware.forEach((mw) => app.use(mw));

  app.use("/api/auth", authRoutes);
  app.use("/api/logs", logsRoutes);
  app.use("/api/master", masterRoutes);

  return app;
}

module.exports = { createApp };
