const express = require('express');
const ContestTemplate = require('../../models/ContestTemplate');
const { requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

// GET /api/admin/contest-templates
router.get('/contest-templates', async (req, res) => {
  try {
    const templates = await ContestTemplate.find().sort({ createdAt: -1 }).lean();
    res.json(templates);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/contest-templates
router.post('/contest-templates', async (req, res) => {
  try {
    const {
      title, description, type, entryFee, maxParticipants, prizePool, prizeDistribution,
      questions, autoPickCourse, autoPickCount,
      frequency, dayOfWeek, timeOfDay, durationMinutes,
    } = req.body;

    if (!title || !type || !frequency || !timeOfDay || !durationMinutes) {
      return res.status(400).json({ error: 'title, type, frequency, timeOfDay, and durationMinutes are required' });
    }
    if (frequency === 'weekly' && (dayOfWeek === undefined || dayOfWeek === null)) {
      return res.status(400).json({ error: 'dayOfWeek is required for weekly templates' });
    }
    if (!/^\d{2}:\d{2}$/.test(timeOfDay)) return res.status(400).json({ error: 'timeOfDay must be HH:MM' });

    const template = await ContestTemplate.create({
      title, description: description || '', type,
      entryFee: entryFee || 0, maxParticipants: maxParticipants || null,
      prizePool: prizePool || 0, prizeDistribution: prizeDistribution || [],
      questions: questions || [], autoPickCourse: autoPickCourse || null, autoPickCount: autoPickCount || 10,
      frequency, dayOfWeek: frequency === 'weekly' ? dayOfWeek : null, timeOfDay, durationMinutes,
      createdBy: req.admin.sub,
    });
    res.status(201).json(template);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/contest-templates/:id
router.put('/contest-templates/:id', async (req, res) => {
  try {
    const template = await ContestTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const editable = [
      'title', 'description', 'entryFee', 'maxParticipants', 'prizePool', 'prizeDistribution',
      'questions', 'autoPickCourse', 'autoPickCount', 'frequency', 'dayOfWeek', 'timeOfDay',
      'durationMinutes', 'active',
    ];
    for (const field of editable) {
      if (req.body[field] !== undefined) template[field] = req.body[field];
    }
    await template.save();
    res.json(template);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/contest-templates/:id — does not affect any
// contest already spawned from it, only stops future spawns.
router.delete('/contest-templates/:id', async (req, res) => {
  try {
    await ContestTemplate.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
