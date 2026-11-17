# Wreddi Secondary (v1.11)

JAMB, WAEC, NECO and school-exam prep, inside Wreddi at `/secondary`.

## How it fits
- **Fully separate from the university app.** Secondary subjects are hidden from `/api/courses`, the Telegram `/courses` list and the bulk "write notes for all courses" job, and never count toward the university default-course seed.
- A subject is a **Course** with `track: 'secondary'`. The university app never sees them (`GET /api/courses` hides them unless `?track=secondary`).
- Questions live in the same bank. New optional fields: `exam` (jamb/waec/neco/school), `year`, `classLevel` (JSS1–SS3). A question with none is general and is used by every exam.
- Papers are saved through the normal `POST /api/scores/:matric` with mode `sec-mock` / `sec-practice` and a `sec` block (grades and the UTME total are recomputed on the server).
- **One account, one app (v1.12).** The account type is chosen once at signup (`/register?as=secondary` or the first step of the wizard) and stored as `track`. A university account cannot sign in on the Secondary / JAMB tab (and the reverse): the login returns `WRONG_TRACK` after the password is verified. The whole `/api/secondary` API is gated by `requireTrack('secondary')`, and secondary papers can only be saved from a secondary account. The old "Switch app" button, the profile-prompt link and `PUT /api/secondary/track` are gone; only an admin can move an account (Students → Move app).
- The login page has three choices: University student, Secondary / JAMB, and Platform admin. A signed-out visit to `/secondary` opens login with Secondary selected.

## What students get
- **JAMB**: four subjects (English locked), full CBT mock = 180 questions / 120 min (English 60, others 40), subject tabs, question map, UTME score out of 400, target and trend. Mini mock = 45 questions / 30 min.
- **WAEC / NECO**: up to nine subjects (English and Maths locked), timed papers and untimed practice, A1–F9 grades, "five credits including English and Maths" check.
- **School**: class-level (JSS1–SS3) practice.
- Practice by topic and past-question year; answer and explanation shown straight away.

## Admin
- Course Management → "Where does it appear?" sets the track. Nothing is seeded by default: subjects and questions come only from what you add. (Optional: set `SEED_SECONDARY_SUBJECTS=true` to create 19 empty subject shells once. No questions are ever seeded.)
- Bulk upload (CSV/JSON) accepts `exam`, `year`, `classLevel` columns; `docs/secondary-sample-questions.json` shows the file format only. Its 7 rows are placeholders, do not upload them as real content. Use course codes like `SEC-ENG`.
- Paper sizes, grade bands, subject list and JAMB combinations are constants in `src/utils/secondary.js`.

## Plan limits
A paper counts against the daily question allowance, and that is checked **before** it starts, so a result is never lost. A Free plan with a 20/day cap cannot start even the 45-question mini mock; raise the cap or grant Premium in the admin.
