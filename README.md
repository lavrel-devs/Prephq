# PrepHQ — Exam Prep Platform

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up your .env file
```bash
cp .env.example .env
```

Then edit `.env`:

**Generate your admin key** (run this in terminal):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and paste it as your `ADMIN_KEY` in `.env`.

**MongoDB Atlas** (free):
1. Go to https://cloud.mongodb.com
2. Create a free cluster
3. Click Connect → Drivers → copy the URI
4. Replace USERNAME and PASSWORD in the URI
5. Paste it as `MONGODB_URI` in `.env`

### 3. Run locally
```bash
npm start
# or for auto-reload:
npm run dev
```

Open:
- Student app: http://localhost:3000
- Register:     http://localhost:3000/register.html
- Admin:        http://localhost:3000/admin.html

---

## Deploying to Render (Free)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Set:
   - Build command: `npm install`
   - Start command: `node server.js`
5. Add environment variables:
   - `MONGODB_URI` = your Atlas URI
   - `ADMIN_KEY`   = your generated key
6. Click Deploy

---

## How the Activation Code System Works

1. Admin generates codes in bulk from the admin dashboard
2. Student pays (cash/transfer/OPay etc.)
3. Admin gives student their code via WhatsApp
4. Student goes to `/register.html`, fills in details + code
5. Account is created instantly
6. Student logs in at `/` with their matric number

---

## File Structure

```
prephq/
├── server.js          ← Express backend + all API routes
├── package.json
├── .env.example       ← Copy to .env and fill in values
├── .gitignore
├── data/              ← (local dev only, not used in production)
└── public/
    ├── index.html     ← Student quiz app
    ├── register.html  ← Student registration with activation code
    ├── admin.html     ← Admin dashboard
    ├── questions.js   ← Question bank (FUL courses)
    └── manifest.json  ← PWA manifest
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/login | Student login |
| POST | /api/auth/register | Student registration with code |
| POST | /api/auth/admin | Admin authentication |
| GET | /api/admin/stats | Dashboard stats |
| GET/POST | /api/admin/students | List / add students |
| PUT/DELETE | /api/admin/students/:matric | Edit / delete student |
| GET | /api/admin/codes | List codes |
| POST | /api/admin/codes/generate | Generate batch of codes |
| PUT/DELETE | /api/admin/codes/:id | Update / delete code |
| GET/POST | /api/admin/payments | List / record payments |
| GET/POST | /api/admin/questions | List / add questions |
| PUT/DELETE | /api/admin/questions/:id | Edit / delete question |
| GET/POST | /api/scores/:matric | Get / save quiz scores |
