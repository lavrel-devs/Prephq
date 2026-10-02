const crypto = require('crypto');
const Admin = require('../models/Admin');
const Settings = require('../models/Settings');
const SupportRequest = require('../models/SupportRequest');

// Nigerian-friendly phone → WhatsApp number (digits only, country code first).
//   0801 234 5678 → 2348012345678,  +234 801… → 234801…,  801… (10 digits) → 234801…
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  else if (d.length === 10 && !d.startsWith('234')) d = '234' + d;
  return d.length >= 10 && d.length <= 15 ? d : '';
}

function waUrl(number, text) {
  const n = normalizePhone(number);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
}

// Short, unambiguous reference like "PH-7K2QX" (no 0/O/1/I).
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(5)) s += A[b % A.length];
  return `PH-${s}`;
}

async function uniqueCode() {
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    if (!(await SupportRequest.exists({ code }))) return code;
  }
  return newCode() + Math.floor(Math.random() * 9);
}

// Chooses which admin's WhatsApp a student is sent to. Admins with a number saved take turns
// (the one with the fewest open requests goes next); if none has set a number, fall back to the
// support number in Settings. Returns { username, number } or null when nothing is configured.
async function pickAdminContact() {
  const admins = await Admin.find({ active: { $ne: false }, whatsapp: { $nin: ['', null] } }).select('username whatsapp').lean();
  const usable = admins.filter(a => normalizePhone(a.whatsapp));
  if (usable.length) {
    const open = await SupportRequest.aggregate([
      { $match: { status: 'open', assignedAdmin: { $in: usable.map(a => a.username) } } },
      { $group: { _id: '$assignedAdmin', n: { $sum: 1 } } },
    ]);
    const load = Object.fromEntries(open.map(o => [o._id, o.n]));
    usable.sort((a, b) => (load[a.username] || 0) - (load[b.username] || 0) || Math.random() - 0.5);
    return { username: usable[0].username, number: normalizePhone(usable[0].whatsapp) };
  }
  const settings = await Settings.getGlobal();
  const fallback = normalizePhone(settings.support && settings.support.whatsapp);
  return fallback ? { username: '', number: fallback } : null;
}

module.exports = { normalizePhone, waUrl, newCode, uniqueCode, pickAdminContact };
