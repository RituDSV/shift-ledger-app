// db.js — a Postgres connection pool, plus the schema this app needs.
//
// This talks to Postgres over a plain connection string (DATABASE_URL).
// There's nothing Supabase-specific here — point DATABASE_URL at a
// Supabase project, Neon, RDS, Render Postgres, or a Postgres you run
// yourself, and this file doesn't change.
//
// Note: this schema replaced an earlier, simpler one (individual
// employees logging their own hours). If you're pointing this at a
// database that already has the old `users`/`logs` tables, drop them
// first — the two models don't map onto each other automatically.

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill in your Postgres connection string.");
  process.exit(1);
}

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
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      ug_chairs INTEGER NOT NULL DEFAULT 0,
      pg_chairs INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('department_rep', 'master_admin')),
      department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (
        (role = 'master_admin' AND department_id IS NULL) OR
        (role = 'department_rep' AND department_id IS NOT NULL)
      )
    );

    -- Exactly one representative per department.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_rep_per_department
      ON users(department_id) WHERE department_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      level TEXT NOT NULL CHECK (level IN ('UG', 'PG')),
      date TEXT NOT NULL,       -- 'YYYY-MM-DD'
      hour INTEGER NOT NULL,    -- 8..15 (start hour of the 1-hour block)
      chair INTEGER NOT NULL,   -- 1..N (chair number within that department+level)
      task TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(department_id, level, date, hour, chair)
    );

    CREATE INDEX IF NOT EXISTS idx_logs_dept_level_date ON logs(department_id, level, date);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
  `);
}

module.exports = { pool, initSchema };
