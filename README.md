# BarangayDocs – Civic Portal

Online barangay document requests: **landing → sign in / register → resident dashboard or admin dashboard**.

Plain HTML/CSS/JS. There is no build step and there are no dependencies. The design is the final Figma-derived design, unchanged. It was split into files and wired together with a shared session, role-based redirects and route guards.

---

> **Backend now included.** Real login, registration, email OTP and admin approval run on `server.js` + Supabase (PostgreSQL). Setup steps: **[AUTH_SETUP.md](AUTH_SETUP.md)**. The mock-mode notes below still apply when `USE_MOCK` is `true` in `js/config.js`.


## Quick start

```bash
npm start          # or: node server.js        (Node 18+)
# open http://localhost:5173
```

You can also open `index.html` directly from disk or deploy the folder to any static host. All routing is hash-based, so no server rewrite rules are needed.

### Demo accounts (mock mode)

| Role     | Email / Citizen ID                                  | Password     |
|----------|-----------------------------------------------------|--------------|
| Resident | `juan@example.com` or `RES-2026-0001`               | `demo1234!`  |
| Admin    | `admin@barangaydocs.gov.ph`                         | `admin1234!` |

For any OTP screen (register or forgot password) the code is **`123456`** (mock mode shows a small hint under the code boxes; the login screen shows no demo text).

Demo registrations (password `demo1234!`) are seeded on first run so the admin approval tab has data:
`pedro.santos@example.com`, `liza.gomez@example.com`, `carlo.mendoza@example.com` (pending), `ramon.dizon@example.com` (approved), `teresa.v@example.com` (rejected).

Newly registered users are stored in the browser (`localStorage`), so you can register, verify, log out and sign in again.

---

## How the two files were connected

| Original file | Became |
|---|---|
| `landing-register-login-final.html` | `index.html` + `css/landing.css` + `js/landing.js` + `js/auth-ui.js` |
| `BarangayDocs_Civic_Portal_2px.html` | `app.html` + `css/portal.css` + `js/portal.js` |
| (new) | `js/config.js`, `js/auth.js`, `server.js`, `package.json` |

They stay as **two pages** on purpose. Both designs use generic, unscoped class names (`.card`, `.btn`, `.b`, `nav`…) that clash when merged, and keeping them separate leaves the design pixel-identical.

```
 index.html (public)                                  app.html (private)
 ┌───────────────────────────┐   Auth.login()   ┌─────────────────────────────┐
 │ Landing  #home            │ ───────────────▶ │ role = resident → #/resident │
 │ Sign in  #login           │   session saved  │ role = admin    → #/admin    │
 │ Register #register (3 steps: details→ID→OTP)│                             │
 │ Forgot   #forgot (email→OTP→new password)   │ ◀─────────────── Auth.logout()│
 └───────────────────────────┘                  └─────────────────────────────┘
```

What changed from the prototypes:

- **Sign in** calls `Auth.login()` and redirects by role (admin → `app.html#/admin`, resident → `app.html#/resident`).
- **Register / OTP / Reset password** call `Auth`. After the email OTP the resident is **not** signed in: the final screen now says *Please wait for admin approval* (see "Resident approval" below).
- **Route guards.** `app.html` bounces to `index.html#login` without a session. Residents cannot open `#/admin`, and admins cannot open `#/resident` (`render()` in `portal.js`).
- **Return-to link.** Clicking *Track Now* while signed out sends the user to sign in, then back to the tracking page.
- **Landing page** is unchanged: the header always shows Login and Register (even when a session exists), and the sign-in / register screens always open normally.
- **Portal identity.** The sidebar name, initials, greeting ("Magandang araw, Maria!") and form prefill (Full Name) come from the session instead of the hard-coded "Juan Dela Cruz".
- **My Profile popup:** on both dashboards the name/avatar at the bottom of the sidebar is clickable (mouse or keyboard). It opens a popup with personal info and account details (resident: Resident ID, status, member since, ID on file; admin: Staff ID, role, office, sign-in time) with Close and Log out. Esc or a click outside closes it.
- **Log out** clears the session and returns to the landing page.
- **Removed** the Resident/Admin floating preview switcher, which was a design-review tool and would bypass the role guards.
- **Fonts** were extracted from base64 into `assets/fonts/*.woff2` and are shared by both pages. The portal no longer needs Google Fonts.

---

## Resident approval (admin verifies every new resident)

```
Register (email, password, name, birth date, phone, valid ID)
   -> email OTP -> status = pending
   -> "Please wait for admin approval" screen         (resident cannot sign in yet)
Admin: sidebar "Residents" (badge = pending count)  -> #/admin/residents
   -> opens a registration -> compares the uploaded valid ID with the details
   -> ticks the 4-point checklist (name matches, readable, not expired, address in barangay)
   -> Approve  -> resident can sign in
   -> Reject (reason required) -> resident sees the reason on sign-in and may register again
```

- Sign-in answers `403` with `code: "pending"` (amber message) or `code: "rejected"` (message with the admin's reason).
- The admin dashboard shows an alert when registrations are waiting; the sidebar badge refreshes every `POLL_MS`.
- **Approve is blocked until all four checklist items are ticked**; rejecting requires a reason.
- Pending queue is shown oldest first. Tabs: Pending, Approved, Rejected, All, plus search by name, email or resident ID.
- In mock mode the uploaded ID is kept in `localStorage` only if it is under about 1.2 MB, which is enough for the demo.

---

## Project structure

```
barangaydocs/
├── index.html            Landing + sign in / register / OTP / reset
├── app.html              Portal shell (resident + admin dashboards)
├── css/
│   ├── fonts.css         @font-face (Inter 400/500/600, Outfit 700/800)
│   ├── landing.css       Landing + auth styles (scoped to #landing / #auth)
│   └── portal.css        Dashboard styles
├── js/
│   ├── config.js         ★ Front-end settings (mock on/off, API base URL …)
│   ├── auth.js           ★ Session + auth service (mock and real API)
│   ├── landing.js        Track form, signed-in header state
│   ├── auth-ui.js        Sign in / register / OTP / reset screens
│   └── portal.js         Resident + admin pages, notifications, router
├── assets/
│   ├── fonts/            woff2 files
│   └── img/              favicon.svg  (+ put hero.jpg here)
├── server.js             Zero-dependency static dev server
└── package.json          npm start / npm run check
```

### Routes (`app.html`)

| Role | Hash route | Page |
|---|---|---|
| Resident | `#/resident` | Dashboard (+ notification bell) |
| Resident | `#/resident/new` | New request wizard (4 steps) |
| Resident | `#/resident/history` | Request history |
| Resident | `#/resident/track[/CODE]` | Request tracking timeline |
| Admin | `#/admin` | Staff console / service queue |
| Admin | `#/admin/residents` | **Resident approvals** (pending / approved / rejected) |
| Admin | `#/admin/resident/:id` | **Review a registration** and its valid ID |
| Admin | `#/admin/requests` | All requests |
| Admin | `#/admin/review/:tracking/:name` | Review, approve, reject, ask for info |
| Admin | `#/admin/types` · `#/admin/announce` · `#/admin/reports` | Types, announcements, reports |

---

## Going live: replace the mock with a real backend

1. In `js/config.js`, set `USE_MOCK: false` and set `API_BASE`.
2. Implement the endpoints below. `auth.js` and the notification code in `portal.js` already call them.

### Auth (`js/auth.js`)

| Method & path | Body | Returns |
|---|---|---|
| `POST /auth/login` | `{ id, password }` (id = email or Citizen ID) | `{ user:{id,citizenId,name,email,role}, token? }` – `401` bad credentials; **`403 { code:"pending" }`** awaiting approval; **`403 { code:"rejected", reason }`** |
| `POST /auth/register` | multipart: `email, password, name, dob, phone, valid_id` (file) | `201`; sends the OTP email. `409` if the email is already verified |
| `POST /auth/verify-otp` | `{ email, code, purpose:"register"\|"reset" }` | register → `{ pending:true }` (**no session**); reset → `{ resetToken }` |
| `POST /auth/resend-otp` | `{ email, purpose }` | `204` |
| `POST /auth/forgot-password` | `{ email }` | `204`. Respond identically whether or not the account exists |
| `POST /auth/reset-password` | `{ email, password, resetToken }` | `204` |
| `POST /auth/logout` | – | `204` |
| `GET /auth/me` | – | profile for the popup: `{ id, citizenId, name, email, role, phone, dob, createdAt, status, idFileName }` |

`role` must be `"resident"` or `"admin"`.

### Resident approval (admin only, wired in `portal.js`)

| Method & path | Body | Returns |
|---|---|---|
| `GET /admin/residents` | – | `{ data:[Resident] }` (email-verified registrations, any status) |
| `PATCH /admin/residents/:id` | `{ status:"approved"\|"rejected", reason? }` | updated `Resident`. **Also send the resident an email + SMS.** |

```
Resident = { id, citizenId, name, email, phone, dob, createdAt, status:"pending"|"approved"|"rejected",
             note, decidedAt|null, idFileName, idUrl }   // idUrl = short-lived signed URL to the private ID file
```

The server must check the admin role on both endpoints and record who decided and when (audit log).

### Notifications (already wired in `portal.js`)

```
GET   /notifications?status=all&limit=20  -> { data:[Notification], unread_count, next_cursor }
PATCH /notifications/:id/read             -> Notification
POST  /notifications/read-all             -> { updated }
Notification = { id, type, title, message, tracking_no|null, created_at, read_at|null }
type: ready | approved | processing | submitted | rejected | announcement | account
```

The server must scope results to the signed-in resident.

### Requests, announcements, document types and reports (now real, no mock data)

Everything below is served by the backend and stored in PostgreSQL. **Mock mode (`USE_MOCK: true`) only covers sign-in and the notification bell; the request/announcement screens need the backend.**

| Area | Endpoints | Who |
|---|---|---|
| Document types + forms | `GET /document-types` (forms/validation live in `server/forms.js`) | any signed-in user |
| Submit / list / open my requests | `POST /requests` (multipart), `GET /requests`, `GET /requests/:trackingNo` | residents only, always scoped to the session user |
| Answer an "additional information" request (text and/or JPG/PNG image) | `POST /requests/:trackingNo/respond` | the owning resident, only while staff's request is outstanding |
| Full text of one published announcement (for the expanded notification) | `GET /announcements/:id` | any signed-in user |
| **Public tracking (landing page, no sign-in)** | `GET /public/track/:code` | anyone; returns status + timeline only |
| Queue, review, status actions | `GET /admin/requests`, `GET|PATCH /admin/requests/:id` (`start`, `approve`, `reject`, `info`, `complete`, `note`), `GET /admin/requests/:id/files/:fileId` | admin |
| Dashboard / reports | `GET /admin/dashboard`, `GET /admin/reports` | admin |
| Document types, announcements | `GET|PATCH|DELETE /admin/document-types` (types can be edited or removed, not added), `/admin/announcements` | admin |

Status flow: `pending -> processing -> ready -> completed`, `pending|processing -> rejected`. Any other change is refused (409), so a repeated click cannot create a second history row or notification. Notifications are de-duplicated by a unique `(user_id, ref_key)` index. Announcements reach residents only through the notification bell: publishing notifies once, editing updates the text, and unpublishing or deleting removes the notification again.

**Tracking codes** look like `BR-2026-00125-K7Q9X`: the random suffix means a code cannot be guessed by counting. Public tracking only works for codes in this format (older codes without the suffix can still be opened by their owner after signing in). The public response contains the status, dates and staff status messages (rejection reason, what information was requested, claim date) and nothing else: no name, contact details, address, document type, uploads, internal notes or anything the resident wrote. Lookups are rate-limited per IP and every unknown/malformed code gets the same "not found" reply.

Announcement titles are limited to 50 characters. Forms that already ask for the purpose (Barangay Certification: Purpose, Certificate of Indigency: Reason) don't ask again in the shared details step, and no form asks for a preferred date.

Every built-in document form asks for a Valid ID upload (Clearance also asks for the Cedula; Indigency asks for the recipient's ID, plus the representative's ID when a representative is named). Uploads are stored one row per file in `request_files`.

**Database:** re-run `npm run db:init` (or paste `database/schema.sql` into the Supabase SQL editor). It only *adds* tables (`document_types`, `requests`, `request_history`, `request_files`, `announcements`) and one nullable column (`notifications.ref_key`); existing users, sessions and notifications are untouched. No new environment variables.

**Tests:** `npm test` (API workflow, authorization, duplicates). Browser run-through (needs Python + Playwright): `python3 test/browser/e2e.py`.

---

## Security notes (read before production)

- **Never serve uploaded IDs from a public folder.** Return a short-lived signed URL (`idUrl`) only to authorised staff, and store the files encrypted.
- **The mock auth is for demos only.** Passwords are stored in plain text in `localStorage`, and the role is trusted from the client. The front-end guards are UX only.
- A real backend must enforce authentication and role checks on **every** API call and on admin-only data. Prefer an **httpOnly, Secure, SameSite cookie** session (the code already sends `credentials:'include'`). Bearer tokens in `localStorage` are supported for convenience but are weaker.
- Hash the passwords (argon2/bcrypt), rate-limit login and OTP, expire OTPs (UI shows 5 min), and avoid account enumeration.
- Store uploaded IDs privately (not publicly served) and validate type and size server-side. The UI only checks JPG/PNG/PDF and 5 MB.
- Data handling should follow the Philippines Data Privacy Act (RA 10173), as stated on the sign-in screen.
- Add a `Content-Security-Policy` header when deploying. The pages use inline event handlers (`onclick=…`), so it needs `script-src 'self' 'unsafe-inline'` until those are refactored.

---

## Known gaps / next steps

- `assets/img/hero.jpg` is **not included**. Export the hero photo from Figma to that path. Until then the landing shows the gradient and one harmless 404 in the console.
- Registration does not ask for a home address, so admins compare the address printed on the ID with the barangay area. Consider adding an Address / Purok field (and auto-flagging mismatches).
- The tracking page shows static timeline data for any code. Hook `trackPg()` to `GET /requests/:tracking_no`.
- *Contact Support*, the footer links and *View Copy* are visual only.
- Inter 700 is not embedded (design uses 400/500/600), so bold UI text renders at 600.
- Barangay ID prefill in the wizard still has sample values (first/last name are swapped in the original design data).
- `portal.js` re-renders by replacing `innerHTML`. That is fine for this size, but consider a small framework if the portal grows.

## Scripts

```bash
npm start        # dev server on :5173  (PORT=8080 npm start to change)
npm run check    # syntax-check all JS files
```


## Official documents: generate, preview and print (admin)

Admins open a request (Admin → All Requests → a request) and click **Generate / Print Document**. The server picks the right
template, fills it with the resident's real submitted information, shows a PDF preview, and the admin presses **Print**
(browser print dialog) or **Download Word (.docx)**.

| Menu document | Template (original Word page) |
|---|---|
| Barangay Certification | `server/docgen/templates/certification.docx` |
| Certificate of Indigency | `indigency.docx` (no representative) / `indigency-rep.docx` (a representative is named) |
| Certificate of Residency | `residency.docx` |

Barangay Clearance, Barangay ID and Letter of Residency have no template yet; the button explains this instead of printing something wrong.

* **PDF preview/print needs LibreOffice on the server** (free, libreoffice.org). The Word download works without it.
  If it is not found automatically, set `SOFFICE_PATH` in `.env`, e.g. `SOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe`.
* If something the certificate needs is missing from the request, nothing is generated and the admin sees exactly what is missing.
* The templates (which contain the official logo and the Punong Barangay's signature) live in `server/docgen/templates/`.
  That folder is **not** web-accessible, generation is admin-only (checked on the server), generated files are sent with `no-store`
  and are never saved, and every preview/download is written to the audit log. Do not publish this folder (e.g. on a public GitHub repo).
* The templates were built from the barangay's original Word file with `python3 tools/build_templates.py INDIGENCY_2026.docx`
  (nothing is redrawn; only the sample resident's text became `{{PLACEHOLDERS}}`). You can also open a template in Word to adjust wording, keeping the `{{...}}` tokens.
# BarangayDocs
