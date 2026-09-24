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

## v1.5.0 — ten new features (no payment gateway, no email/API dependencies)
1. **WhatsApp account recovery.** Login page -> "Forgot password?" -> matric + name -> request code + a WhatsApp link to an admin (admins with a saved number take turns, fewest open requests first; falls back to the support number in Settings). The reply is identical whether or not the matric exists. Admin -> Support -> "Temp password" issues a one-time password, signs the student out everywhere and forces a new password at next login (`/change-password`; other APIs return PASSWORD_CHANGE_REQUIRED until done).
2. **Upgrade requests.** "Message admin to upgrade" (paywall + profile) now files a request and opens WhatsApp; Support -> "Grant plan" activates the plan and logs the payment.
3. **Exam history & readiness** (dashboard menu): per-course readiness (accuracy x confidence, shown transparently) and mock-exam history with topic breakdowns.
4. **Study plan & progress tracker**: today's checklist built from real data (goal, weak topic, due flashcards, exam countdown, least-practised course), streak and 14-day activity.
5. **Weak-topic revision queue**: active topics with Drill / AI drill buttons, and topics you've turned around.
6. **"Ask AI why"** on wrong answers opens the AI tutor with the question pre-filled (nothing is sent until the student presses send).
7. **Admin WhatsApp follow-ups**: plans expiring/just ended, and inactive students, each with a ready-made WhatsApp message.
8. **Course notes & outlines**: admins write notes per course/topic; students read them and jump to practice questions for the topic.
9. **Report a question**: students report wrong/unclear questions; Support -> fix the answer key, resolve or reject.
10. **Achievements**: 10 earned badges (first quiz, 100/500/1000 questions, 7/30-day streaks, first mock exam, perfect score, weakness conquered, contest win); equip one on the leaderboard.
New admin permission area **Support requests**; feature switches added for Exam history, Study plan and Course notes. Login no longer trims passwords. Tested: pure logic units, stubbed server tests (recovery routing/no-leak, permissions, temp password, forced-change gate) and browser rendering of every new screen. Not tested against a live database.

## v1.5.1 — Course Notes: notes-only reader + AI note builder
- **Student Course Notes is now reading only.** The "Practise" buttons and the topic list built from question tags are gone. Students see a list of the published notes for a course (with read time), open one in a reader, and move Previous/Next. Practice questions stay in the rest of the app. Only approved notes are ever returned by the API.
- **Admin AI note builder** (Admin -> Course Notes): "Build topic outline" reads the past questions already uploaded for the course, merges spelling variants of tags, groups untagged questions, and arranges the topics in teaching order. "Write note" (or "Write all missing notes") has the AI write simple, thorough notes per topic using those past questions as evidence of what is examined. Every note is saved as an **AI draft** — students see nothing until an admin clicks Approve (per note or "Approve all drafts"). Drafts can be reviewed/edited with a student-view preview before approving, regenerated while still a draft, and a published or hand-written note is never overwritten.
- Needs GROQ_API_KEY (same as the AI quiz). Notes use a small markup: `## Heading`, `- bullet`, `**bold**`.

## v1.5.1 (hotfix note)
Added `/api/version` and a clear message when the browser has newer files than the running server ("Not found" on Build topic outline / "Could not connect" on Course Notes = the server process is still the old version — restart it).

## v1.5.2
`.env.example` now uses GROQ_MODEL=openai/gpt-oss-120b (the old llama-3.3-70b-versatile default is no longer available on the account). If GROQ_MODEL names a model Groq can't serve, AI calls retry once with openai/gpt-oss-120b instead of failing.

## v1.6.0
**Notes you write yourself (credits)**
- Course Notes screen: "Need a topic that isn't here?" — type any topic, pick Quick / Standard / Detailed, the AI writes the notes now. Default costs 3 / 5 / 8 credits, editable in Admin → Credit Settings → "Student-written study notes" (or switch the feature off).
- Credits are taken first and refunded automatically if the AI or the save fails. A topic that already has a published PrepHQ note is opened free; asking for the same topic + depth again reopens it free. Students can delete their own notes.
- New: `PersonalNote` model, `/api/my-notes/*`, ledger reason `note_generation`.

**LaTeX, chemical equations and molecule structures**
- `phq-sci.js` (already in the project but never loaded) is now included on the dashboard, chat, contests, study rooms and admin, so questions, options, explanations, AI chat and notes render `$x^2$`, `$$…$$`, `\frac`, and `[[smiles: CC(=O)O]]` skeletal structures with no per-screen wiring.
- Added mhchem: `$\ce{2H2 + O2 -> 2H2O}$` renders as a proper reaction. SMILES containing brackets (`[C@H]`, `[O-]`) now parse correctly.
- AI notes, quizzes and chat are told to write maths in LaTeX and structures as `[[smiles: …]]`. Single-backslash LaTeX that breaks AI JSON (`\frac` → form feed) is repaired. HTML stripping no longer eats `$a<b$`. Note size cap raised to 12,000 characters.
- Question uploader no longer flattens LaTeX to plain symbols (`KEEP_LATEX = true` at the top of `cleanLatex`; set false for the old behaviour).

**"Write all notes" now works, and AI rate limits handled**
- Old button ran in the admin's browser tab, needed an outline first and stopped at the first "wait a few seconds". Now a server-side background job: "This course only" or "ALL courses" — builds each course's topics, writes every missing note as a draft, shows live progress, can be stopped, retried (failed only), and resumes after a server restart. Nothing reaches students until approved ("Approve every draft" added).
- Every AI call now goes through a queue (`aiQueue.service.js`): requests start at least 2.2 s apart (`GROQ_MIN_GAP_MS`), a rate-limit reply pauses the queue for the time Groq asks and retries automatically. Students' quizzes/chat go ahead of bulk jobs; a student only sees an error if the wait would exceed ~30 s.

**Follow-ups**
- "✓ Mark followed up" on every row (expiring plans and inactive students), showing who and when, with Undo and a "Hide already followed up" switch. WhatsApp asks for confirmation if the student was already followed up. A mark is tied to that situation (the plan's expiry date / last-seen time), so renewed or returning-then-lapsed students appear fresh again.

Not run against a live MongoDB or a real Groq key: queue, charge/refund flow and rendering were tested with stubs and jsdom. Molecule drawing needs a real browser canvas — try one SMILES on staging.
