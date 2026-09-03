const express = require('express');
const CosmeticItem = require('../models/CosmeticItem');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { applyCreditDelta } = require('../utils/credits');

const router = express.Router();

// GET /api/cosmetics — active shop catalog, annotated with this
// student's ownership + equipped state.
router.get('/cosmetics', requireStudent, async (req, res) => {
  try {
    const [items, student] = await Promise.all([
      CosmeticItem.find({ active: true }).sort({ price: 1 }).lean(),
      Student.findOne({ matric: req.student.sub }).lean(),
    ]);
    const owned = new Set((student.ownedCosmetics || []).map(String));
    res.json(items.map(item => ({
      ...item,
      owned: owned.has(String(item._id)),
      equipped: String(student.equippedBadge) === String(item._id) || String(student.equippedFrame) === String(item._id),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cosmetics/:id/purchase
router.post('/cosmetics/:id/purchase', requireStudent, async (req, res) => {
  try {
    const item = await CosmeticItem.findById(req.params.id);
    if (!item || !item.active) return res.status(404).json({ error: 'Item not found' });

    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if ((student.ownedCosmetics || []).some(id => String(id) === String(item._id))) {
      return res.status(409).json({ error: 'You already own this item' });
    }
    if ((student.credits || 0) < item.price) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    await applyCreditDelta({
      matric: student.matric,
      delta: -item.price,
      reason: 'cosmetic_purchase',
      note: `Purchased "${item.name}"`,
      actor: student.matric,
      studentDoc: student,
    });
    student.ownedCosmetics.push(item._id);
    await student.save();

    res.json({ success: true, newBalance: student.credits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/cosmetics/equip — body: { badgeId?: id|null, frameId?: id|null }
// Either field may be omitted (leave as-is), or set to null (unequip).
router.put('/cosmetics/equip', requireStudent, async (req, res) => {
  try {
    const { badgeId, frameId } = req.body;
    const student = await Student.findOne({ matric: req.student.sub });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const owned = new Set((student.ownedCosmetics || []).map(String));

    if (badgeId !== undefined) {
      if (badgeId !== null && !owned.has(String(badgeId))) return res.status(403).json({ error: 'You do not own that badge' });
      student.equippedBadge = badgeId;
    }
    if (frameId !== undefined) {
      if (frameId !== null && !owned.has(String(frameId))) return res.status(403).json({ error: 'You do not own that frame' });
      student.equippedFrame = frameId;
    }
    await student.save();
    res.json({ success: true, equippedBadge: student.equippedBadge, equippedFrame: student.equippedFrame });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
