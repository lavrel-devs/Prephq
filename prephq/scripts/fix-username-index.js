/**
 * ONE-TIME CLEANUP — run once after deploying the v1.3 username fix.
 *
 * Root cause: Student.username (and referralCode) used to have
 * `default: null` in the schema, so Mongoose wrote an *explicit*
 * `username: null` onto every student document on creation. A sparse
 * unique index still indexes an explicit null (sparse only skips
 * documents where the field is completely absent) — so every student
 * beyond the first collided on the index and signups/admin-adds could
 * start throwing "E11000 duplicate key error ... username: null".
 *
 * This script does NOT touch any student who already has a real
 * username. It only removes the field from documents where it is
 * exactly `null`, turning "explicitly null" into "not set yet" —
 * functionally identical for your app (still shows the "set your
 * username" prompt), but safe for the sparse index. Then it rebuilds
 * the indexes so MongoDB drops any old, broken index definition.
 *
 * Usage:
 *   node scripts/fix-username-index.js
 *
 * Reads MONGODB_URI (or MONGO_URI) from your existing .env — same as
 * the app. Safe to re-run; it's a no-op once everything is clean.
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI / MONGO_URI found in environment.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('students');

  for (const field of ['username', 'referralCode']) {
    const res = await col.updateMany(
      { [field]: null },
      { $unset: { [field]: '' } }
    );
    console.log(`${field}: unset on ${res.modifiedCount} document(s) that had an explicit null`);
  }

  // Rebuild just the two affected indexes (leave matric's index and
  // anything else untouched).
  for (const name of ['username_1', 'referralCode_1']) {
    await col.dropIndex(name).catch(() => {}); // ignore "index not found"
  }
  await col.createIndex({ username: 1 }, { unique: true, sparse: true });
  await col.createIndex({ referralCode: 1 }, { unique: true, sparse: true });
  console.log('username/referralCode indexes rebuilt.');

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
