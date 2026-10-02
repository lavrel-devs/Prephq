# PrepHQ API — v1.2 New & Changed Endpoints

Everything below is new in v1.2 unless marked **(changed)**. Existing v1.1.9 endpoints not listed here are unchanged. All request/response bodies are JSON. All student endpoints require `Authorization: Bearer <access token>`; all admin endpoints require `Authorization: Bearer <admin token>` (or the legacy `x-admin-key` header for scripts).

---

## Auth

### `POST /api/auth/register` **(changed)**
New optional fields:
```json
{
  "matric": "...", "name": "...", "phone": "...", "whatsapp": "...",
  "code": "...", "password": "...",
  "referralCode": "ABC1234",   // optional — credits the referrer
  "username": "goodnews"       // optional — sets username at signup instead of via the first-login modal
}
```
On success, the new student receives a welcome bonus (+ referee bonus if `referralCode` was valid), and the referrer (if any) receives their referral reward. Amounts are configured in Settings (see Credit Settings below).

### `GET /api/me` **(changed)**
Now also triggers the lazy daily credit refresh (idempotent — only applies once per WAT calendar day) and returns:
```json
{
  "matric": "...", "name": "...", "role": "student", "credits": 42,
  "username": "goodnews", "displayName": "Goodnews A.",
  "referralCode": "ABC1234",
  "needsUsername": false   // true if username is unset — drives the blocking dashboard modal
}
```

---

## Usernames & Profile

### `GET /api/username/check/:username`
Real-time availability check. `{ ok: true, username }` or `{ ok: false, reason }`.

### `POST /api/username`
Body: `{ "username": "goodnews" }`. Sets or changes the caller's username.
First-ever set is always allowed; subsequent changes are capped once per 30 days.
Errors return `{ error, code }` where `code` is one of `INVALID_FORMAT` (400), `TAKEN` (409), `COOLDOWN` (429), `UNCHANGED` (400).

### `PUT /api/profile/display-name`
Body: `{ "displayName": "..." }`. No cooldown — changeable anytime. Max 40 chars.

### `GET /api/profile`
Full profile payload: `matric, name, username, displayName, credits, quizStats {totalQuizzes, avgScore, bestScore}, transferHistory[], referral {code, referredCount}`.

---

## Credit Transfers

### `POST /api/transfer`
Body: `{ "username": "recipient", "amount": 5 }`.
- 1-credit fee (sender pays `amount + 1`)
- Minimum transfer: 2 credits
- Max 10 transfers/day (rolling 24h), 30s cooldown between transfers
- Response: `{ success, transferId, amountSent, fee, newBalance }`

### `GET /api/transfer/history`
Combined sent + received log for the caller, newest first.

---

## Notifications

### `GET /api/notifications`
`{ notifications: [...], unreadCount }`. Also marks all returned notifications as read.

### `POST /api/notifications/:id/read`
### `POST /api/notifications/read-all`

---

## Contests (student-facing)

### `GET /api/contests?status=upcoming|live|paused|ended`
Defaults to upcoming+live+paused. Each item includes `participantCount` and `joined` (whether the caller has joined) instead of the full participant list.

### `GET /api/contests/past`
Ended contests, most recent 30.

### `GET /api/contests/:id`
Full detail + `myEntry` (the caller's own participant record, or `null`).

### `POST /api/contests/:id/join`
Deducts entry fee if any. Errors: `NOT_JOINABLE` (400), `ALREADY_JOINED` (409), `FULL` (409), `INSUFFICIENT_CREDITS` (400).

### `GET /api/contests/:id/leaderboard`
Live-computed ranking, sorted by score descending.

### `POST /api/contests/:id/score`
Body: `{ "score": 87 }`. Submit/update the caller's score in a live contest. Not used for raffle-type contests.

---

## Admin — Credit Settings

### `GET /api/admin/credit-settings`
### `PUT /api/admin/credit-settings`
Body (any subset): `{ dailyRefresh: {enabled, amount}, referral: {enabled, referrerReward, refereeBonus}, welcomeBonus }`.

---

## Admin — Users

### `GET /api/admin/dashboard/stats`
`{ users: {total, active}, revenue, contests: {byStatus, live}, transfers: {count, totalVolume} }`.

### `GET /api/admin/users/search?q=...`
Matches matric, username, or name.

### `GET /api/admin/users/:matric`
Full detail: profile, quizzes, credit balance + recent transactions, contests joined, sent/received transfers, session-derived activity log.

### `PUT /api/admin/users/:matric/status`
Body: `{ "isActive": false }`. Deactivating also revokes all live sessions immediately.

### `PUT /api/admin/students/:matric/username`
Body: `{ "username": "newname" }` (force-set, bypasses cooldown) or `{ "username": null }` (clear — sends the student back through the setup modal).

### `POST /api/admin/users/bulk-grant`
Body: `{ "matrics": ["A","B"], "amount": 10, "note": "..." }`. Grants/deducts credits across many accounts; one audit-trail row per account.

### `GET /api/admin/credits/leaderboard?minCredits=...`
All users sorted by balance.

### `GET /api/admin/transfers?matric=...&from=...&to=...`
Filtered transfer log.

### `GET /api/admin/export/users` · `/export/transactions` · `/export/transfers`
CSV downloads.

---

## Admin — Contests

### `GET /api/admin/contests?status=...` · `GET /api/admin/contests/:id`
### `POST /api/admin/contests`
Body: `{ title, description, bannerImage, startTime, endTime, entryFee, maxParticipants, prizePool, prizeDistribution: [{rank, amount}], type: 'quiz'|'raffle'|'leaderboard'|'timed', questions, status? }`. Auto-status: `live` if `startTime` is already past, else `upcoming` (unless `status` explicitly given).

### `PUT /api/admin/contests/:id` — edit (not allowed once ended/cancelled)
### `DELETE /api/admin/contests/:id` — only draft/upcoming (use cancel otherwise)
### `POST /api/admin/contests/:id/duplicate` — clones as a new draft

### Lifecycle: `POST /api/admin/contests/:id/{start|pause|resume|extend|end|cancel}`
- `extend` body: `{ "minutes": 30 }`
- `end` settles prizes immediately, same logic as the scheduled auto-settlement
- `cancel` refunds any entry fees paid and does **not** pay prizes

### Participants: 
- `POST /api/admin/contests/:id/participants` — `{ matric }`, no fee charged
- `DELETE /api/admin/contests/:id/participants/:matric`
- `PUT /api/admin/contests/:id/participants/:matric` — `{ score?, rank?, prizeAwarded? }`. Manual prize edits are credited/debited as the diff and logged.

### `GET /api/admin/contests/:id/export`
CSV of participants/scores/prizes.

---

## Admin — Announcements

### `GET /api/admin/announcements`
### `POST /api/admin/announcements`
Body: `{ title, content, targetAudience: 'all'|'active_users'|'new_users', expiresAt? }`. Broadcasts to matching students' notification feeds immediately. `active_users` = active in the last 7 days; `new_users` = signed up in the last 7 days.

### `DELETE /api/admin/announcements/:id`

---

## Clean Routes

`/login`, `/register`, `/dashboard`, `/admin`, `/profile`, `/contests` now serve the corresponding page directly. The old `*.html` URLs still work (served via static middleware) for backward compatibility.

## Scheduled Jobs

- **Daily credit refresh** — 00:00 WAT (`Africa/Lagos`), bulk-catches any student who wasn't served the lazy per-request refresh
- **Contest transitions** — every minute: `upcoming → live → ended` on schedule, auto-settlement on end, participant reminders 15 minutes before `startTime`
