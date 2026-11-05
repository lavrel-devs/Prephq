const express = require('express');
const { requireAdmin } = require('../../middleware/auth');
const { aiStatus, testProviders } = require('../../services/groq.service');

// v1.8.7 AI providers (Groq + Gemini). Not listed in utils/adminAccess.js on purpose: unlisted endpoints need full access.
//   GET  /api/admin/ai/status   which providers are configured, who goes first, who is cooling after a rate limit
//   POST /api/admin/ai/test     one tiny real call to each configured provider
const router = express.Router();
router.use(requireAdmin);
router.get('/ai/status', (req, res) => res.json(aiStatus()));
router.post('/ai/test', async (req, res) => {
  try { res.json(await testProviders()); } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
