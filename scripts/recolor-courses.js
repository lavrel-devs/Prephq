/**
 * ONE-TIME RECOLOR — moves existing courses onto the slate-blue palette.
 *
 * Why: course colours are stored per course in MongoDB, so changing the app's
 * design tokens does not touch courses that already exist. This script maps the
 * old loud colours to calmer ones from the new palette. Any colour that is not in
 * the table below (for example one an admin picked by hand) is left alone.
 *
 * Usage:
 *   node scripts/recolor-courses.js            # dry run: shows what would change, writes nothing
 *   node scripts/recolor-courses.js --apply    # performs the update
 *
 * Reads MONGODB_URI (or MONGO_URI) from your .env, same as the app.
 * Safe to re-run: once courses are recoloured they no longer match the table.
 * Edit MAP to taste before running with --apply.
 */
require('dotenv').config();

const MAP = {
  '#E2507A': '#3E5C8A', // old brand pink   -> slate blue
  '#FF9A62': '#5D7FB0', // old brand orange -> lighter slate blue
  '#F5340A': '#B5654A', // loud red-orange  -> muted clay
  '#F5930A': '#B98A2E', // loud orange      -> muted gold
  '#00C96B': '#2E8B6A', // loud green       -> deep green
  '#0ABCF5': '#3A8FB0', // loud cyan        -> calm steel teal
};

function newColor(c) {
  if (typeof c !== 'string') return null;
  return MAP[c.trim().toUpperCase()] || null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI is not set (check your .env).'); process.exit(1); }

  const mongoose = require('mongoose');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const col = mongoose.connection.collection('courses');

  const docs = await col.find({}, { projection: { courseCode: 1, color: 1 } }).toArray();
  const todo = docs.filter(d => newColor(d.color));
  console.log(`${docs.length} course(s) found, ${todo.length} would change, ${docs.length - todo.length} left as they are.`);
  todo.forEach(d => console.log(`  ${d.courseCode}: ${d.color} -> ${newColor(d.color)}`));

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to save these changes.');
  } else {
    for (const d of todo) await col.updateOne({ _id: d._id }, { $set: { color: newColor(d.color) } });
    console.log(`\nDone: ${todo.length} course(s) updated.`);
  }
  await mongoose.disconnect();
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { newColor, MAP };
