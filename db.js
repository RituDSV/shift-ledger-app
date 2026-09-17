// db.js — a Postgres connection pool, plus the schema this app needs.
//
// This talks to Postgres over a plain connection string (DATABASE_URL).
// There's nothing Supabase-specific here — point DATABASE_URL at a
// Supabase project, Neon, RDS, Render Postgres, or a Postgres you run
// yourself, and this file doesn't change.

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill in your Postgres connection string.");
  process.exit(1);
}

// Most hosted Postgres (Supabase, Neon, RDS, Render) requires SSL.
// A local/self-hosted Postgres usually doesn't — set DATABASE_SSL=false
// in that case.
const useSSL = process.env.DATABASE_SSL !== "false";

// On Vercel, many short-lived function instances can each open their own
// pool — a handful of connections apiece adds up fast against Postgres's
// connection limit. Default small there (paired with Supabase's
// Transaction pooler connection string), larger on a normal long-lived
// server. Override with PG_POOL_MAX if you need to.
const defaultMax = process.env.VERCEL ? 1 : 5;
const poolMax = Number(process.env.PG_POOL_MAX) || defaultMax;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: poolMax
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('employee', 'admin', 'master_admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,      -- 'YYYY-MM-DD'
      hour INTEGER NOT NULL,   -- 8..15 (start hour of the 1-hour block)
      task TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, date, hour)
    );

    CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
  `);
}

module.exports = { pool, initSchema };
