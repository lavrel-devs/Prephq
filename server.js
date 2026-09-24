require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors     = require('cors');
const helmet   = require('helmet');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const { connectDB } = require('./src/config/db');
const Admin = require('./src/models/Admin');
const Course = require('./src/models/Course');
const { initStudyRoomSockets } = require('./src/realtime/studyRoom.socket');
const { activityMiddleware, flushActivity } = require('./src/services/activity.service');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════
//  REQUIRED SECRETS GUARD
// ══════════════════════════════════════════════════════════════
const REQUIRED = ['MONGODB_URI', 'ADMIN_KEY', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].startsWith('REPLACE_WITH'));
if (missing.length) {
  console.error('\n╔══════════════════════════════════════════════════╗');
  console.error('║  Missing required .env values:                    ║');
  missing.forEach(k => console.error(`║   - ${k}`));
  console.error('║  Generate secrets with:                           ║');
  console.error("║  node -e \"console.log(require('crypto')           ║");
  console.error("║    .randomBytes(32).toString('hex'))\"             ║");
  console.error('╚══════════════════════════════════════════════════╝\n');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════════
// CSP is left off deliberately: every page in this app (login,
// dashboard, admin) relies heavily on inline <script>/<style> blocks
// by design (single-file vanilla pages, no build step). A strict CSP
// would break all of them. Everything else Helmet provides
// (X-Content-Type-Options, X-Frame-Options / frameguard, HSTS,
// referrer-policy, etc.) is still active.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.set('trust proxy', 1); // set BEFORE any middleware so req.ip / rate limiting see the real client behind Render's proxy
// 1mb: the default 100kb made PUT /api/student-data (notes/bookmarks backup) fail for heavy users.
app.use(express.json({ limit: '1mb' }));
app.use(activityMiddleware); // logs every API request + page view (see services/activity.service.js)

// ══════════════════════════════════════════════════════════════
//  DATABASE
// ══════════════════════════════════════════════════════════════
connectDB().then(async () => {
  await bootstrapAdmin();
  await require('./src/utils/migratePlans').migratePlans();
  await ensureOwnerAdmin();
  await bootstrapCourses();
  require('./src/services/scheduler.service').startScheduler();
  // Pick up a bulk note-writing job that was running when the server last restarted.
  require('./src/services/noteJob.service').resumeInterrupted().then(n => n && console.log(`Resumed ${n} interrupted note job(s).`)).catch(e => console.error('Note job resume failed:', e.message));
}).catch(e => console.error('Startup tasks failed:', e));

// One stray rejected promise must not take the whole server down.
// Don't lose the last couple of seconds of log rows on a restart/deploy.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { try { await flushActivity(); } finally { process.exit(0); } });
}
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

// Auto-creates the first admin account from ADMIN_KEY if none exist yet,
// so there's always a way into /login.html on a fresh deploy.
async function bootstrapAdmin() {
  try {
    const count = await Admin.countDocuments();
    if (count > 0) return;
    const username = (process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin').toLowerCase().trim();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_KEY, 10);
    await Admin.create({ username, passwordHash, isOwner: true });
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  First-run: admin account created                 ║');
    console.log(`║  username: ${username}`);
    console.log('║  password: your ADMIN_KEY value from .env         ║');
    console.log('║  Log in at /login, then change your password      ║');
    console.log('║  from the admin panel.                            ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
  } catch (e) {
    console.error('Admin bootstrap failed:', e.message);
  }
}

// The "owner" is the main admin: the only one who can open/download the Activity Log and
// who can't be demoted or removed. If none is marked yet (existing deployments), the
// oldest active admin — the one bootstrapped from ADMIN_KEY — becomes the owner.
async function ensureOwnerAdmin() {
  try {
    if (await Admin.exists({ isOwner: true })) return;
    const first = await Admin.findOneAndUpdate(
      { active: { $ne: false } },
      { $set: { isOwner: true, fullAccess: true } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (first) console.log(`Owner admin set to "${first.username}"`);
  } catch (e) {
    console.error('Owner bootstrap failed:', e.message);
  }
}

// Seeds the Courses collection from the original hardcoded course list
// (v1.1.0 and earlier had these baked into dashboard.html) if the
// collection is empty, so a fresh deploy doesn't come up with an empty
// course grid. Once courses exist, this never runs again — all further
// course management happens from the admin panel.
async function bootstrapCourses() {
  try {
    const count = await Course.countDocuments();
    if (count > 0) return;
    const defaults = [
      { courseCode: 'GST101', key: 'gst101', courseTitle: 'Use of English',    department: 'GST', level: '100', color: '#0A5CF5', icon: 'translate' },
      { courseCode: 'GST102', key: 'gst102', courseTitle: 'Communication',     department: 'GST', level: '100', color: '#00C96B', icon: 'edit' },
      { courseCode: 'GST103', key: 'gst103', courseTitle: 'Peoples & Culture', department: 'GST', level: '100', color: '#F5930A', icon: 'globe' },
      { courseCode: 'STA111', key: 'sta111', courseTitle: 'Statistics',        department: 'STA', level: '100', color: '#7B2CF5', icon: 'bar' },
      { courseCode: 'PHY101', key: 'phy101', courseTitle: 'Mechanics',         department: 'PHY', level: '100', color: '#0ABCF5', icon: 'lightning' },
      { courseCode: 'PHY107', key: 'phy107', courseTitle: 'Lab Measurements',  department: 'PHY', level: '100', color: '#00C96B', icon: 'flask' },
      { courseCode: 'MTH101', key: 'mth101', courseTitle: 'Mathematics I',     department: 'MTH', level: '100', color: '#F5340A', icon: 'calc' },
      { courseCode: 'MTH103', key: 'mth103', courseTitle: 'Mathematics III',   department: 'MTH', level: '100', color: '#F5930A', icon: 'math' },
      { courseCode: 'CHM141', key: 'chm141', courseTitle: 'Chemistry',         department: 'CHM', level: '100', color: '#00C96B', icon: 'atom' },
      { courseCode: 'BIO101', key: 'bio101', courseTitle: 'Biology',           department: 'BIO', level: '100', color: '#0A5CF5', icon: 'dna' },
      { courseCode: 'CSC101', key: 'csc101', courseTitle: 'Computer Science',  department: 'CSC', level: '100', color: '#0ABCF5', icon: 'code' },
      { courseCode: 'COS101', key: 'cos101', courseTitle: 'Computer Systems',  department: 'COS', level: '100', color: '#6B7089', icon: 'laptop' },
      { courseCode: 'BONUS',  key: 'extra',  courseTitle: 'Grammar & Study',   department: 'GST', level: '100', color: '#F5930A', icon: 'star' },
    ];
    await Course.insertMany(defaults);
    console.log(`Course bootstrap: seeded ${defaults.length} default courses.`);
  } catch (e) {
    console.error('Course bootstrap failed:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════
app.use('/api/auth', require('./src/routes/auth.routes'));
// Every /api/admin request is authenticated and then checked against the admin's
// permissions (utils/adminAccess.js) before reaching any admin router.
const { requireAdmin, adminGate } = require('./src/middleware/auth');
app.use('/api/admin', requireAdmin, adminGate);
app.use('/api/admin', require('./src/routes/admin/admin.admins.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.activity.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.credits.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.contests.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.users.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.announcements.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.contest-templates.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.analytics.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.support.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.followups.routes'));
app.use('/api/admin', require('./src/routes/admin/admin.notes.routes'));
app.use('/api/quiz', require('./src/routes/quiz.routes'));
app.use('/api/flashcards', require('./src/routes/flashcards.routes'));
app.use('/api', require('./src/routes/transfer.routes'));
app.use('/api', require('./src/routes/contest.routes'));
app.use('/api', require('./src/routes/leaderboard.routes'));
app.use('/api', require('./src/routes/studyRoom.routes'));
app.use('/api', require('./src/routes/chat.routes'));
app.use('/api/scores', require('./src/routes/scores.routes'));
app.use('/api', require('./src/routes/studyguide.routes'));
app.use('/api', require('./src/routes/cosmetics.routes'));
app.use('/api', require('./src/routes/support.routes'));   // upgrade requests + question reports
app.use('/api', require('./src/routes/study.routes'));     // study plan, exam overview, achievements
app.use('/api', require('./src/routes/notes.routes'));     // course notes
app.use('/api/admin', require('./src/routes/admin/admin.cosmetics.routes'));
app.use('/api', require('./src/routes/student.routes')); // /api/questions/:course, /api/me

// Which backend is actually running? (Handy when the browser has newer files than the server process.)
app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

// Unknown /api paths must answer JSON, not the HTML login page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ══════════════════════════════════════════════════════════════
//  CLEAN ROUTES (v1.2)
// ══════════════════════════════════════════════════════════════
// The spec asks for clean paths (/dashboard instead of /dashboard.html,
// etc). Old .html URLs are left working via the static middleware below
// — nothing that already links to *.html breaks — these are additive
// aliases, checked first.
const PAGE_ROUTES = {
  '/login':     'login.html',
  '/register':  'register.html',
  '/dashboard': 'dashboard.html',
  '/admin':     'admin.html',
  '/profile':   'profile.html',
  '/contests':  'contests.html',
  '/leaderboard': 'leaderboard.html',
  '/study-rooms': 'study-rooms.html',
  '/chat': 'chat.html',
  '/forgot-password': 'forgot-password.html',
  '/change-password': 'change-password.html',
};
Object.entries(PAGE_ROUTES).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

// ══════════════════════════════════════════════════════════════
//  STATIC FILES
// ══════════════════════════════════════════════════════════════
// dashboard.html is served as a static file, but it can't render
// anything meaningful without a valid token — auth-guard.js (loaded
// first thing in <head>) checks localStorage for a token before the
// page body ever renders, and hard-redirects to /login if it's
// missing/expired. True enforcement (a logged-out user can't fetch
// so much as a name or a score) happens at the API layer above, since
// every data-bearing route requires a verified JWT — the static HTML
// shell itself has no secrets in it.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ══════════════════════════════════════════════════════════════
//  KEEP-ALIVE (Render free tier)
// ══════════════════════════════════════════════════════════════
// Only runs on Render (RENDER=true) or when SELF_URL is set, so local dev
// no longer pings the production site.
const YOUR_URL = process.env.SELF_URL || (process.env.RENDER ? 'https://prephq.onrender.com' : '');
function keepAlive() {
  const randomMinutes = Math.floor(Math.random() * 5) + 10; // 10-14 min
  setTimeout(() => {
    fetch(`${YOUR_URL.replace(/\/$/, '')}/healthz`).catch(() => {}).finally(keepAlive);
  }, randomMinutes * 60 * 1000);
}
if (YOUR_URL) keepAlive();

// Global error handler (malformed JSON bodies etc.) — JSON, never a stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Server error' });
});

// ══════════════════════════════════════════════════════════════
//  SOCKET.IO (v1.3 — real-time study rooms)
// ══════════════════════════════════════════════════════════════
// app.listen() (used pre-v1.3) doesn't give access to the underlying
// HTTP server instance that Socket.io needs to attach to, so this is
// now built explicitly and the socket layer piggybacks on the exact
// same server/port — no separate process or port to manage.
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
initStudyRoomSockets(io);

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
httpServer.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  PrepHQ v1.6.1 running on http://localhost:${PORT}   ║`);
  console.log(`║  Student login: http://localhost:${PORT}/login       ║`);
  console.log(`║  Admin:         http://localhost:${PORT}/login       ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});