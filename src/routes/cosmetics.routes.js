const express = require('express');
const CosmeticItem = require('../models/CosmeticItem');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { applyCreditDelta } = require('../utils/credits');
const { withLock } = require('../utils/lock');
const { isObjectId } = require('../utils/validate');

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
    // A badge slot only accepts a badge and a frame slot only a frame.
    const typeOf = async (id) => (await CosmeticItem.findById(id).select('type').lean())?.type;
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
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Item not found' });
    const item = await CosmeticItem.findById(req.params.id);
    if (!item || !item.active) return res.status(404).json({ error: 'Item not found' });

    // Serialized per student so a double-tap can't buy (and pay for) the same item twice.
    await withLock(`cosmetic:${req.student.sub}`, async () => {
      const student = await Student.findOne({ matric: req.student.sub });
      if (!student) return res.status(404).json({ error: 'Student not found' });

      if ((student.ownedCosmetics || []).some(id => String(id) === String(item._id))) {
        return res.status(409).json({ error: 'You already own this item' });
      }

      let balance;
      try {
        ({ balance } = await applyCreditDelta({
          matric: student.matric,
          delta: -item.price,
          reason: 'cosmetic_purchase',
          note: `Purchased "${item.name}"`,
          actor: student.matric,
          studentDoc: student,
        }));
      } catch (e) {
        if (e.code === 'INSUFFICIENT_CREDITS') return res.status(400).json({ error: 'Insufficient credits' });
        throw e;
      }

      try {
        await Student.updateOne({ _id: student._id }, { $addToSet: { ownedCosmetics: item._id } });
      } catch (e) {
        await applyCreditDelta({ matric: student.matric, delta: item.price, reason: 'refund', note: `Refund — could not unlock "${item.name}"`, actor: 'system' }).catch(() => {});
        throw e;
      }

      res.json({ success: true, newBalance: balance });
    });
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
    // A badge slot only accepts a badge and a frame slot only a frame.
    const typeOf = async (id) => (await CosmeticItem.findById(id).select('type').lean())?.type;

    if (badgeId !== undefined) {
      if (badgeId !== null && (!isObjectId(String(badgeId)) || !owned.has(String(badgeId)))) return res.status(403).json({ error: 'You do not own that badge' });
      if (badgeId !== null && (await typeOf(badgeId)) !== 'badge') return res.status(400).json({ error: 'That item is not a badge' });
      student.equippedBadge = badgeId;
    }
    if (frameId !== undefined) {
      if (frameId !== null && (!isObjectId(String(frameId)) || !owned.has(String(frameId)))) return res.status(403).json({ error: 'You do not own that frame' });
      if (frameId !== null && (await typeOf(frameId)) !== 'frame') return res.status(400).json({ error: 'That item is not a frame' });
      student.equippedFrame = frameId;
    }
    await student.save();
    res.json({ success: true, equippedBadge: student.equippedBadge, equippedFrame: student.equippedFrame });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
