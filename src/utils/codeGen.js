const crypto = require('crypto');

// Generate a code like X7K2-9QMP-4RBT
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  const seg = (n) => Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
}

module.exports = { generateCode };
