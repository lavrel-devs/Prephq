const express = require('express');
const CosmeticItem = require('../../models/CosmeticItem');
const { requireAdmin } = require('../../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

// GET /api/admin/cosmetics — full catalog, any status
router.get('/cosmetics', async (req, res) => {
  try {
    const items = await CosmeticItem.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/cosmetics
router.post('/cosmetics', async (req, res) => {
  try {
    const { name, type, value, price, description } = req.body;
    if (!name || !type || !value || !Number.isFinite(price)) {
      return res.status(400).json({ error: 'name, type, value, and price are required' });
    }
    if (!['badge', 'frame'].includes(type)) return res.status(400).json({ error: "type must be 'badge' or 'frame'" });

    const item = await CosmeticItem.create({
      name, type, value, price, description: description || '', createdBy: req.admin.sub,
    });
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/cosmetics/:id
router.put('/cosmetics/:id', async (req, res) => {
  try {
    const item = await CosmeticItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const editable = ['name', 'value', 'price', 'description', 'active'];
    for (const field of editable) {
      if (req.body[field] !== undefined) item[field] = req.body[field];
    }
    await item.save();
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/cosmetics/:id — soft-delete via `active:false` is
// safer (students who already own it keep it, it just leaves the
// shop), but a hard delete is offered here for genuine mistakes; the
// item reference on any student's ownedCosmetics/equipped fields
// simply won't resolve to anything after this, which the frontend
// already handles gracefully (falls back to nothing rendered).
router.delete('/cosmetics/:id', async (req, res) => {
  try {
    await CosmeticItem.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
