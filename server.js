// server.js — entry point for local dev, Docker, Render, and Railway:
// a normal, persistent Express server. (Vercel uses api/index.js
// instead — see that file for why they differ.)

require("dotenv").config();
const path = require("path");
const express = require("express");
const { createApp } = require("./expressApp");
const { initSchema } = require("./db");

const app = createApp();

app.use(express.static(path.join(__dirname, "public")));

// Anything else falls back to the single-page app.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Shift Ledger running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Couldn't set up the database. Check DATABASE_URL and try again.");
    console.error(err.message);
    process.exit(1);
  });
