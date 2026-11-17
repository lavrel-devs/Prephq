# Wreddi UI refresh notes

## v1.12.0 — workspace layout, account separation, admin additions
- **Layout** (`public/css/nest.css`, loaded after `hybrid.css` on the dashboard): from 1024px up the tab bar becomes a full-height left sidebar (logo, labelled nav, account card), the canvas is off-white and cards are white with hairline borders and 12px corners. Phones keep the floating tab bar. Brand colour is unchanged (`--brand` in `tokens.css`).
- **University and Secondary / JAMB accounts are now separate.** See `docs/SECONDARY.md`. Signup asks for the account type first; login refuses the wrong tab; the Secondary API is gated server-side.
- **Admin**: new Secondary / JAMB overview, Security (recent sign-ins, new devices, sign an account out everywhere), System health, a global search box (Ctrl K) and an App column / filter / "Move app" action on Students. Routes live in `src/routes/admin/admin.platform.routes.js`.
- Tests: `tests/tracklock.test.js` added; `secondary.test.js` updated for the removed switch endpoint.

## v1.11.1 — admin analytics dashboard refresh
- `public/admin.html` now follows the supplied analytics-dashboard reference: a full-height navigation rail, restrained blue active states, white bordered cards, a spacious signup trend, and a compact student leaderboard.
- The overview signup chart uses the existing admin-protected signups analytics endpoint; the 7/30/90-day selector remains available, and other admin routes and data flows are unchanged.
- Removed five obsolete standalone tab pages so those URLs consistently reach the single-page dashboard shell through the existing redirects.
- Root package and lockfile versions are aligned at `1.11.1`; `MANIFEST.json` was regenerated for the delivered root project files.

## v1.10.0 — Apple × Material UI refresh
Visual only: no routes, API, or data changes in that release.

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

## Not changed in v1.10.0
At that release, `admin.html` and `question-uploader.html` kept their own palettes. The admin styling was subsequently refreshed in v1.11.1 above.

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

## Minimal pass (v1.10.1)
- Tokens: near-white canvas, white cards, hairline borders instead of shadows (shadow kept only for menus, sheets and the tab bar), softer fills, flat primary colour (`--grad` is now a solid).
- Removed: gradients and button glows, tinted chips (badges, streak, section counts), the tiles behind icons, background blobs, the landing page's floating cards and gradient headline text.
- To go back to the previous look: restore `tokens.css`, `hybrid.css` (everything under "Minimal pass") and `landing.html`'s styles from the v1.10.0 zip.

## v1.12.1 — accessibility pass (from the UI/UX audit)
- Zoom is no longer disabled (removed `maximum-scale`/`minimum-scale`/`user-scalable=no` from 6 pages).
- New `public/js/a11y.js` (loaded on student pages, auth pages, admin, landing): keyboard access (role/tabindex + Enter/Space) for clickable divs, `role=dialog`/`aria-modal` on sheets and modals, Escape closes the top layer and focus returns, `aria-checked` kept in sync on switches, placeholder-only fields get an `aria-label`, `.scr` gets `role=main`.
- Names added to icon-only buttons (back, remove bookmark, delete note, send, skip, menu) and switches (`role=switch`); `aria-current="page"` on the nav; toast is a polite live region; skip link added.
- Light-theme `--t4 --ok --no --warn --purple --teal --gold --silver --bronze` darkened to ≥4.5:1 on white and the app canvas (dark theme untouched).
- Visible 2px focus ring on text fields and role=button elements; 44px icon-button targets; global `prefers-reduced-motion`.
- Secondary/JAMB promo card no longer flashes for University accounts (duplicate `display` declaration).
