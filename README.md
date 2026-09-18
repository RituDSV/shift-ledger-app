# Shift Ledger

A work-hour logging app for tracking UG/PG student work by department.

Each department has a number of "chairs" — student work slots — set
separately for UG and PG. A department's representative logs work
against a chair for a given date, hour (8:00 AM–4:00 PM, in eight
1-hour blocks), and level (UG/PG). The master admin sees every
department, manages the department list and chair counts, and manages
each department's one representative login.

No Claude account or organization membership is needed to use it —
it's a normal web app with its own login, backed by its own Postgres
database.

> **Upgrading from an earlier version of this app?** This version
> replaced the original per-employee hour-logging model with the
> department/chair model described above — it's a different data
> shape, not an incremental change, and there's no automatic migration
> between them. If you already deployed the old version, drop its
> `users` and `logs` tables from your Postgres database before
> starting this version — it will recreate them in the new shape
> automatically on first run.

## Roles

- **Master admin** — the very first person to register (see Setup,
  below). From the **Settings** tab, they add/edit/delete departments,
  set each department's UG and PG chair counts, and create, reset the
  password for, or remove each department's one representative
  account. From the **Overview** tab they can see any department's
  logged hours (by day, month, or department) and export everything
  to Excel. The master admin doesn't log hours themselves.
- **Department representative** — one account per department, created
  by the master admin (there's no open self-signup for this role).
  They log in, pick UG or PG, then a date and hour, and fill in each
  chair's work for that hour. They can edit or clear any entry in
  their own department (Day Overview tab shows the whole day as an
  editable grid) and export their department to Excel. They can't see
  other departments.

## Setup — first run

1. Open the app. Since no account exists yet, you'll be prompted to
   create the **master admin** account — do that first.
2. As the master admin, go to **Settings** and add each department,
   with its UG and PG chair counts.
3. For each department, click **Add representative** and give it a
   username and password — hand those credentials to that
   department's rep.
4. Reps log in with those credentials and start logging hours
   immediately; no further setup needed on their end.

## Database: Supabase, or any Postgres

This app talks to Postgres through a plain connection string
(`DATABASE_URL`) using the standard `pg` driver — there's no
Supabase-specific SDK or feature anywhere in the code. That means:

- **Supabase works out of the box.** Create a free project at
  [supabase.com](https://supabase.com), then go to
  **Project Settings → Database → Connection string** and copy a URI.
  Which one depends on how you're hosting the app:
  - **Render, Railway, Docker/your own server** (a normal, long-lived
    process) — use the **Session pooler** connection string.
  - **Vercel** (serverless — see below) — use the **Transaction
    pooler** connection string instead. Serverless functions can spin
    up many short-lived instances at once, each holding a connection;
    the transaction pooler is built for exactly that pattern.
- **Any other Postgres works exactly the same way** — Neon, Render
  Postgres, AWS RDS, a Postgres running on your own server, even one
  on your laptop for local dev. Just swap the connection string;
  nothing else in the app changes.
- The app creates its own tables automatically the first time it
  starts (see `db.js`) — you don't need to run any SQL by hand.

Supabase's free tier (500 MB database, 50,000 monthly active users)
is more than enough for a college's worth of departments and logs.
One thing to know: free Supabase projects pause after a week of
inactivity and need manually resuming from the dashboard.

## Run it locally

You'll need [Node.js](https://nodejs.org) 18+ and a `DATABASE_URL`
(from Supabase or any Postgres, as above).

```bash
cd work-log-app
npm install
cp .env.example .env
# open .env and set DATABASE_URL (and JWT_SECRET to a long random string)
npm start
```

Open http://localhost:3000 and follow the Setup steps above.

## Deploy it so others can use it

Pick whichever you're most comfortable with. All four give you a
public https:// URL. In each case, the database is Supabase (or
whichever Postgres you picked) — you're only deploying the app code
itself.

### Option A — Render.com (free tier, easiest)

1. Put this folder in a GitHub repository.
2. On [render.com](https://render.com), click **New → Web Service**
   and connect that repository.
3. Build command: `npm install`. Start command: `node server.js`.
4. Under **Environment**, add `DATABASE_URL` (your Supabase/Postgres
   connection string) and `JWT_SECRET` (a long random value).
5. Deploy. Render gives you a `https://your-app.onrender.com` URL —
   share that link with anyone.

### Option B — Railway.app

1. Push this folder to GitHub.
2. On [railway.app](https://railway.app), **New Project → Deploy from
   GitHub repo**.
3. Add environment variables `DATABASE_URL` and `JWT_SECRET`.
4. Railway detects Node.js automatically and deploys. Generate a
   public domain from the service's **Settings → Networking** tab.

### Option C — Your own server, with Docker

If you have any VPS (a $5/mo DigitalOcean droplet, a spare machine,
etc.) with Docker installed:

```bash
docker build -t shift-ledger .
docker run -d -p 3000:3000 \
  -e DATABASE_URL="your-connection-string" \
  -e JWT_SECRET="your-long-random-string" \
  --name shift-ledger \
  shift-ledger
```

Then point a domain at that server (or use its IP) and put it behind
a reverse proxy such as [Caddy](https://caddyserver.com) or
[nginx](https://nginx.org) for free automatic HTTPS.

### Option D — Vercel

Vercel runs this app differently from the other three options: instead
of one persistent server, it calls `api/index.js` as a serverless
function per request, and serves everything in `public/` directly as
static files. That's already set up (`vercel.json`, `api/index.js`) —
you don't need to change anything, just deploy.

1. Push this folder to GitHub.
2. On [vercel.com](https://vercel.com), **Add New → Project** and
   import that repository. Framework preset: **Other**. If the
   repository has other folders alongside this one, set **Root
   Directory** to wherever this folder's `package.json` lives.
3. Under **Environment Variables**, add:
   - `DATABASE_URL` — your Supabase **Transaction pooler** connection
     string (see the note above), or another Postgres's connection
     string.
   - `JWT_SECRET` — a long random value.
4. Deploy. Vercel gives you a `https://your-app.vercel.app` URL.

Two Vercel-specific notes:
- **Sharing the link:** Vercel's auto-generated deployment URLs
  (the ones with a random hash) require a Vercel login by default.
  Use your project's stable domain instead — find it under the
  **Domains** tab — and that one is public.
- **Connection pooling is already handled** — `db.js` automatically
  keeps only 1 Postgres connection open per function instance when
  running on Vercel (vs. 5 on a normal server). Pair it with the
  Transaction pooler connection string above and you shouldn't need
  to think about this further.

## A few things worth knowing

- **Passwords are hashed with bcrypt** and sessions are signed,
  httpOnly JWT cookies — reasonable defaults for an internal tool,
  but this hasn't had a security audit. Always run it behind HTTPS in
  production (Render, Railway, Vercel, and Supabase's own connection
  all use TLS by default).
- **Deleting a department is permanent and cascades** — it removes
  that department's representative account and every log entry for
  it. Removing just the representative (Settings → Remove
  representative) is safer if you only want to revoke a login; the
  department and its history stay intact and a new rep can be added
  later.
- **Changing a department's chair count** only affects the entry
  form and grid going forward — it doesn't touch existing logged
  entries for chair numbers beyond a newly lowered count.
- **The master admin role is permanent** and assigned only to
  whoever registers first, during initial setup. If you need to
  change who holds it, update the `role` and `department_id` columns
  for that user directly in the database.
