# Wreddi v1.10.0 — Apple × Material UI refresh

Visual only: no routes, API, or data changes.

## What changed
- `public/css/tokens.css` — rewritten. `--bg` is now the page canvas, `--surf` raised surfaces, `--fill` inputs/tracks.
  `--sh*` are layered elevations; `--sh-in*` are flat (wells are filled, not shadowed). New: `--grad`, `--bar`, `--scrim`, `--inv-*`.
- `public/css/glass.css` — now only the shared tab bar (translucent, Material pill indicator) and page wash.
  Blanket `backdrop-filter` on cards removed; blur remains on the tab bar and sticky top bars only, with solid fallbacks
  for `html[data-lowpower]` and browsers without backdrop-filter.
- `public/css/hybrid.css` (new, loaded last on student pages) — buttons, switches, chips, selected states, sheets, toast, per-view overrides.
- `public/js/ripple.js` (new) — Material touch ripple; off in low-power mode / reduced motion.
- Fonts are now each platform's system font (SF Pro / Roboto / Segoe UI). `fonts.css` and font files are untouched but no longer needed by student pages.
- Student pages/views: ~170 raised elements re-pointed to `--surf`, ~75 wells to `--fill`; font weights lightened one step;
  47 all-caps micro-labels set to sentence case; primary gradients use `var(--grad)`.
- `theme-color` meta and manifest background updated; `theme.js` keeps the status-bar colour in sync with light/dark.

## Not changed
`admin.html` and `question-uploader.html` keep their own palette (admin still loads glass.css, so only its background wash differs).

## Tests
`tokens`, `views`, `legal` and the other UI tests pass. Tests needing `mongoose` / `bcryptjs` couldn't run here (no node_modules in the upload).

## Branding (added)
- New logo assets in `public/icons/`: `logo-mark.png` (round mark, transparent), `wreddi-wordmark.png` / `-white.png` (transparent, for light / dark),
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-32/48.png`, `favicon.ico`.
- Favicon + Apple touch icon links added to every top-level page and the legal pages; manifest now has `any` and `maskable` icons.
- Login and register show the round mark; the landing nav shows mark + wordmark (swaps to the white wordmark in dark mode).
- Forgot-password, change-password and invite keep their contextual icons (key / life-ring / bolt).

## Fixes
- **Mistake Notebook, Wreddi Wrapped, Written Exam stuck on "Loading…"** (also present in 1.9.2): `shell.js` only calls a view's `onShow()` when
  you return to an already-opened view, and these three views only fetched their data from `onShow()`. They now also load once when first mounted.
  Other views already load at mount, so `shell.js` is unchanged (changing it would double-fetch them).
- Tab bar is a floating capsule again (inset from the edges, `--nav-space` 96px).

## Course list collapse
- Home → Select Course shows the first 4 courses (plus any ticked ones) with a "Show N more courses ⌄" arrow; tap to expand, "Show fewer" to collapse.
- Search always looks through every course and hides the arrow while active. With 4 or fewer courses nothing changes.
- Code: `applyCourseGridView()` / `toggleCourseGrid()` in dashboard.html; `COURSE_PREVIEW` sets how many show.

## Landing page
- Feature cards now cover what the app does today: practice & mock exams, AI-marked written exams, voice quiz, mistake notebook, AI quizzes, ask a question, notes/flashcards/cheat sheets, contests & rooms, focus timer & Wrapped.
- New in-hero app preview (pure HTML/CSS, follows light/dark) with two floating cards; hidden on screens under 860px except the phone itself.
- Hero copy, chips, meta description and FAQ (written exams, voice quiz) updated; badge, icon wells and step numbers restyled as tonal chips (the old inset shadows no longer exist).
