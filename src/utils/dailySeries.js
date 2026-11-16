const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyInTimezone(value, timeZone = 'Africa/Lagos') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid date is required');

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidDayKey(dayKey) {
  if (typeof dayKey !== 'string' || !DAY_KEY.test(dayKey)) return false;
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dayKey;
}

function nextDayKey(dayKey) {
  if (!isValidDayKey(dayKey)) throw new TypeError('A valid YYYY-MM-DD date is required');
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setTime(date.getTime() + DAY_MS);
  return date.toISOString().slice(0, 10);
}

function zeroFillDailyCounts(rows, startDay, endDay) {
  if (!isValidDayKey(startDay) || !isValidDayKey(endDay)) {
    throw new TypeError('Start and end dates must be valid YYYY-MM-DD dates');
  }
  if (startDay > endDay) return [];

  const counts = new Map();
  for (const row of rows || []) {
    if (!row || !isValidDayKey(row.date)) continue;
    const count = Number(row.count);
    if (Number.isFinite(count)) counts.set(row.date, (counts.get(row.date) || 0) + count);
  }

  const result = [];
  for (let date = startDay; date <= endDay; date = nextDayKey(date)) {
    if (result.length >= 400) throw new RangeError('Daily series is too large');
    result.push({ date, count: counts.get(date) || 0 });
  }
  return result;
}

module.exports = { dayKeyInTimezone, zeroFillDailyCounts };
