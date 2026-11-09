const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Course = require('../models/Course');
const Question = require('../models/Question');
const Score = require('../models/Score');
const QuestionAttempt = require('../models/QuestionAttempt');
const { checkAvailability, normalizeUsername } = require('../utils/username');
const { activateNewStudent } = require('./credit.service');
const { generateQuiz } = require('./groq.service');
const { applyCreditDelta } = require('../utils/credits');
const { checkDailyLimit, incrementDailyUsage } = require('./tier.service');
const GeneratedQuestion = require('../models/GeneratedQuestion');
const Notification = require('../models/Notification');
const FlashcardProgress = require('../models/FlashcardProgress');
const { chat: tutorChat } = require('./brainiac.service');
const { progress14, watDay } = require('./study.service');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const WEBSITE_URL = process.env.TELEGRAM_WEB_URL || process.env.SELF_URL || '';
const POLL_TIMEOUT = 25;
let offset = 0;
let stopped = false;
let polling = false;

// Conversation state is intentionally short-lived. Passwords are never put in this map.
const flows = new Map();
const quizzes = new Map();
const flashcards = new Map();
const timers = new Map();

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function chatKey(chatId) { return String(chatId); }

async function telegram(method, body = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed`);
  return payload.result;
}
async function send(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra,
  });
}
async function answerCallback(id, text = '') {
  return telegram('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
}
function menuKeyboard() {
  const rows = [
    [{ text: '👤 Account' }, { text: '✏️ Edit profile' }],
    [{ text: '📚 Courses' }, { text: '📝 Practice quiz' }],
    [{ text: '🤖 AI quiz' }, { text: '📊 My results' }],
    [{ text: '🧠 AI tutor' }, { text: '🗂 Flashcards' }],
    [{ text: '📅 Study plan' }, { text: '📈 Progress' }],
    [{ text: '⏱ Focus mode' }, { text: '🔔 Reminders' }],
    [{ text: '🔔 Notifications' }, { text: '🌐 Open website' }],
    [{ text: '❓ Help' }],
  ];
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}
async function showMenu(chatId, intro = '<b>Wreddi</b> — choose an option below.') {
  return send(chatId, intro, { reply_markup: menuKeyboard() });
}
function commands() {
  return [
    { command: 'start', description: 'Open the Wreddi menu' },
    { command: 'create', description: 'Create a Wreddi account' },
    { command: 'link', description: 'Link an existing account' },
    { command: 'quiz', description: 'Start a real practice quiz' },
    { command: 'aiquiz', description: 'Generate an AI quiz' },
    { command: 'ask', description: 'Ask the AI tutor' },
    { command: 'flashcards', description: 'Review flashcards' },
    { command: 'plan', description: 'Show today study plan' },
    { command: 'progress', description: 'Show study progress' },
    { command: 'focus', description: 'Start focus mode' },
    { command: 'remind', description: 'Set a study reminder' },
    { command: 'edit', description: 'Edit your profile' },
    { command: 'me', description: 'View your account' },
    { command: 'results', description: 'View quiz results' },
    { command: 'courses', description: 'List courses' },
    { command: 'website', description: 'Open the full website' },
    { command: 'help', description: 'Show help' },
  ];
}
async function help(chatId) {
  return send(chatId,
`<b>Wreddi Telegram</b>\n\n` +
`Use the menu buttons or these commands:\n\n` +
`/ask QUESTION — AI tutor\n/flashcards COURSE — spaced-repetition cards\n/plan — today's study plan\n/progress — 14-day tracker\n/focus MINUTES — focus timer\n/remind MINUTES MESSAGE — study reminder\n` +
`/create — create a new account\n/link MATRIC PASSWORD — link an existing account\n/quiz COURSE — take a real scored quiz\n/aiquiz COURSE — generate an AI quiz (uses the same credits/limits as the website)\n/edit FIELD VALUE — edit profile details\n/me — account and credits\n/courses — course list\n/website — open every website feature\n/unlink — disconnect Telegram\n/cancel — cancel the current flow`, { reply_markup: menuKeyboard() });
}
async function linkedStudent(chatId) {
  return Student.findOne({ telegramChatId: String(chatId), active: { $ne: false } });
}
async function requireStudent(chatId) {
  const student = await linkedStudent(chatId);
  if (!student) {
    await send(chatId, 'You need an account first. Use /create or /link MATRIC PASSWORD.');
    return null;
  }
  return student;
}
async function linkAccount(chatId, args, from) {
  if (args.length < 2) return send(chatId, 'Usage: <code>/link MATRIC PASSWORD</code>\nThe password is checked once and never stored by the bot.');
  const identifier = args.shift().replace(/^@/, '');
  const password = args.join(' ');
  const student = await Student.findOne({ $or: [{ matric: identifier.toUpperCase() }, { username: identifier.toLowerCase() }] });
  let valid = false;
  if (student) valid = student.passwordHash ? await bcrypt.compare(password, student.passwordHash) : student.password === password;
  if (!student || !valid || student.active === false) return send(chatId, 'Could not verify those credentials.');
  await Student.updateMany({ telegramChatId: String(chatId) }, { $unset: { telegramChatId: 1, telegramUsername: 1 } });
  await Student.updateOne({ _id: student._id }, { $unset: { telegramChatId: 1, telegramUsername: 1 } });
  await Student.updateOne({ _id: student._id }, { $set: { telegramChatId: String(chatId), telegramUsername: from?.username || '' } });
  return showMenu(chatId, `Linked successfully. Welcome, <b>${esc(student.name)}</b>!`);
}
async function beginCreate(chatId) {
  flows.set(chatKey(chatId), { type: 'create', step: 'name', data: {} });
  return send(chatId, '<b>Create your Wreddi account</b>\n\nStep 1/5: Send your full name.\nUse /cancel to stop.');
}
async function createFlow(chatId, text, from) {
  const flow = flows.get(chatKey(chatId));
  if (!flow) return false;
  if (text.toLowerCase() === '/cancel') { flows.delete(chatKey(chatId)); await send(chatId, 'Cancelled.'); return true; }
  const value = text.trim();
  if (!value || value.length > 120) { await send(chatId, 'Please send a valid value, or /cancel.'); return true; }
  if (flow.step === 'name') {
    flow.data.name = value; flow.step = 'matric';
    await send(chatId, 'Step 2/5: Send your matric number.'); return true;
  }
  if (flow.step === 'matric') {
    const matric = value.toUpperCase();
    if (!/^[A-Z0-9 /_.-]{3,30}$/.test(matric)) { await send(chatId, 'That matric number is invalid. Try again.'); return true; }
    if (await Student.exists({ matric })) { await send(chatId, 'That matric number already has an account. Use /link MATRIC PASSWORD instead.'); flows.delete(chatKey(chatId)); return true; }
    flow.data.matric = matric; flow.step = 'username';
    await send(chatId, 'Step 3/5: Choose a username (letters, numbers, underscore; 3–24 characters).'); return true;
  }
  if (flow.step === 'username') {
    const result = await checkAvailability(value);
    if (!result.ok) { await send(chatId, `Username unavailable: ${esc(result.reason)}. Try another.`); return true; }
    flow.data.username = normalizeUsername(value); flow.step = 'password';
    await send(chatId, 'Step 4/5: Send a password of 8–72 characters. It will be used only to create your account.'); return true;
  }
  if (flow.step === 'password') {
    if (value.length < 8 || value.length > 72 || value.toUpperCase() === flow.data.matric) { await send(chatId, 'Password must be 8–72 characters and cannot be your matric number.'); return true; }
    flow.data.passwordHash = await bcrypt.hash(value, 10); flow.step = 'university';
    await send(chatId, 'Step 5/5: Send your university or school name.'); return true;
  }
  if (flow.step === 'university') {
    const d = flow.data;
    try {
      const student = await Student.create({ matric: d.matric, name: d.name, username: d.username, passwordHash: d.passwordHash, university: value, telegramChatId: String(chatId), telegramUsername: from?.username || '', termsAcceptedAt: new Date(), termsVersion: process.env.LEGAL_VERSION || 'telegram' });
      delete d.passwordHash;
      await activateNewStudent(student);
      flows.delete(chatKey(chatId));
      return showMenu(chatId, `Account created for <b>${esc(student.name)}</b> (${esc(student.matric)}).\nYour Telegram chat is now linked.`);
    } catch (error) {
      flows.delete(chatKey(chatId));
      console.error('[telegram] account creation:', error.message);
      return send(chatId, error.code === 11000 ? 'That username or matric number was just taken. Please try /create again.' : 'Account creation failed. Please try again.');
    }
  }
  return true;
}
async function editProfile(chatId, args) {
  const student = await requireStudent(chatId); if (!student) return;
  if (args.length < 2) return send(chatId, '<b>Edit profile</b>\nUsage: <code>/edit FIELD VALUE</code>\nFields: name, username, displayname, phone, university, department, currentgpa, targetgpa');
  const field = args.shift().toLowerCase(); const value = args.join(' ').trim();
  const map = { name: 'name', username: 'username', displayname: 'displayName', phone: 'phone', university: 'university', department: 'department', currentgpa: 'currentGPA', targetgpa: 'targetGPA' };
  if (!map[field]) return send(chatId, 'Unknown field. Use /edit to see supported fields.');
  if (field === 'username') {
    const result = await checkAvailability(value, student._id);
    if (!result.ok) return send(chatId, `Username unavailable: ${esc(result.reason)}.`);
    student.username = normalizeUsername(value);
  }
  if (field === 'username') {
    // Already normalized and assigned above.
  } else if (['currentGPA', 'targetGPA'].includes(map[field])) {
    const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > (student.gpaScale || 5)) return send(chatId, `GPA must be between 0 and ${student.gpaScale || 5}.`); student[map[field]] = n;
  } else student[map[field]] = value.slice(0, 120);
  await student.save();
  return send(chatId, `Updated <b>${esc(field)}</b>. Use /me to view your profile.`);
}
async function showMe(chatId) {
  const s = await requireStudent(chatId); if (!s) return;
  return send(chatId, `<b>${esc(s.name)}</b>\nMatric: <code>${esc(s.matric)}</code>\nUsername: @${esc(s.username || 'not set')}\nUniversity: ${esc(s.university || 'not set')}\nDepartment: ${esc(s.department || 'not set')}\nPlan: ${esc(s.tier || 'free')}\nCredits: <b>${Number(s.credits || 0)}</b>\nGPA: ${s.currentGPA ?? 'not set'} / ${s.gpaScale || 5}`);
}
async function showCourses(chatId) {
  const courses = await Course.find().sort({ courseCode: 1 }).lean();
  const rows = courses.map(c => [{ text: `${c.courseCode || c.key} — ${c.courseTitle || ''}`, callback_data: `course:${c.key || c.courseCode}` }]);
  return send(chatId, courses.length ? '<b>Choose a course</b>\nYou can then start a quiz from the course menu.' : 'No courses are available yet.', { reply_markup: { inline_keyboard: rows.slice(0, 50) } });
}
async function startQuiz(chatId, args) {
  const student = await requireStudent(chatId); if (!student) return;
  if (!args.length) return showCourses(chatId);
  const key = args.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  const course = await Course.findOne({ $or: [{ key }, { courseCode: key.toUpperCase() }] }).lean();
  const candidates = new Set([key, key.toUpperCase()]); if (course) candidates.add(course.key).add(course.courseCode);
  const qs = await Question.aggregate([{ $match: { course: { $in: [...candidates] } } }, { $sample: { size: 10 } }]);
  if (!qs.length) return send(chatId, 'No questions found for that course. Use /courses.');
  quizzes.set(chatKey(chatId), { type: 'bank', matric: student.matric, course: course?.courseCode || args.join(' '), questions: qs, index: 0, answers: [], correct: 0, startedAt: Date.now() });
  return sendQuizQuestion(chatId);
}
async function sendQuizQuestion(chatId) {
  const quiz = quizzes.get(chatKey(chatId)); if (!quiz) return;
  const q = quiz.questions[quiz.index];
  const buttons = (q.opts || []).map((o, i) => [{ text: `${String.fromCharCode(65 + i)}. ${String(o).slice(0, 55)}`, callback_data: `answer:${i}` }]);
  return send(chatId, `<b>${esc(quiz.course)} — Question ${quiz.index + 1}/${quiz.questions.length}</b>\n\n${esc(q.q)}`, { reply_markup: { inline_keyboard: buttons } });
}
async function answerQuiz(chatId, callback) {
  const quiz = quizzes.get(chatKey(chatId)); if (!quiz) return answerCallback(callback.id, 'This quiz has expired.');
  const answer = Number(callback.data.split(':')[1]); const q = quiz.questions[quiz.index];
  if (!Number.isInteger(answer) || answer < 0 || answer >= q.opts.length) return answerCallback(callback.id, 'Invalid answer.');
  quiz.answers.push(answer); if (answer === q.ans) quiz.correct++;
  await answerCallback(callback.id, answer === q.ans ? 'Correct' : 'Wrong');
  quiz.index++;
  if (quiz.index < quiz.questions.length) return sendQuizQuestion(chatId);
  const total = quiz.questions.length; const pct = Math.round((quiz.correct / total) * 100);
  await Score.create({ matric: quiz.matric, correct: quiz.correct, total, pct, wrong: total - quiz.correct, skip: 0, courses: quiz.course, mode: 'telegram-practice' });
  await QuestionAttempt.insertMany(quiz.questions.map((item, i) => ({ matric: quiz.matric, course: quiz.course, tag: item.tag || '', correct: quiz.answers[i] === item.ans, qid: item._id })));
  quizzes.delete(chatKey(chatId));
  return send(chatId, `<b>Quiz complete</b>\n\nScore: <b>${quiz.correct}/${total}</b> (${pct}%)\nCourse: ${esc(quiz.course)}\n\nUse /quiz COURSE to play again or /me to see your account.`, { reply_markup: menuKeyboard() });
}
async function aiQuiz(chatId, args) {
  const student = await requireStudent(chatId); if (!student) return;
  if (!args.length) return send(chatId, 'Usage: <code>/aiquiz COURSE</code>\nThis uses the same daily limit and credit charge as the website.');
  const course = args.join(' ').slice(0, 60);
  try {
    await checkDailyLimit(student, 'aiQuiz');
    const cost = Number(process.env.CREDIT_COST_QUIZ_GEN || 5);
    if ((student.credits || 0) < cost) return send(chatId, `Not enough credits. This costs ${cost} credits.`);
    const generated = await generateQuiz({ course, difficulty: 'medium', count: 5, studyMaterial: '' });
    if (!generated.questions?.length) return send(chatId, 'The AI did not return usable questions. Try again later.');
    await applyCreditDelta({ matric: student.matric, delta: -cost, reason: 'quiz_generation', note: `Telegram AI quiz — ${course}`, actor: 'system' });
    await GeneratedQuestion.create({ matric: student.matric, course, difficulty: 'medium', model: generated.model, creditCost: cost, questions: generated.questions });
    await incrementDailyUsage(student, 'aiQuiz');
    quizzes.set(chatKey(chatId), { type: 'ai', matric: student.matric, course, questions: generated.questions, index: 0, answers: [], correct: 0, startedAt: Date.now() });
    return sendQuizQuestion(chatId);
  } catch (error) { return send(chatId, error.code === 'LIMIT_REACHED' ? error.message : `AI quiz unavailable: ${esc(error.message)}`); }
}
async function askTutor(chatId, args) {
  const student = await requireStudent(chatId); if (!student) return;
  if (!args.length) return send(chatId, 'Usage: <code>/ask Explain photosynthesis simply</code>');
  try {
    const result = await tutorChat(student, args.join(' ').slice(0, 1500), { channel: 'telegram' });
    return send(chatId, `<b>AI tutor</b>\n\n${esc(result.reply)}\n\nAI messages remaining today: ${result.dailyRemaining ?? '—'}`);
  } catch (error) { return send(chatId, `AI tutor unavailable: ${esc(error.message)}`); }
}
async function showPlan(chatId) {
  const student = await requireStudent(chatId); if (!student) return;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = await Score.aggregate([{ $match: { matric: student.matric, ts: { $gte: start } } }, { $group: { _id: null, questions: { $sum: '$total' }, correct: { $sum: '$correct' }, quizzes: { $sum: 1 } } }]);
  const row = today[0] || { questions: 0, correct: 0, quizzes: 0 };
  const target = 20; const remaining = Math.max(0, target - (row.questions || 0));
  return send(chatId, `<b>Today's study plan</b>\n\n• Answer ${target} questions — ${row.questions || 0}/${target} completed\n• ${remaining ? `Continue with ${remaining} more practice questions` : 'Daily question goal complete'}\n• Review your weakest topics with /flashcards COURSE\n• Use /focus 25 for a distraction-free session\n\nStreak: ${student.streakCount || 0} days\nSelected courses: ${student.selectedCourses?.length ? student.selectedCourses.join(', ') : 'none set'}`);
}
async function showProgress(chatId) {
  const student = await requireStudent(chatId); if (!student) return;
  const p = await progress14(student.matric);
  return send(chatId, `<b>14-day study progress</b>\n\nActive days: <b>${p.activeDays}/14</b>\nConsistency: <b>${p.consistency}%</b>\nThis week: <b>${p.thisWeek}</b> questions\nPrevious week: <b>${p.lastWeek}</b> questions\n\n${p.days.slice(-7).map(d => `${d.date}: ${d.questions} questions, ${d.correct} correct`).join('\n')}`);
}
async function startFocus(chatId, args) {
  if (timers.has(`focus:${chatKey(chatId)}`)) return send(chatId, 'Focus mode is already running. Use <code>/focus stop</code> to end it.');
  if (args[0]?.toLowerCase() === 'stop') return stopFocus(chatId);
  const minutes = Math.min(Math.max(Number(args[0] || 25), 1), 180);
  const timer = setTimeout(() => { timers.delete(`focus:${chatKey(chatId)}`); send(chatId, `⏰ Focus session complete — ${minutes} minutes finished. Take a short break, then /quiz COURSE to test what you learned.`).catch(() => {}); }, minutes * 60 * 1000);
  timers.set(`focus:${chatKey(chatId)}`, timer);
  return send(chatId, `⏱ <b>Focus mode started</b>\n\n${minutes} minutes. Put distractions away and study one topic.\n\nUse /focus stop to end early.`);
}
async function stopFocus(chatId) {
  const key = `focus:${chatKey(chatId)}`; const timer = timers.get(key);
  if (!timer) return send(chatId, 'No focus session is running.');
  clearTimeout(timer); timers.delete(key); return send(chatId, 'Focus mode stopped. Your session was not counted as complete.');
}
async function setReminder(chatId, args) {
  if (args[0]?.toLowerCase() === 'clear') {
    const key = `remind:${chatKey(chatId)}`; if (timers.has(key)) clearTimeout(timers.get(key)); timers.delete(key); return send(chatId, 'Reminder cleared.');
  }
  const minutes = Number(args[0]); const note = args.slice(1).join(' ') || 'Time to study';
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) return send(chatId, 'Usage: <code>/remind MINUTES MESSAGE</code>\nExample: <code>/remind 60 Revise chemistry</code>');
  const key = `remind:${chatKey(chatId)}`; if (timers.has(key)) clearTimeout(timers.get(key));
  const timer = setTimeout(() => { timers.delete(key); send(chatId, `🔔 <b>Study reminder</b>\n\n${esc(note)}`).catch(() => {}); }, minutes * 60 * 1000);
  timers.set(key, timer); return send(chatId, `Reminder set for ${minutes} minute${minutes === 1 ? '' : 's'} from now: <b>${esc(note)}</b>\nUse /remind clear to cancel.`);
}
async function startFlashcards(chatId, args) {
  const student = await requireStudent(chatId); if (!student) return;
  if (!args.length) return send(chatId, 'Usage: <code>/flashcards COURSE</code>\nExample: <code>/flashcards CHM101</code>');
  const course = args.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  const qs = await Question.aggregate([{ $match: { course: { $in: [course, course.toUpperCase()] } } }, { $sample: { size: 5 } }]);
  if (!qs.length) return send(chatId, 'No flashcards found for that course.');
  flashcards.set(chatKey(chatId), { student: student.matric, course, questions: qs, index: 0, revealed: false });
  return sendFlashcard(chatId);
}
async function sendFlashcard(chatId) {
  const deck = flashcards.get(chatKey(chatId)); if (!deck) return;
  const q = deck.questions[deck.index];
  return send(chatId, `<b>Flashcard ${deck.index + 1}/${deck.questions.length}</b>\n\n${esc(q.q)}\n\nTap Reveal when ready.`, { reply_markup: { inline_keyboard: [[{ text: 'Reveal answer', callback_data: 'fc:reveal' }]] } });
}
async function flashcardCallback(chatId, callback) {
  const deck = flashcards.get(chatKey(chatId)); if (!deck) return answerCallback(callback.id, 'Deck expired.');
  const q = deck.questions[deck.index]; const action = callback.data.split(':')[1];
  if (action === 'reveal') {
    deck.revealed = true; await answerCallback(callback.id);
    return send(chatId, `<b>Answer:</b> ${esc(q.opts?.[q.ans] || 'Not available')}${q.exp ? `\n\n<b>Explanation:</b> ${esc(q.exp)}` : ''}\n\nHow difficult was this card?`, { reply_markup: { inline_keyboard: [[{ text: 'Again', callback_data: 'fc:0' }, { text: 'Hard', callback_data: 'fc:1' }, { text: 'Good', callback_data: 'fc:2' }, { text: 'Easy', callback_data: 'fc:3' }]] } });
  }
  if (!deck.revealed) return answerCallback(callback.id, 'Reveal the answer first.');
  const quality = Number(action); if (![0, 1, 2, 3].includes(quality)) return answerCallback(callback.id, 'Invalid review.');
  const p = await FlashcardProgress.findOneAndUpdate({ matric: deck.student, questionId: q._id }, { $setOnInsert: { course: deck.course } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (quality === 0) { p.repetitions = 0; p.interval = 0; p.dueDate = new Date(Date.now() + 10 * 60 * 1000); } else { p.repetitions += 1; p.interval = p.repetitions === 1 ? [0, 1, 2, 4][quality] : Math.max(p.interval + 1, Math.round(p.interval * (p.easeFactor || 2.5))); p.dueDate = new Date(Date.now() + p.interval * 86400000); }
  p.lastReviewed = new Date(); p.lastQuality = quality; await p.save(); await answerCallback(callback.id, 'Saved');
  deck.index++; deck.revealed = false;
  if (deck.index >= deck.questions.length) { flashcards.delete(chatKey(chatId)); return send(chatId, 'Flashcard session complete. Your review schedule has been saved.'); }
  return sendFlashcard(chatId);
}
async function notifications(chatId) {
  const s = await requireStudent(chatId); if (!s) return;
  const items = await Notification.find({ matric: s.matric }).sort({ createdAt: -1 }).limit(10).lean();
  if (!items.length) return send(chatId, 'You have no notifications.', websiteButton());
  await Notification.updateMany({ matric: s.matric, read: false }, { read: true });
  return send(chatId, `<b>Notifications</b>\n\n${items.map(n => `• <b>${esc(n.title || 'Wreddi')}</b>${n.body ? ` — ${esc(n.body)}` : ''}`).join('\n')}`, websiteButton());
}
function websiteButton() {
  return WEBSITE_URL ? { reply_markup: { inline_keyboard: [[{ text: 'Open full Wreddi website', url: WEBSITE_URL }]] } } : {};
}
async function handleCallback(callback) {
  const chatId = callback.message?.chat?.id; if (!chatId) return;
  if (callback.data?.startsWith('answer:')) return answerQuiz(chatId, callback);
  if (callback.data?.startsWith('fc:')) return flashcardCallback(chatId, callback);
  if (callback.data?.startsWith('course:')) {
    const course = callback.data.slice(7);
    await answerCallback(callback.id);
    return send(chatId, `Selected <b>${esc(course)}</b>.`, { reply_markup: { inline_keyboard: [[{ text: 'Start practice quiz', callback_data: `startquiz:${course}` }]] } });
  }
  if (callback.data?.startsWith('startquiz:')) {
    await answerCallback(callback.id);
    return startQuiz(chatId, [callback.data.slice(10)]);
  }
  return answerCallback(callback.id);
}
async function handleMessage(message) {
  const chatId = message.chat.id; const text = String(message.text || '').trim(); if (!text) return;
  if (flows.has(chatKey(chatId)) && !text.startsWith('/link')) return createFlow(chatId, text, message.from);
  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  const buttonCommands = { '👤 Account': '/me', '✏️ Edit profile': '/edit', '📚 Courses': '/courses', '📝 Practice quiz': '/quiz', '🤖 AI quiz': '/aiquiz', '📊 My results': '/results', '🧠 AI tutor': '/ask', '🗂 Flashcards': '/flashcards', '📅 Study plan': '/plan', '📈 Progress': '/progress', '⏱ Focus mode': '/focus', '🔔 Reminders': '/remind', '🔔 Notifications': '/notifications', '🌐 Open website': '/website', '❓ Help': '/help' };
  const commandText = match ? text : buttonCommands[text];
  if (!commandText) return send(chatId, 'Use the menu buttons or /help.');
  const parsed = commandText.match(/^\/(\w+)(?:\s+([\s\S]*))?$/); const command = parsed[1].toLowerCase(); const args = parsed[2] ? parsed[2].trim().split(/\s+/) : [];
  if (command === 'start') return showMenu(chatId);
  if (command === 'help') return help(chatId);
  if (command === 'cancel') { flows.delete(chatKey(chatId)); quizzes.delete(chatKey(chatId)); return send(chatId, 'Cancelled.', { reply_markup: menuKeyboard() }); }
  if (command === 'create') return beginCreate(chatId);
  if (command === 'link') return linkAccount(chatId, args, message.from);
  if (command === 'me') return showMe(chatId);
  if (command === 'results') {
    const student = await requireStudent(chatId); if (!student) return;
    const scores = await Score.find({ matric: student.matric }).sort({ ts: -1 }).limit(10).lean();
    return send(chatId, scores.length ? `<b>Recent results</b>\n\n${scores.map((s, i) => `${i + 1}. ${esc(s.courses || 'Quiz')} — <b>${s.correct}/${s.total}</b> (${s.pct || 0}%)`).join('\n')}` : 'No quiz results yet. Start with /quiz COURSE.');
  }
  if (command === 'edit') return editProfile(chatId, args);
  if (command === 'courses') return showCourses(chatId);
  if (command === 'quiz') return startQuiz(chatId, args);
  if (command === 'aiquiz') return aiQuiz(chatId, args);
  if (command === 'ask') return askTutor(chatId, args);
  if (command === 'flashcards') return startFlashcards(chatId, args);
  if (command === 'plan') return showPlan(chatId);
  if (command === 'progress') return showProgress(chatId);
  if (command === 'focus') return startFocus(chatId, args);
  if (command === 'remind') return setReminder(chatId, args);
  if (command === 'notifications') return notifications(chatId);
  if (command === 'website') return WEBSITE_URL ? send(chatId, 'Open the full Wreddi website:', websiteButton()) : send(chatId, 'Set TELEGRAM_WEB_URL on the server to enable the website button.');
  if (command === 'unlink') { await Student.updateOne({ telegramChatId: String(chatId) }, { $unset: { telegramChatId: 1, telegramUsername: 1 } }); return showMenu(chatId, 'Telegram disconnected from your Wreddi account.'); }
  return send(chatId, 'Unknown command. Use /help.');
}
async function poll() {
  if (polling || stopped) return; polling = true;
  try {
    const updates = await telegram('getUpdates', { offset, timeout: POLL_TIMEOUT, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) { offset = update.update_id + 1; if (update.callback_query) await handleCallback(update.callback_query); else if (update.message) await handleMessage(update.message); }
  } catch (error) { if (!stopped) console.error('[telegram] polling error:', error.message); await new Promise(r => setTimeout(r, 5000)); }
  finally { polling = false; if (!stopped) setImmediate(poll); }
}
async function startTelegramBot() {
  if (!TOKEN) return console.log('[telegram] TELEGRAM_BOT_TOKEN not set; bot disabled.');
  try { const me = await telegram('getMe'); await telegram('setMyCommands', { commands: commands() }); console.log(`[telegram] bot @${me.username} started with menu and interactive quizzes.`); poll(); }
  catch (error) { console.error('[telegram] startup failed:', error.message); }
}
function stopTelegramBot() { stopped = true; flows.clear(); quizzes.clear(); flashcards.clear(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); }
module.exports = { startTelegramBot, stopTelegramBot };
