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
