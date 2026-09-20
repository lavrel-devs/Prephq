const { verifyAccessToken } = require('../utils/jwt');
const { isSessionAllowed } = require('../middleware/auth');
const StudyRoom = require('../models/StudyRoom');
const Question = require('../models/Question');
const Student = require('../models/Student');

// In-memory per-room timer handles. Ephemeral by design — these only
// track the currently-running countdown/advance timeouts on this
// server process. Room *state* (scores, current question, status)
// always lives in StudyRoom in Mongo, which is the actual source of
// truth; if the process restarts, in-flight rooms simply stop
// auto-advancing (acceptable for a free social feature — nothing
// financial rides on this, unlike Contests).
const roomTimers = new Map();

function clearRoomTimer(code) {
  const t = roomTimers.get(code);
  if (t) { clearTimeout(t); roomTimers.delete(code); }
}

function sanitizeQuestion(q) {
  return { _id: q._id, course: q.course, q: q.q, opts: q.opts };
}

function publicParticipants(room) {
  return room.participants.map(p => ({ matric: p.matric, username: p.username, score: p.score }));
}

function initStudyRoomSockets(io) {
  // Auth handshake: every socket must present a valid student access
  // token, same JWT the REST API uses — no separate auth mechanism.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing access token'));
      const payload = verifyAccessToken(token);
      if (payload.role !== 'student') return next(new Error('Forbidden'));
      // Suspended / logged-out accounts can't open a socket either.
      if (!(await isSessionAllowed(payload))) return next(new Error('Session no longer valid'));
      socket.data.matric = payload.sub;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // NOTE: handlers take `payload` and read fields defensively. With
    // `async ({ code }) =>` a client emitting no payload threw during
    // argument destructuring — an unhandled promise rejection that
    // crashed the whole Node process (any logged-in student could do it).
    socket.on('join-room', async (payload) => {
      try {
        const code = String(payload?.code || '').toUpperCase();
        const room = await StudyRoom.findOne({ code });
        if (!room) return socket.emit('room-error', { error: 'Room not found' });

        const student = await Student.findOne({ matric: socket.data.matric }).lean();
        if (!student) return socket.emit('room-error', { error: 'Student not found' });

        const already = room.participants.some(p => p.matric === student.matric);
        if (room.status === 'ended') return socket.emit('room-error', { error: 'This room has ended' });
        // New players can only join before the start, but existing participants may
        // reconnect mid-game (the disconnect handler below promises exactly that).
        if (room.status !== 'waiting' && !already) return socket.emit('room-error', { error: 'This room has already started' });

        if (!already) {
          if (room.participants.length >= 30) return socket.emit('room-error', { error: 'This room is full' });
          await StudyRoom.updateOne({ code, 'participants.matric': { $ne: student.matric } },
            { $push: { participants: { matric: student.matric, username: student.username || '' } } });
        }

        if (socket.data.roomCode && socket.data.roomCode !== code) socket.leave(socket.data.roomCode);
        socket.data.roomCode = code;
        socket.join(code);

        const fresh = await StudyRoom.findOne({ code });
        io.to(code).emit('room-state', {
          code, status: fresh.status, course: fresh.course,
          hostMatric: fresh.hostMatric, participants: publicParticipants(fresh),
        });
        if (fresh.status === 'active') await resendCurrentQuestion(socket, fresh);
      } catch (e) { socket.emit('room-error', { error: 'Could not join room' }); }
    });

    socket.on('start-room', async () => {
      try {
        // Atomic waiting -> active flip: a double-click on Start used to run the start twice.
        const room = await StudyRoom.findOneAndUpdate(
          { code: socket.data.roomCode, hostMatric: socket.data.matric, status: 'waiting' },
          { $set: { status: 'active', currentQuestionIndex: 0, currentQuestionStartedAt: new Date(), 'participants.$[].answeredCurrent': false } },
          { new: true },
        );
        if (!room) {
          const existing = await StudyRoom.findOne({ code: socket.data.roomCode }).select('hostMatric status').lean();
          if (existing && existing.hostMatric !== socket.data.matric) socket.emit('room-error', { error: 'Only the host can start the room' });
          return;
        }
        await sendCurrentQuestion(io, room);
      } catch (e) { socket.emit('room-error', { error: 'Could not start room' }); }
    });

    socket.on('submit-answer', async (payload) => {
      try {
        const answerIndex = payload?.answerIndex;
        const room = await StudyRoom.findOne({ code: socket.data.roomCode }).populate('questions');
        if (!room || room.status !== 'active' || !room.currentQuestionStartedAt) return; // null = question already closed

        // Server-side deadline (small grace for latency) — closes the window between
        // the timer firing and the reveal being processed.
        const deadline = room.currentQuestionStartedAt.getTime() + room.secondsPerQuestion * 1000 + 1500;
        if (Date.now() > deadline) return;

        const question = room.questions[room.currentQuestionIndex];
        if (!question) return;

        const correct = Number.isInteger(answerIndex) && answerIndex === question.ans;

        // One atomic update that both checks "hasn't answered yet / question still open"
        // and applies the score, so rapid double-submits can't score twice.
        const r = await StudyRoom.updateOne(
          {
            code: room.code, status: 'active',
            currentQuestionIndex: room.currentQuestionIndex,
            currentQuestionStartedAt: { $ne: null },
            participants: { $elemMatch: { matric: socket.data.matric, answeredCurrent: false } },
          },
          { $set: { 'participants.$.answeredCurrent': true }, ...(correct ? { $inc: { 'participants.$.score': 10 } } : {}) },
        );
        if (!r.modifiedCount) return;

        socket.emit('answer-ack', { correct });
        const fresh = await StudyRoom.findOne({ code: room.code });
        io.to(room.code).emit('room-state', {
          code: fresh.code, status: fresh.status, course: fresh.course,
          hostMatric: fresh.hostMatric, participants: publicParticipants(fresh),
        });

        // If everyone's answered, skip the rest of the timer and advance now.
        if (fresh.participants.every(p => p.answeredCurrent)) {
          clearRoomTimer(fresh.code);
          await revealAndAdvance(io, fresh.code);
        }
      } catch (e) { /* swallow — a missed answer shouldn't crash the room */ }
    });

    socket.on('leave-room', () => {
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    });

    socket.on('disconnect', () => {
      // Participant record stays in the DB so they can reconnect and
      // resume — a dropped connection isn't treated as leaving.
    });
  });
}

async function sendCurrentQuestion(io, room) {
  const populated = await room.populate('questions');
  const question = populated.questions[room.currentQuestionIndex];
  if (!question) return endRoom(io, room);

  io.to(room.code).emit('question', {
    index: room.currentQuestionIndex,
    total: room.questionCount,
    secondsPerQuestion: room.secondsPerQuestion,
    question: sanitizeQuestion(question),
  });

  clearRoomTimer(room.code);
  const timer = setTimeout(() => revealAndAdvance(io, room.code).catch(e => console.error('[studyRoom] reveal failed:', e.message)), room.secondsPerQuestion * 1000);
  roomTimers.set(room.code, timer);
}

// Re-sends the live question to a player who reconnected mid-game.
async function resendCurrentQuestion(socket, room) {
  const populated = await room.populate('questions');
  const question = populated.questions[room.currentQuestionIndex];
  if (!question || !room.currentQuestionStartedAt) return;
  const elapsed = Math.floor((Date.now() - room.currentQuestionStartedAt.getTime()) / 1000);
  socket.emit('question', {
    index: room.currentQuestionIndex,
    total: room.questionCount,
    secondsPerQuestion: Math.max(1, room.secondsPerQuestion - elapsed),
    question: sanitizeQuestion(question),
  });
}

async function revealAndAdvance(io, code) {
  clearRoomTimer(code);
  // Close the question atomically. Whoever gets the doc back does the reveal; the
  // timer firing at the same moment as the last answer used to run this twice,
  // double-advancing (a question got skipped) and double-revealing.
  const closed = await StudyRoom.findOneAndUpdate(
    { code, status: 'active', currentQuestionStartedAt: { $ne: null } },
    { $set: { currentQuestionStartedAt: null } },
    { new: true },
  );
  if (!closed) return;
  const room = await StudyRoom.findOne({ code }).populate('questions');
  if (!room) return;

  const question = room.questions[room.currentQuestionIndex];
  io.to(room.code).emit('question-result', {
    index: room.currentQuestionIndex,
    correctIndex: question ? question.ans : null,
    participants: publicParticipants(room),
  });

  const isLast = room.currentQuestionIndex >= room.questionCount - 1;
  if (isLast) {
    setTimeout(() => endRoom(io, room).catch(() => {}), 3000);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      const fresh = await StudyRoom.findOneAndUpdate(
        { code, status: 'active', currentQuestionStartedAt: null },
        { $inc: { currentQuestionIndex: 1 }, $set: { currentQuestionStartedAt: new Date(), 'participants.$[].answeredCurrent': false } },
        { new: true },
      );
      if (fresh) await sendCurrentQuestion(io, fresh);
    } catch (e) { console.error('[studyRoom] advance failed:', e.message); }
  }, 3000);
  roomTimers.set(code, timer);
}

async function endRoom(io, roomArg) {
  clearRoomTimer(roomArg.code);
  const room = await StudyRoom.findOneAndUpdate(
    { code: roomArg.code, status: { $ne: 'ended' } },
    { $set: { status: 'ended', endedAt: new Date() } },
    { new: true },
  );
  if (!room) return; // already ended

  const ranked = [...room.participants].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('room-ended', {
    participants: ranked.map((p, i) => ({ rank: i + 1, matric: p.matric, username: p.username, score: p.score })),
  });
}

module.exports = { initStudyRoomSockets };
