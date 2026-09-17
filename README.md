# Shift Ledger

A standalone work-hour logging app. Employees log their hours in eight
1-hour blocks from 8:00 AM to 4:00 PM. Admins can see logged hours by
day, month, or employee. The master admin can also export everything
to Excel.

No Claude account or organization membership is needed to use it —
it's a normal web app with its own login, backed by its own Postgres
database.

## Roles

- **Master admin** — the very first person to register. Can see all
  team data, export to Excel, and promote/demote other users between
  Employee and Admin. There is exactly one master admin.
- **Admin** — can see the Team tab (by day / by month / by employee)
  but cannot export.
- **Employee** — can only see and edit their own hours. Everyone
  after the first registration starts as an employee.

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
is more than enough for a team timesheet. One thing to know: free
Supabase projects pause after a week of inactivity and need manually
resuming from the dashboard — fine for testing, worth knowing if your
team might go quiet for a week.

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

Open http://localhost:3000, register the first account (that becomes
the master admin), and start logging hours.

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
   import that repository. Framework preset: **Other** (Vercel should
   detect this automatically).
3. Under **Environment Variables**, add:
   - `DATABASE_URL` — your Supabase **Transaction pooler** connection
     string (see the note above), or another Postgres's connection
     string.
   - `JWT_SECRET` — a long random value.
4. Deploy. Vercel gives you a `https://your-app.vercel.app` URL.

A couple of things that are specific to serverless hosting:
- **Cold starts.** The first request after a quiet period takes a
  little longer while a fresh function instance spins up. Not
  noticeable for a timesheet app people check a few times a day.
- **Connection pooling is already handled** — `db.js` automatically
  keeps only 1 Postgres connection open per function instance when
  running on Vercel (vs. 5 on a normal server), which is what keeps
  many simultaneous serverless invocations from overwhelming
  Postgres's connection limit. Pair it with the Transaction pooler
  connection string above and you shouldn't need to think about this
  further.

## A few things worth knowing

- **Passwords are hashed with bcrypt** and sessions are signed,
  httpOnly JWT cookies — reasonable defaults for an internal tool,
  but this hasn't had a security audit. Always run it behind HTTPS in
  production (Render, Railway, and Supabase's own connection all use
  TLS by default).
- **The master admin role is permanent** and assigned only to
  whoever registers first. If you need to change who holds it, update
  the `role` column for that user directly in the database (Supabase's
  Table Editor, or any Postgres client).
- **Switching Postgres providers later is just a config change** —
  point `DATABASE_URL` at the new one and restart; the schema is
  created automatically on startup.
# shift-ledger-app
