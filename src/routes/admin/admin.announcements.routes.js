const express = require('express');
const Announcement = require('../../models/Announcement');
const Student = require('../../models/Student');
const { requireAdmin } = require('../../middleware/auth');
const Notification = require('../../models/Notification');

const router = express.Router();
router.use(requireAdmin);

// GET /api/admin/announcements
router.get('/announcements', async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json(announcements);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/announcements — create AND broadcast immediately to
// the target audience's notification feed.
router.post('/announcements', async (req, res) => {
  try {
    const { title, content, targetAudience, expiresAt } = req.body;
    if (typeof title !== 'string' || typeof content !== 'string' || !title.trim() || !content.trim()) return res.status(400).json({ error: 'title and content are required' });
    if (targetAudience !== undefined && !['all', 'active_users', 'new_users'].includes(targetAudience)) return res.status(400).json({ error: 'Invalid targetAudience' });
    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) return res.status(400).json({ error: 'expiresAt is not a valid date' });

    const announcement = await Announcement.create({
      title, content,
      targetAudience: targetAudience || 'all',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: req.admin.sub,
    });

    // Resolve target audience to a matric list.
    let filter = {};
    if (announcement.targetAudience === 'active_users') {
      filter.lastActiveAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    } else if (announcement.targetAudience === 'new_users') {
      filter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    }
    filter.active = { $ne: false }; // suspended accounts don't get broadcasts
    const targets = await Student.find(filter).select('matric').lean();

    // One bulk insert instead of one sequential write per student.
    if (targets.length) {
      await Notification.insertMany(targets.map(t => ({
        matric: t.matric,
        type: 'announcement',
        title: announcement.title,
        message: announcement.content,
        relatedId: announcement._id,
        relatedType: 'Announcement',
      })), { ordered: false });
    }

    res.status(201).json({ announcement, sentTo: targets.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', async (req, res) => {
  try {
    await Announcement.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
