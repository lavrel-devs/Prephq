# PrepHQ v1.1.5 — Exam Prep Platform

## What's new in v1.1.5

- **Dynamic courses** — courses now live in a `Courses` MongoDB collection instead of being hardcoded in the frontend. Full admin CRUD (`Course Management` panel in `admin.html`); `GET /api/courses` is public and used by the dashboard's course grid, search bar, and AI quiz picker. Existing course keys/codes were preserved on first boot so nothing breaks.
- **Course search bar** — real-time client-side filter above the course grid on the dashboard.
- **Study material input for AI quizzes** — optional textarea + PDF/txt upload (parsed client-side with pdf.js) that gets folded into the Groq prompt for a hyper-personalized quiz. Never stored server-side.
- **AI Quiz History with real scores** — `GeneratedQuestion` records now capture `userAnswers`, `score`, and `totalQuestions` once a student finishes an AI-generated quiz (`PATCH /api/quiz/history/:id/submit`). The Performance screen shows a summary (total quizzes, average score, per-course bars) plus a scrollable history list, with loading and empty states.
- **Admin Course Management** — add/edit/delete courses from the admin panel; the Questions panel's course selects are now populated live from the same list instead of a hardcoded `<select>`.

---

## What's new in v1.1.0

- **Real JWT authentication** — separate login page (`login.html`) from the app itself (`dashboard.html`/`admin.html`); access tokens expire in 15 min but silently refresh in the background while you're active, and the whole session dies after 3 hours of inactivity
- **Password hashing (bcrypt)** — new accounts and password changes are hashed; old plaintext accounts still log in and get quietly upgraded to a hash on their next login
- **IP + device-fingerprint logging** on every login, stored in a `Session` collection for security auditing, with new-device flagging
- **Credit system** — every student has a `credits` balance (starts at 0); admin can credit/debit any student by matric from the dashboard; every change is logged in a `CreditTransaction` ledger
- **AI quiz generation (Groq)** — students can generate a fresh 10-question quiz for any course/difficulty, gated by credits
- **Admin JWT login** — no more pasting a raw key into a box; the first admin account is auto-created from your `ADMIN_KEY` on first boot
- **Glassmorphism UI** — new pill-shaped bottom nav, glass cards, Font Awesome icons, same color palette as before

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up your .env file
```bash
cp .env.example .env
```

Then edit `.env` — generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
You need **three separate** random values: `ADMIN_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Never reuse one value for more than one of these.

**MongoDB Atlas** (free): cloud.mongodb.com → create a free cluster → Connect → Drivers → copy the URI → paste as `MONGODB_URI`.

**Groq (AI quiz generation)**: console.groq.com → create an API key → paste as `GROQ_API_KEY`. The app still runs fine without this — quiz generation will just return a clear error until it's set.

### 3. Run locally
```bash
npm start
# or for auto-reload:
npm run dev
```

On first boot, watch the console — it prints your auto-created admin login:
```
username: admin
password: your ADMIN_KEY value from .env
```

Open:
- Student/Admin login: http://localhost:3000/login.html
- Register:            http://localhost:3000/register.html

Log in as admin, then **change your admin password** from the panel (Settings → account) rather than leaving it as your raw `ADMIN_KEY` long-term.

---

## Deploying to Render (Free)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New → Web Service → connect the repo
3. Build command: `npm install` · Start command: `node server.js`
4. Add environment variables: `MONGODB_URI`, `ADMIN_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GROQ_API_KEY`
5. Deploy

---

## How auth actually works now

- **Students**: `/login.html` → `POST /api/auth/login` → server returns a short-lived access token + a refresh token. The client (`auth-guard.js`) stores both, attaches the access token as `Authorization: Bearer …` on every API call, and silently calls `POST /api/auth/refresh` before it expires — as long as there's been mouse/keyboard/scroll activity in the last few minutes. If nobody touches the app for 3 hours straight, the session on the server expires and the next refresh attempt fails, bouncing the user back to `/login.html`.
- **Admins**: same mechanism, separate endpoints (`/api/auth/admin/login`, `/api/auth/admin/refresh`). The legacy `x-admin-key` header still works too — it's what `question-uploader.html` and any of your scripts use, so nothing there breaks.
- **Dashboard gating**: `dashboard.html` checks for a valid session *before* anything renders (script runs synchronously at the top of `<head>`), and every piece of real data (`/api/me`, `/api/scores/...`, `/api/quiz/...`) is behind `requireStudent` middleware regardless of what the page itself shows — so there's no path to student data without a valid token, even if someone tampers with the client-side check.

---

## Credits & AI quiz generation

- New students start with **0 credits**.
- Admin → Students table → **Credit** button → enter a signed amount (negative to debit) and an optional note. Fully logged.
- Activation codes can optionally be generated with `creditsGranted > 0`, so a batch of codes can hand out starting credits automatically on registration.
- Each AI quiz generation costs `CREDIT_COST_QUIZ_GEN` credits (default 5, configurable in `.env`). Credits are only charged if Groq successfully returns usable questions — a failed API call costs nothing.

---

## File Structure

```
prephq/
├── server.js                    ← slim entrypoint: middleware, admin bootstrap, route mounting
├── package.json
├── .env.example
├── src/
│   ├── config/db.js
│   ├── models/                  ← Student, Admin, Code, Score, Payment, Question,
│   │                                Session, CreditTransaction, GeneratedQuestion
│   ├── middleware/auth.js       ← requireStudent / requireAdmin (JWT + legacy key fallback)
│   ├── utils/                   ← jwt.js, fingerprint.js, credits.js, codeGen.js
│   ├── services/groq.service.js ← AI quiz generation
│   └── routes/                  ← auth, admin, quiz, scores, student(misc)
└── public/
    ├── login.html                ← student + admin sign-in (new, separate from the app)
    ├── dashboard.html             ← the student app (was index.html)
    ├── admin.html                 ← admin dashboard (now JWT-based)
    ├── register.html
    ├── question-uploader.html
    ├── questions.js
    ├── manifest.json
    ├── css/glass.css              ← glassmorphism layer
    └── js/auth-guard.js           ← shared token storage / silent refresh / fingerprinting
```

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/auth/register | — | Student registration with activation code |
| POST | /api/auth/login | — | Student login (issues JWT pair) |
| POST | /api/auth/refresh | refresh token | Rotate a student's access token |
| POST | /api/auth/logout | refresh token | Revoke a student session |
| POST | /api/auth/admin/login | — | Admin login |
| POST | /api/auth/admin/refresh | refresh token | Rotate an admin's access token |
| POST | /api/auth/admin/logout | refresh token | Revoke an admin session |
| GET | /api/me | student JWT | Current student profile + live credit balance |
| GET | /api/questions/:course | — | Public admin-authored question bank |
| GET/POST | /api/scores/:matric | student JWT (own matric only) | Get / save quiz scores |
| POST | /api/quiz/generate | student JWT | AI-generate a quiz (credit-gated, accepts optional `studyMaterial`) |
| GET | /api/quiz/history | student JWT | Student's past AI quizzes |
| PATCH | /api/quiz/history/:id/submit | student JWT | Record answers/score for a finished AI quiz |
| GET | /api/courses | — | Public list of all courses |
| GET | /api/admin/stats | admin | Dashboard stats |
| GET/POST | /api/admin/students | admin | List / add students |
| PUT/DELETE | /api/admin/students/:matric | admin | Edit / delete student |
| POST | /api/admin/students/:matric/credits | admin | Credit/debit a student's balance |
| GET | /api/admin/students/:matric/credits/history | admin | That student's credit ledger |
| GET | /api/admin/codes | admin | List codes |
| POST | /api/admin/codes/generate | admin | Generate a batch of codes (with optional expiry + starting credits) |
| PUT/DELETE | /api/admin/codes/:id | admin | Update / delete a code |
| GET/POST | /api/admin/payments | admin | List / record payments |
| GET/POST | /api/admin/questions | admin | List / add questions |
| PUT/DELETE | /api/admin/questions/:id | admin | Edit / delete a question |
| GET/POST | /api/admin/courses | admin | List / add courses |
| PUT/DELETE | /api/admin/courses/:id | admin | Edit / delete a course |
| POST | /api/admin/admins | admin | Create another admin account |
| PUT | /api/admin/admins/me/password | admin | Change your own admin password |

All `admin` routes also accept the legacy `x-admin-key: <ADMIN_KEY>` header instead of a JWT, for scripts/tools.
