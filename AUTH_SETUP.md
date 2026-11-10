# Authentication setup (Supabase Postgres + email OTP + admin approval)

Stack: your existing plain HTML/JS front end, served by `server.js` (Node 18+), which also exposes the JSON API under `/api/v1`. The database is **Supabase (PostgreSQL)**, reached only from the Node server with the `pg` driver. You do **not** use Supabase Auth or the Supabase JS client: login, sessions and OTP are handled by the server. Passwords use Node's built-in **scrypt**.

## 1. Install

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste the output as SESSION_SECRET in .env
```

## 2. Supabase database

1. Create a project at supabase.com. Save the **database password** you choose.
2. **Create the tables:** Dashboard -> **SQL Editor** -> New query -> paste all of `database/schema.sql` -> **Run**. (Or `npm run db:init` after step 3.)
   This creates `users`, `email_otps`, `sessions`, `password_resets`, `audit_log`, `notifications`, and **enables Row Level Security with no policies** so the public Supabase API cannot read them. Check *Table Editor*: each table should show "RLS enabled".
3. **Connection string:** click **Connect** at the top of the dashboard -> **Session pooler** (works over IPv4; the "Direct connection" is IPv6-only). Copy the URI into `.env` as `DATABASE_URL`, replacing `[YOUR-PASSWORD]` with your password **URL-encoded** (`@` -> `%40`, `#` -> `%23`, `/` -> `%2F`).
4. Optional: download Supabase's CA certificate (Database -> Settings -> SSL), save it in the project and set `DB_SSL_CA=path/to/file`. Without it the connection is encrypted but the server certificate is not verified.

Keep the **service_role** key and the **anon** key out of this project entirely; nothing here needs them. The role value for residents is `resident` (not `user`) because the existing UI uses that name.

Local Postgres instead of Supabase also works: `DATABASE_URL=postgresql://postgres:pw@localhost:5432/barangaydocs` (SSL turns off automatically for localhost).

## 3. Email provider (needs your credentials)

Registration and password reset refuse to proceed (HTTP 503, clear message) until email is configured. They never pretend to send.

**Brevo (default; works without owning a domain)**
1. Create an account at brevo.com -> *SMTP & API* -> create an **API key** (v3).
2. *Senders, Domains & Dedicated IPs* -> add and **verify** a sender email address.
3. `.env`: `MAIL_PROVIDER=brevo`, `MAIL_API_KEY=<key>`, `MAIL_FROM_ADDRESS=<verified sender>`, `MAIL_FROM_NAME=BarangayDocs`.

**Resend** (needs a verified domain): `MAIL_PROVIDER=resend`, key from resend.com, `MAIL_FROM_ADDRESS=noreply@yourdomain`.

Another provider = one entry in `server/mailer/providers.js`. Nothing else changes.

**Test delivery:** `npm start`, open `http://localhost:5173/#register`, register with an inbox you can read. The server prints `Email: brevo configured` on startup. Check spam if nothing arrives; a provider rejection is logged as `[mail] provider brevo answered HTTP <status>` (401 = wrong key, 400 = unverified sender).

## 4. Create the first administrator

```bash
npm run create-admin
```
It prompts for email, name and a hidden password (policy: 8+ chars, upper, lower, number, symbol). Non-interactive: `ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin`. The public form can never create an admin.

## 5. Run

```bash
npm start        # http://localhost:5173
```
Open the site through this server, not by double-clicking `index.html`: the session is a cookie served by the API. `USE_MOCK` in `js/config.js` is now `false`; set it to `true` only for the old browser-only demo.

## 6. The workflow

1. Resident registers (3 steps) -> OTP emailed (5 min, 30 s resend cooldown, 5 attempts, 5 sends/hour).
2. After the OTP, the email is verified but the account stays `pending`.
3. Login says the account awaits approval. Admin signs in -> **Residents** (Resident Approvals) -> reviews the ID -> Approve/Reject.
4. The resident is emailed (*Your Account Has Been Approved* / rejection reason). Approved residents sign in and land on the resident dashboard; admins on the admin dashboard.

## 7. Endpoints (existing project convention, base `/api/v1`)

| Your spec | Implemented as |
|---|---|
| `POST /auth/register` | same (multipart: email, password, name, dob, phone, valid_id) |
| `POST /auth/verify-otp`, `/auth/resend-otp` | same (`purpose`: `register` or `reset`) |
| `POST /auth/login`, `/auth/logout`, `GET /auth/me` | same (login accepts email or Resident ID) |
| `GET /admin/pending-accounts` | `GET /admin/residents` (all email-verified registrations; UI filters Pending) |
| `POST /admin/accounts/:id/approve` / `reject` | `PATCH /admin/residents/:id` `{status:'approved'\|'rejected', reason}` |
| (extra) | `GET /admin/residents/:id/id-file`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET/PATCH/POST /notifications...` |

Errors are always `{ code, message, ...extras }`.

## 8. Security summary

scrypt password hashes; OTPs stored only as HMAC; OTP attempts consumed atomically; httpOnly + SameSite=Lax session cookie (`Secure` in production), server-side sessions that die on logout, password reset, rejection or role loss; CSRF token header + Origin check; per-IP and per-account rate limits; generic login errors (account state is only revealed after the correct password); admin routes check the role on the server; uploaded IDs are checked by file signature, stored outside the web root and served only to admins; only an allowlist of static files is public and `js/portal.js` needs a session; audit log of registrations, verification, decisions, ID views, logins.

Supabase notes: keep `DB_POOL_MAX` small (default 5; the free tier has few connections). Uploaded valid IDs are still stored on the server's disk (`storage/ids`), which is fine on a VPS or your own PC but would be lost on ephemeral hosting (Heroku-style, serverless); in that case they should move to a private Supabase Storage bucket.

Production: set `NODE_ENV=production`, `APP_URL=https://your.domain`, run behind HTTPS, set `TRUST_PROXY=true` only behind your own proxy. Rate-limit counters are in-process memory (use Redis if you run several instances).

## 9. Tests

```bash
npm test                      # 17 end-to-end API tests (SQLite stand-in built from schema.sql + mock email provider) + 6 Postgres-adapter tests
node test/browser-flow.js     # optional: real Chromium run of the whole UI flow (needs Playwright)
```
They cover your 10-step flow, invalid/expired OTP, attempt limit, resend cooldown, duplicate email, wrong password, unverified, rejected, email-provider failure, CSRF, role checks and logout.

**What the tests do not cover:** a live Supabase connection. The Postgres adapter is tested against a fake `pg`, and the app's SQL against SQLite. Your first run on Supabase is the first time they meet, so register one test user end to end before relying on it. Startup prints a clear message if `DATABASE_URL` is wrong.

## 10. Not covered yet

Requests, document types, announcements and reports in `portal.js` are still in-memory sample data (next phase). SMS notifications are not implemented (email only).
