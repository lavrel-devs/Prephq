# PrepHQ Roadmap

Last updated for **v1.6.9**. Effort: **S** = under a day, **M** = a few days, **L** = a week or more.
Status: **Done**, **Next** (start here), **Planned**, **Idea** (needs a decision first).

---

## Decisions already made

1. **The dashboard stops reloading between screens.** No page-to-page routing for signed-in screens. One page, screens shown and hidden (div hiding), with the URL and back button kept in sync.
2. **Design moves to "neumorphic liquid glass".**
3. **The quiz timer is one countdown for the whole session, set in minutes**, and it auto-submits at zero. (Shipped in v1.6.8.)

---

## Shipped

| Version | What changed |
|---|---|
| v1.6.5 | Bulk upload moved into the admin panel; landing page at `/`; "Questions you missed"; get-started checklist; invite card; image Share Result; question-quality panel |
| v1.6.6 | Dashboard speed: one counts request instead of downloading every bank; gzip; landing page with a visible Log in |
| v1.6.7 | Bulk upload from JSON / CSV / TSV files, with templates |
| v1.6.8 | **Session timer in minutes that auto-submits**, replacing the per-question seconds timer; `npm test`; this roadmap |
| v1.6.9 | **Shared design file** (`css/tokens.css`) for the 11 student pages, verified pixel-identical; a test that stops the design drifting apart again |

---

## Release plan

**Release A — Foundation** (both of your decisions touch every screen, so do them in this order and restyle only once)
1. ~~**#2** Shared design file~~ — done in v1.6.9
2. **#1** Single-page shell, one screen at a time (Contests, Study Rooms, Assistant, Profile, then Leaderboard and Change password)
3. **#3** Liquid glass skin

**Release B — Consistency and trust**
**#4** Service worker, then **#13**, **#14**, **#6**, **#5**

**Release C — Community and content**
**#16**, **#17**, **#8**, **#9**, then **#7**, **#15**, **#18**

**Any time (small):** #10, #11, #12, #19–#26

---

## Backlog

| # | Feature | Effort | Status | Notes |
|---|---|---|---|---|
| 1 | Single-page app shell (no reloads) | L | **Next** | Dashboard becomes the shell. See "Design notes". Start with Contests. |
| 2 | One shared design-token / CSS file | M | **Done (v1.6.9)** | `css/tokens.css`. Student pages only; admin keeps its own palette (see #27). Guarded by `tests/tokens.test.js`. |
| 3 | Neumorphic liquid glass | M | Planned | #2 is done, so this starts as an edit to `tokens.css`. Add a low-power mode. |
| 4 | Service worker (offline shell + push) | M | Planned | Unlocks #14 and #15. |
| 5 | Tutor grounded in your notes and question bank | M | Planned | Cites its source; says "I don't know" when it doesn't. |
| 6 | "Explain it my way" levels | S | Planned | Simple / step-by-step / everyday example. Save each explanation so it loads instantly next time. |
| 7 | Snap-a-question (photo to explanation) | M | Idea | Needs a vision-capable model; check what the AI provider offers. Confirm the text it read before answering. |
| 8 | Department materials hub | M | Planned | Notes, PDFs, slides by department and level. Link out to curated videos rather than hosting video. |
| 9 | Exam Radar | M | Planned | Needs `year` and `lecturer` fields on questions (add them as extra bulk-upload columns). Test against known past years before showing students. Label it "based on past patterns, not a guarantee". |
| 10 | Notes as swipeable slides | S | Planned | |
| 11 | Spaced repetition for missed questions | S | Planned | Resurface at 1, 3 and 7 days. |
| 12 | CBT-style exam screen | S | Planned | Question grid, flag for review, submit confirmation. The timer already exists. |
| 13 | Focus sessions and study tracker | M | Planned | 25/5, 50/10 or 60/20; screen stays awake; minutes logged per course; short check-in quiz at the end. |
| 14 | Study reminders and weekly timetable | M | Planned | Push plus a WhatsApp link, built from exam date and courses. Needs #4. |
| 15 | Offline course packs | L | Planned | Needs #4. Test on a real phone with a bad connection. |
| 16 | Study buddy matching | M | Planned | "I can help with / I need help with" by course, opens a study room. In-app only, no phone numbers shared, block and report. |
| 17 | Challenge links and department ladder | S–M | Planned | WhatsApp link opens the same questions and compares results. |
| 18 | Campus contributors with a review queue | L | Idea | Start with a few trusted class reps. Think about copyright of submitted papers. |
| 19 | "Premium ends in N days" banner | S | Planned | Admin already has expiry follow-ups; students see nothing. Add a renew-on-WhatsApp button. |
| 20 | Students can download or delete their own data | S–M | Planned | You store names, matric and phone numbers. Check Nigeria's data-protection requirements with a lawyer. |
| 21 | Live "courses covered" section on the landing page | S | Planned | From `/api/courses`. |
| 22 | Rate-limit the legacy admin key | S | Planned | Login, refresh and recovery have limiters; the admin key does not. Count failed attempts only, so admins can't be locked out by normal use. |
| 23 | Self-host socket.io, Font Awesome and fonts | S | Planned | Study rooms load socket.io from an outside CDN. Needed for offline too. |
| 24 | Speed follow-ups | S–M | Planned | The activity log writes on every request; the quiz-start question lookup is still a case-insensitive scan (a collation index fixes it). |
| 25 | Automated tests in the repo | S | **Done (v1.6.8)** | `npm test`. Covers bulk upload, counts, file import and the database pipelines. No database needed. |
| 26 | Cleanup | S | Planned | Delete `td.html` and `testlatex.html`. If the old `bulk-upload-tool/` folder turns up, match its file format. |
| 27 | Decide whether the admin panel joins the shared design | S | Idea | Admin uses a different, more vivid palette and slightly different corner radii than the student app. Either bring it onto `tokens.css` (a visible change) or keep it separate on purpose. |

**Already built, so not on this list:** exam countdown, AI explain per question, study-plan checklist, flashcard spaced repetition, study rooms, contests, referral card, question reports, missed-questions review, admin expiry follow-ups, bulk upload (paste, JSON, CSV) with duplicate skipping and undo.

---

## What students told us

From the July 2026 think-tank survey: 8 responses, mostly 100-level Physical Science and Chemistry students at one university. Treat it as direction, not proof.

- **7 of 8** struggle with understanding difficult explanations.
- **5** asked for an AI tutor, **4** for study groups, **4** for past-question breakdowns, **4** for materials specific to their department.
- **4** struggle to stay consistent; **3** want a study tracker.
- Other asks: a daily timetable, flashcards, mock CBT tests, slides or PDF explanations, downloadable offline sessions, choosing a study rhythm (for example 60 minutes on and 20 off), and finding a study partner.

**Asked for, but not possible on the web, so we build the closest thing:**
- *Block other apps / pause the phone while studying* → an in-app focus mode (full screen, screen kept awake, focus streak). Blocking other apps is an Android setting, not something a website can do.
- *An AI that phones you to study* → push and WhatsApp reminders.

---

## Design notes

### Single-page shell (#1)
- The dashboard is already one page of hidden screens, so it becomes the shell. Contests, Study Rooms, Assistant and Profile (with Leaderboard and Change password) become more hidden screens.
- Move one screen per step and keep the old URL working until that screen is done. No big-bang rewrite.
- Each screen's code loads once on first open, then is only shown and hidden. The dashboard is about 238 KB and the other pages add about 110 KB, so do not bundle everything into one file.
- Update the URL with `history.pushState` so the back button and links like `/contests` keep working.
- Keep the study-room connection alive when students switch tabs.
- **Main risk:** each page defines its own helper names and styles (`toast`, `load`, colours). Screens must be scoped or they will clash.
- Login, register, forgot password and admin stay as separate pages.

### Liquid glass (#3)
- Use glass on the chrome (navigation bar, cards, sheets). Keep the quiz screen flat and fast.
- Backdrop blur is heavy on budget Android phones, so ship an automatic low-power mode (respect reduced-motion / reduced-transparency) and a settings toggle.
- Check text contrast on translucent surfaces.
- Refraction effects only work in some browsers. Use gradients and highlights instead.
- Both light and dark themes stay supported; do not default to dark.

### Session timer (shipped)
- One timer for the whole quiz, in minutes (1–180), any mode, however the quiz starts (course practice, weak-topic drill, AI quiz, saved quiz, bookmarks, missed-question review).
- At zero the quiz submits itself. Unanswered questions are marked "timed out" and count as skipped.
- It runs on the wall clock, so a backgrounded tab cannot pause it.
- Contests and study rooms keep their own per-question timers (the server controls those).
