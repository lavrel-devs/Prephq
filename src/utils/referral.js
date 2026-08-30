const crypto = require('crypto');
const Student = require('../models/Student');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion, same alphabet as codeGen.js

function randomCode(len = 7) {
  return Array.from({ length: len }, () => CHARS[crypto.randomInt(CHARS.length)]).join('');
}

// Generates a unique referral code, retrying on the rare collision.
// Not derived from username since username is optional/mutable and
// referralCode should stay stable for life.
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const exists = await Student.findOne({ referralCode: code }).lean();
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique referral code, please retry');
}

module.exports = { generateUniqueReferralCode };
