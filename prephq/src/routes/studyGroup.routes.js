const express = require('express');
const crypto = require('crypto');
const StudyGroup = require('../models/StudyGroup');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { requireFeature } = require('../services/entitlements.service');

const router = express.Router();
router.use(requireStudent, requireFeature('studyRooms')); // same tier gate as live Study Rooms

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function generateCode() {
  for (let i = 0; i < 10; i++) {
    const code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    if (!(await StudyGroup.exists({ code }))) return code;
  }
  throw new Error('Could not generate a unique code, please retry');
}

const shape = (g, matric) => ({
  code: g.code, name: g.name, course: g.course, goalText: g.goalText, goalDueAt: g.goalDueAt,
  hostMatric: g.hostMatric, isHost: g.hostMatric === matric, archived: g.archived,
  members: g.members.map(m => ({ matric: m.matric, username: m.username || m.matric, progress: m.progress, isMe: m.matric === matric })),
  averageProgress: g.members.length ? Math.round(g.members.reduce((s, m) => s + m.progress, 0) / g.members.length) : 0,
  myProgress: (g.members.find(m => m.matric === matric) || {}).progress ?? 0,
});

// POST /api/study-groups  { name, course?, goalText, goalDueAt? } — create + auto-join as host
router.post('/study-groups', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 60);
    const goalText = String(req.body.goalText || '').trim().slice(0, 140);
    if (!name) return res.status(400).json({ error: 'Give the group a name' });
    if (!goalText) return res.status(400).json({ error: 'Set a shared goal, e.g. "Finish CHM101 Ch.3 by Friday"' });
    let goalDueAt = null;
    if (req.body.goalDueAt) { const d = new Date(req.body.goalDueAt); if (!isNaN(d)) goalDueAt = d; }

    const active = await StudyGroup.countDocuments({ hostMatric: req.student.sub, archived: false });
    if (active >= 5) return res.status(429).json({ error: "You've got 5 active groups already — close one before starting another." });

    const student = await Student.findOne({ matric: req.student.sub }).select('username').lean();
    const code = await generateCode();
    const group = await StudyGroup.create({
      code, name, hostMatric: req.student.sub, course: String(req.body.course || '').trim().slice(0, 40), goalText, goalDueAt,
      members: [{ matric: req.student.sub, username: student?.username || '', progress: 0 }],
    });
    res.status(201).json(shape(group.toObject(), req.student.sub));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/study-groups/mine — active groups I'm a member of (host or joined)
router.get('/study-groups/mine', async (req, res) => {
  try {
    const groups = await StudyGroup.find({ 'members.matric': req.student.sub, archived: false }).sort({ createdAt: -1 }).limit(20).lean();
    res.json(groups.map(g => shape(g, req.student.sub)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/study-groups/:code/join
router.post('/study-groups/:code/join', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const group = await StudyGroup.findOne({ code });
    if (!group || group.archived) return res.status(404).json({ error: 'Group not found' });
    if (group.members.some(m => m.matric === req.student.sub)) return res.json(shape(group.toObject(), req.student.sub));
    if (group.members.length >= 25) return res.status(400).json({ error: 'This group is full' });
    const student = await Student.findOne({ matric: req.student.sub }).select('username').lean();
    group.members.push({ matric: req.student.sub, username: student?.username || '', progress: 0 });
    await group.save();
    res.status(201).json(shape(group.toObject(), req.student.sub));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/study-groups/:code
router.get('/study-groups/:code', async (req, res) => {
  try {
    const group = await StudyGroup.findOne({ code: String(req.params.code || '').toUpperCase() }).lean();
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.members.some(m => m.matric === req.student.sub);
    if (!isMember) return res.status(403).json({ error: 'Join this group first' });
    res.json(shape(group, req.student.sub));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/study-groups/:code/progress  { progress: 0-100 } — self-reported, my own row only
router.patch('/study-groups/:code/progress', async (req, res) => {
  try {
    const progress = Math.min(100, Math.max(0, parseInt(req.body.progress, 10) || 0));
    const group = await StudyGroup.findOneAndUpdate(
      { code: String(req.params.code || '').toUpperCase(), 'members.matric': req.student.sub },
      { $set: { 'members.$.progress': progress } }, { new: true },
    ).lean();
    if (!group) return res.status(404).json({ error: 'Group not found, or you have not joined it' });
    res.json(shape(group, req.student.sub));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/study-groups/:code/leave — non-host leaves; host use /close instead
router.post('/study-groups/:code/leave', async (req, res) => {
  try {
    const group = await StudyGroup.findOne({ code: String(req.params.code || '').toUpperCase() });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.hostMatric === req.student.sub) return res.status(400).json({ error: "You're the host — close the group instead of leaving." });
    group.members = group.members.filter(m => m.matric !== req.student.sub);
    await group.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/study-groups/:code/close — host only, archives it
router.post('/study-groups/:code/close', async (req, res) => {
  try {
    const r = await StudyGroup.updateOne({ code: String(req.params.code || '').toUpperCase(), hostMatric: req.student.sub }, { archived: true });
    if (!r.matchedCount) return res.status(404).json({ error: 'Group not found, or you are not the host' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
