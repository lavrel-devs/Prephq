# PrepHQ — bug-fix pass (v1.4.1)

Not run against a live MongoDB. Test the credit, contest and study-room changes on staging first.

## Security
- Stored XSS in admin.html (student name/matric/phone/payment fields) is escaped; matric/name/phone are now validated server-side at signup and admin-add.
- Suspended students, deactivated admins and revoked sessions lose access within ~30s (sockets too).
- Admin key compared in constant time; login rate limit keyed by IP+matric; refresh has its own limiter.
- x-forwarded-for no longer trusted directly; passwordHash / legacy password no longer sent to the admin browser.
- `?status[$ne]=` leaked draft contests; leaderboard regex was unescaped; PUT /codes/:id accepted arbitrary fields.
- Socket handlers crashed the whole process on a missing payload.
- AI text sanitised; CSV exports escaped.

## Money / credits
- Atomic conditional $inc for all credit changes; daily refresh and streak bonus claim atomically.
- Ledger enum gained flashcard_generation / cosmetic_purchase.
- Cosmetics: schema fields, mounted routes, purchase race, type checks.
- Transfers: per-sender serialization, refund on failure, inactive recipients blocked.
- Contests: atomic settlement, fair raffle, serialized joins, 0% no longer retakeable, team cancellations refund, duplicate no longer copies teams, recurring spawn grace window.
- Quiz/flashcard generation refund on save failure; flashcards require a real course.

## Correctness
- Study rooms: server-side answer window, atomic scoring, no double-advance, mid-game reconnect.
- Route order for /users/course-list and /users/tier-distribution; study-guide weak-course aggregation; tier expiry checks.
- Chat quota; reasoning-model token budgets; AI answer-index validation.
- Admin: N+1 queries, cascade delete, suspend revokes sessions, question edit NaN, username clear via $unset.
- Matrics containing "/" are URL-encoded. Client refresh is single-flight and no longer logs out on 429/5xx.
- Manifest icons added; /api 404s return JSON; body limit 1mb; global error handler; keep-alive only on Render.

## Known limitations
- Leaderboard/timed contest scores via POST /contests/:id/score are still client-reported (clamped, increase-only).
- The in-process lock assumes a single Node instance.
- Existing odd matric/name values are displayed escaped but not migrated.

## v1.4.2 — admin roles & course editor
- New **Admins & Access** page (full-access admins only): create admins, grant full access or per-area access (each area: none / view only / view & change), edit, reset password, deactivate, delete. Guards: you can't demote/deactivate/delete yourself, and the last active full-access admin can't be removed.
- Permissions are enforced on the server for every `/api/admin/*` request (`utils/adminAccess.js`, `adminGate`); unknown endpoints are full-access only. Existing admins and the legacy ADMIN_KEY keep full access. Changes apply within ~30s (immediately for deactivation).
- The panel hides tabs an admin can't open and shows a message on a denied action.
- A "students" admin can create accounts but can't give starting credits/payments (needs Credits/Payments areas). A "contests" admin can adjust contest prizes.
- Students: the dashboard course grid only listed registered courses (so it could only be used to deselect). Added an "Add / edit my courses" tile; the editor now always loads the full catalog, lists selected courses first, shows a count, and clears stale search text.

## v1.4.3 — codes removed, neumorphic admin, activity log
- **Activation codes removed entirely**: `Code` model, `/api/admin/codes*`, the `code` field at signup, `Student.codeUsed`, the admin Codes tab/modal, the Codes permission area, and codeGen. Old `codes` documents stay in MongoDB untouched (drop the collection if you like).
- **Admin UI is now neumorphic** (raised cards/buttons, pressed inputs/active nav, light + dark).
- **Activity Log (owner only)**: every API request, page view, socket event, credit movement and scheduled job is recorded (who, what, status, IP, duration, redacted body). Admin → Activity Log lets the owner browse a day, filter, and download that day as CSV (opens in Excel) or JSONL. Passwords/tokens are never stored; chat text and notes keep only their length. There is no delete route; rows older than `ACTIVITY_LOG_RETENTION_DAYS` (default 365, 0 = forever) are purged nightly.
- **Owner**: the oldest admin (the ADMIN_KEY bootstrap one) is marked owner on first boot; it can't be demoted, deactivated or deleted, and only it can reset its own password. The ADMIN_KEY header counts as owner.

## v1.5.0 — Free/Premium plans, feature switches, flashcard fix, signup passwords
- **Plans**: Basic removed. Only Free and Premium (weekly / monthly / yearly / lifetime). `Student.tier` is `free|premium`; `Student.premiumPlan` records the period. **Lifetime is a distinct entitlement** (no expiry is ever consulted). On boot (idempotent) Basic/Pro students become Premium keeping any expiry date, and Settings gets a `premium` tier seeded from the old Pro prices/limits. Weekly/Lifetime prices start unset and stay hidden until you set them in Admin → Credit Settings.
- **Entitlements**: `src/services/entitlements.service.js` is the single source of truth (plan → feature → allow/deny). Routes use `requireFeature('<key>')`; the frontend reads `entitlements.features` from `/api/me`. Gated: AI Tutor, Practice questions (`GET /api/questions/:course` now requires login), AI question generation, Flashcards, Exam mode (question delivery with `?mode=exam` + saving exam scores), AI study guide, Study rooms (REST + socket), Contests, Credit transfers.
- **Free-plan switches**: Admin → Credit Settings → "Free plan — feature switches". Saves immediately and is enforced server-side; Premium is unaffected. Defaults keep today's behaviour (Flashcards and Study guide OFF for Free, everything else ON).
- **Admin plan assignment**: Plan button accepts free / weekly / monthly / yearly / lifetime.
- **Play button**: `.btn-surf` is `width:100%`; inside the Saved Quizzes flex row the Play button became card-wide and overflowed. Added `.btn-play` (size to content).
- **Flashcards wrong-course bug — root cause**: after generating CHM102 the code called `showScr('flashcards')`, and `showScr` auto-ran `loadFlashcardDeck()`, which fetched a mixed deck for ALL registered courses and replaced the CHM102 deck a moment later (BIO102 cards happened to be first). Fixed: no side-effect reloads; explicit selected course (`fcCourse`) passed to every request; course selector replaces the `prompt()`; request IDs + epoch guard so late responses can't overwrite newer state; single-course decks only accept that course's cards; server echoes the course and returns a `FlashcardSet` record (userId, course, topic, timestamp, card ids); progress lookups now match key/code spellings (they silently missed before).
- **Signup**: password + confirm, show/hide toggle, min 8 chars, must differ from matric, bcrypt-hashed, never echoed back. Existing users and login are unchanged.

## v1.4.4 — plan/entitlement verification pass, topic identification, AI question count, exam countdown
Inspection found the Free/Premium (weekly/monthly/yearly/lifetime) entitlement system, the Free-plan feature switches, the Play-button layout fix, the epoch-guarded flashcard flow (with `FlashcardSet` records) and the own-password signup already present in the codebase. They were verified, not rebuilt:
- Entitlement rules unit-tested (free switch on/off, weekly/monthly/yearly active + expired, lifetime ignores expiry, legacy basic/pro -> premium). Every gated route uses `requireFeature` server-side.
- Flashcard context harness (real front-end code): selecting CHM102 then switching to CHM142 mid-generation does not overwrite the CHM142 deck; PHY102/BIO102/CHM102 each stay themselves; a response for the wrong course is rejected.
- Play button verified inside its card at 375 / 820 / 1280 px, including long course names.
- Cleaned stale "Basic/Pro" comments.
Fixes/improvements made in this pass:
- **Topic identification (root cause):** attempts were stored with whatever course spelling the client sent ("chm141" vs "CHM 141") and raw tags, so one topic split into several rows, weak topics couldn't be matched back to the question bank, and the generic tag "AI Generated" showed up as a topic. Now course is stored as the canonical key and tags are cleaned on write; the weak-topics aggregation also normalises old rows, ignores generic tags, and returns the real course code/title. The weak-topic drill compares tags case-insensitively.
- **AI question generation:** students now choose the number of questions (5-20) and an optional topic. An out-of-range request is rejected with the real limits instead of being silently clamped. Cost is per quiz (unchanged), stated in the UI; credits/daily limits still enforced. Only multiple-choice is supported today.
- **Exam countdown:** pick the course from your registered courses, optional exam time; shows "PHY102 - Exam in 12 days", "tomorrow", "today" with hours/minutes remaining when a time is set, and hides once the exam has passed. No date = no banner.
- Saved-quiz course names are escaped; AI-quiz inputs no longer overflow on narrow phones.
Not done / limits: no online payment gateway exists, so Premium is granted by an admin (weekly/monthly/yearly/lifetime); no password-reset flow exists in the app; no file/image/voice AI.
