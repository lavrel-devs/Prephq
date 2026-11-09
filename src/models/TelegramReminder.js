const mongoose = require('mongoose');

const TelegramReminderSchema = new mongoose.Schema({
  chatId: { type: String, required: true, index: true },
  matric: { type: String, required: true, uppercase: true, index: true },
  text: { type: String, required: true, maxlength: 500 },
  runAt: { type: Date, required: true, index: true },
  sentAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true });

TelegramReminderSchema.index({ runAt: 1, sentAt: 1, cancelledAt: 1 });

module.exports = mongoose.model('TelegramReminder', TelegramReminderSchema);
