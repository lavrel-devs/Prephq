const express = require('express');
const Student = require('../models/Student');
const Transfer = require('../models/Transfer');
const { requireStudent } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimit');
const { applyCreditDelta } = require('../utils/credits');
const { normalizeUsername } = require('../utils/username');
const { notify } = require('../services/notification.service');

const router = express.Router();

const FEE = 1;
const MIN_TRANSFER = 2; // recipient must receive at least this many credits
const MAX_TRANSFERS_PER_DAY = 10;
const COOLDOWN_MS = 30 * 1000;

// NOTE on atomicity: this deployment runs MongoDB without a replica set
// (Render free tier / standalone Mongo), so multi-document ACID
// transactions aren't available here — same constraint the rest of the
// codebase already works within (see applyCreditDelta). The debit is
// applied before the credit, and both fail loudly (500) if either step
// throws, so the only failure window is a crash between the two writes.
// Acceptable for a free-tier deployment; if this ever moves onto a
// replica-set-backed cluster, wrap the two applyCreditDelta calls in a
// mongoose session/transaction.

// POST /api/transfer — send credits to another user by @username.
router.post('/transfer', requireStudent, transferLimiter, async (req, res) => {
  try {
    const { username, amount } = req.body;
    const parsedAmount = parseInt(amount, 10);

    if (!username) return res.status(400).json({ error: 'Recipient username is required' });
    if (!Number.isFinite(parsedAmount) || parsedAmount < MIN_TRANSFER) {
      return res.status(400).json({ error: `Minimum transfer is ${MIN_TRANSFER} credits` });
    }

    const sender = await Student.findOne({ matric: req.student.sub });
    if (!sender) return res.status(404).json({ error: 'Sender not found' });

    const targetUsername = normalizeUsername(username.replace(/^@/, ''));
    const recipient = await Student.findOne({ username: targetUsername });
    if (!recipient) return res.status(404).json({ error: 'No user found with that username' });
    if (recipient.matric === sender.matric) return res.status(400).json({ error: "You can't transfer credits to yourself" });

    const totalDebited = parsedAmount + FEE;
    if ((sender.credits || 0) < totalDebited) {
      return res.status(400).json({
        error: `Insufficient credits. Sending ${parsedAmount} costs ${totalDebited} with the ${FEE}-credit fee.`,
      });
    }

    // ── Rate limits: 10/day + 30s cooldown ──────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [todayCount, lastTransfer] = await Promise.all([
      Transfer.countDocuments({ fromMatric: sender.matric, createdAt: { $gte: since24h }, status: 'completed' }),
      Transfer.findOne({ fromMatric: sender.matric }).sort({ createdAt: -1 }).lean(),
    ]);

    if (todayCount >= MAX_TRANSFERS_PER_DAY) {
      return res.status(429).json({ error: `You've reached the limit of ${MAX_TRANSFERS_PER_DAY} transfers per day` });
    }
    if (lastTransfer && Date.now() - new Date(lastTransfer.createdAt).getTime() < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (Date.now() - new Date(lastTransfer.createdAt).getTime())) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSec}s before sending another transfer` });
    }

    // ── Apply the debit and credit ──────────────────────────────
    const senderResult = await applyCreditDelta({
      matric: sender.matric,
      delta: -totalDebited,
      reason: 'transfer_sent',
      note: `Sent ${parsedAmount} credits to @${recipient.username} (+${FEE} fee)`,
      actor: sender.matric,
      studentDoc: sender,
    });

    const recipientResult = await applyCreditDelta({
      matric: recipient.matric,
      delta: parsedAmount,
      reason: 'transfer_received',
      note: `Received ${parsedAmount} credits from @${sender.username || sender.matric}`,
      actor: sender.matric,
      studentDoc: recipient,
    });

    const transfer = await Transfer.create({
      fromMatric: sender.matric,
      toMatric: recipient.matric,
      fromUsername: sender.username || '',
      toUsername: recipient.username || '',
      amount: parsedAmount,
      fee: FEE,
      totalDebited,
      status: 'completed',
      senderTxId: senderResult.transaction._id,
      recipientTxId: recipientResult.transaction._id,
    });

    await notify({
      matric: recipient.matric,
      type: 'transfer_received',
      title: 'Credits received',
      message: `@${sender.username || sender.matric} sent you ${parsedAmount} credits`,
      relatedId: transfer._id,
      relatedType: 'Transfer',
    });

    res.json({
      success: true,
      transferId: transfer._id,
      amountSent: parsedAmount,
      fee: FEE,
      newBalance: senderResult.balance,
    });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_CREDITS') return res.status(400).json({ error: 'Insufficient credits' });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/transfer/history — the current student's send + receive log.
router.get('/transfer/history', requireStudent, async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.student.sub }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [sent, received] = await Promise.all([
      Transfer.find({ fromMatric: student.matric }).sort({ createdAt: -1 }).limit(50).lean(),
      Transfer.find({ toMatric: student.matric }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    const history = [
      ...sent.map(t => ({ ...t, direction: 'sent' })),
      ...received.map(t => ({ ...t, direction: 'received' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
