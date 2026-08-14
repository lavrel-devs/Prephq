const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const { connectDB } = require('./src/config/db');
const Admin = require('./src/models/Admin');
const Course = require('./src/models/Course');

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
app.use(express.json());
app.set('trust proxy', 1); // needed so req.ip / x-forwarded-for resolve correctly behind Render's proxy

// ══════════════════════════════════════════════════════════════
//  DATABASE
// ══════════════════════════════════════════════════════════════
connectDB().then(async () => {
  await bootstrapAdmin();
  await bootstrapCourses();
});

// Auto-creates the first admin account from ADMIN_KEY if none exist yet,
// so there's always a way into /login.html on a fresh deploy.
async function bootstrapAdmin() {
  try {
    const count = await Admin.countDocuments();
    if (count > 0) return;
    const username = (process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin').toLowerCase().trim();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_KEY, 10);
    await Admin.create({ username, passwordHash });
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  First-run: admin account created                 ║');
    console.log(`║  username: ${username}`);
    console.log('║  password: your ADMIN_KEY value from .env         ║');
    console.log('║  Log in at /login.html, then change your password ║');
    console.log('║  from the admin panel.                            ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
  } catch (e) {
    console.error('Admin bootstrap failed:', e.message);
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
app.use('/api/admin', require('./src/routes/admin.routes'));
app.use('/api/quiz', require('./src/routes/quiz.routes'));
app.use('/api/scores', require('./src/routes/scores.routes'));
app.use('/api', require('./src/routes/student.routes')); // /api/questions/:course, /api/me

// ══════════════════════════════════════════════════════════════
//  STATIC FILES
// ══════════════════════════════════════════════════════════════
// dashboard.html is served as a static file, but it can't render
// anything meaningful without a valid token — auth-guard.js (loaded
// first thing in <head>) checks localStorage for a token before the
// page body ever renders, and hard-redirects to /login.html if it's
// missing/expired. True enforcement (a logged-out user can't fetch
// so much as a name or a score) happens at the API layer above, since
// every data-bearing route requires a verified JWT — the static HTML
// shell itself has no secrets in it.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

app.get('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ══════════════════════════════════════════════════════════════
//  KEEP-ALIVE (Render free tier)
// ══════════════════════════════════════════════════════════════
const YOUR_URL = process.env.SELF_URL || 'https://prephq.onrender.com';
function keepAlive() {
  const randomMinutes = Math.floor(Math.random() * 5) + 10; // 10-14 min
  setTimeout(() => {
    fetch(YOUR_URL).catch(() => {}).finally(keepAlive);
  }, randomMinutes * 60 * 1000);
}
keepAlive();

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  PrepHQ v1.1.0 running on http://localhost:${PORT}   ║`);
  console.log(`║  Student login: http://localhost:${PORT}/login.html  ║`);
  console.log(`║  Admin:         http://localhost:${PORT}/login.html  ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});