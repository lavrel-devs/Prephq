const express = require('express');
const Announcement = require('../../models/Announcement');
const Student = require('../../models/Student');
const { requireAdmin } = require('../../middleware/auth');
const { notify } = require('../../services/notification.service');

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
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

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
    const targets = await Student.find(filter).select('matric').lean();

    for (const t of targets) {
      await notify({
        matric: t.matric,
        type: 'announcement',
        title: announcement.title,
        message: announcement.content,
        relatedId: announcement._id,
        relatedType: 'Announcement',
      });
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
