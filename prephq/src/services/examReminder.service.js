// ── Exam countdown nudges ───────────────────────────────────────
// v1.7. Students set an exam date + course in Settings (StudentBackup.settings.examDate/examCourse).
// Until now that was only ever shown passively when they opened Study Plan. This runs once a day and
// pushes an in-app Notification at a handful of milestone days out, so the countdown reaches them
// instead of waiting for them to check.
//
// No Telegram bot is part of this codebase (it's a separate project per the founder's own notes), so
// this only creates in-app notifications for now. The bot could subscribe to the same trigger later —
// see the comment at the bottom of sendExamReminders().
const StudentBackup = require('../models/StudentBackup');
const QuestionAttempt = require('../models/QuestionAttempt');
const Question = require('../models/Question');
const Course = require('../models/Course');
const Notification = require('../models/Notification');

const MILESTONE_DAYS = [7, 5, 3, 2, 1, 0]; // only nudge on these days-left values, not every single day

const normKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dayStartWAT = (isoDate) => new Date(`${isoDate}T00:00:00+01:00`);
const todayISOWAT = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10); // UTC+1, no DST

async function sendExamReminders() {
  const today0 = dayStartWAT(todayISOWAT());
  const backups = await StudentBackup.find({ 'settings.examDate': { $regex: /^\d{4}-\d{2}-\d{2}$/ } })
    .select('matric settings').lean();
  if (!backups.length) return { sent: 0, checked: 0 };

  let sent = 0;
  for (const b of backups) {
    try {
      const { examDate, examCourse } = b.settings || {};
      const daysLeft = Math.round((dayStartWAT(examDate) - today0) / 86400000);
      if (!MILESTONE_DAYS.includes(daysLeft)) continue;

      const dedupeKey = `exam:${examDate}:${daysLeft}`;
      if (await Notification.exists({ matric: b.matric, type: 'exam_reminder', relatedType: dedupeKey })) continue;

      const codeKey = normKey(examCourse);
      const course = codeKey ? await Course.findOne({ key: codeKey }).select('key courseCode').lean() : null;
      let progressLine = '';
      if (course) {
        // Approximation: total attempts recorded against this course, capped at the bank size — QuestionAttempt
        // doesn't store which specific question, so a true "distinct questions done" count isn't available.
        const [attempted, total] = await Promise.all([
          QuestionAttempt.countDocuments({ matric: b.matric, course: { $in: [course.key, course.courseCode] } }),
          Question.countDocuments({ course: { $in: [course.key, course.courseCode] } }),
        ]);
        if (total > 0) progressLine = ` — you've covered about ${Math.min(100, Math.round((attempted / total) * 100))}% of the past questions for it`;
      }

      const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
      const courseLabel = course ? course.courseCode : (examCourse || 'your exam');
      await Notification.create({
        matric: b.matric, type: 'exam_reminder',
        title: daysLeft === 0 ? `${courseLabel} is today!` : `${courseLabel} — ${when}`,
        message: `${courseLabel} is ${when}${progressLine}. ${daysLeft <= 2 ? 'Focus on your weak topics now.' : 'Keep practising a little each day.'}`,
        relatedType: dedupeKey,
      });
      sent++;
    } catch (e) { console.error('[examReminder] failed for', b.matric, e.message); }
  }
  // Hook for the Telegram bot: since it's a separate codebase, the cleanest integration point is to have
  // that bot poll GET Notification.find({type:'exam_reminder', createdAt:{$gte: <last poll>}}) and relay
  // each one, or to give this function an optional onSend(matric, notif) callback once the bot exposes a
  // shared internal endpoint/webhook to push into.
  return { sent, checked: backups.length };
}

module.exports = { sendExamReminders };
