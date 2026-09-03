const { verifyAccessToken } = require('../utils/jwt');
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
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing access token'));
      const payload = verifyAccessToken(token);
      if (payload.role !== 'student') return next(new Error('Forbidden'));
      socket.data.matric = payload.sub;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-room', async ({ code }) => {
      try {
        const room = await StudyRoom.findOne({ code: String(code || '').toUpperCase() });
        if (!room) return socket.emit('room-error', { error: 'Room not found' });
        if (room.status !== 'waiting') return socket.emit('room-error', { error: 'This room has already started' });

        const student = await Student.findOne({ matric: socket.data.matric }).lean();
        if (!student) return socket.emit('room-error', { error: 'Student not found' });

        if (!room.participants.some(p => p.matric === student.matric)) {
          room.participants.push({ matric: student.matric, username: student.username || '' });
          await room.save();
        }

        socket.data.roomCode = room.code;
        socket.join(room.code);

        io.to(room.code).emit('room-state', {
          code: room.code, status: room.status, course: room.course,
          hostMatric: room.hostMatric, participants: publicParticipants(room),
        });
      } catch (e) { socket.emit('room-error', { error: 'Could not join room' }); }
    });

    socket.on('start-room', async () => {
      try {
        const room = await StudyRoom.findOne({ code: socket.data.roomCode });
        if (!room) return socket.emit('room-error', { error: 'Room not found' });
        if (room.hostMatric !== socket.data.matric) return socket.emit('room-error', { error: 'Only the host can start the room' });
        if (room.status !== 'waiting') return;

        room.status = 'active';
        room.currentQuestionIndex = 0;
        room.currentQuestionStartedAt = new Date();
        room.participants.forEach(p => { p.answeredCurrent = false; });
        await room.save();

        await sendCurrentQuestion(io, room);
      } catch (e) { socket.emit('room-error', { error: 'Could not start room' }); }
    });

    socket.on('submit-answer', async ({ answerIndex }) => {
      try {
        const room = await StudyRoom.findOne({ code: socket.data.roomCode }).populate('questions');
        if (!room || room.status !== 'active') return;

        const participant = room.participants.find(p => p.matric === socket.data.matric);
        if (!participant || participant.answeredCurrent) return;

        const question = room.questions[room.currentQuestionIndex];
        if (!question) return;

        const correct = Number.isInteger(answerIndex) && answerIndex === question.ans;
        if (correct) participant.score += 10;
        participant.answeredCurrent = true;
        await room.save();

        socket.emit('answer-ack', { correct });
        io.to(room.code).emit('room-state', {
          code: room.code, status: room.status, course: room.course,
          hostMatric: room.hostMatric, participants: publicParticipants(room),
        });

        // If everyone's answered, skip the rest of the timer and advance now.
        if (room.participants.every(p => p.answeredCurrent)) {
          clearRoomTimer(room.code);
          await revealAndAdvance(io, room.code);
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
  const timer = setTimeout(() => revealAndAdvance(io, room.code), room.secondsPerQuestion * 1000);
  roomTimers.set(room.code, timer);
}

async function revealAndAdvance(io, code) {
  clearRoomTimer(code);
  const room = await StudyRoom.findOne({ code }).populate('questions');
  if (!room || room.status !== 'active') return;

  const question = room.questions[room.currentQuestionIndex];
  io.to(room.code).emit('question-result', {
    index: room.currentQuestionIndex,
    correctIndex: question ? question.ans : null,
    participants: publicParticipants(room),
  });

  const isLast = room.currentQuestionIndex >= room.questionCount - 1;
  if (isLast) {
    setTimeout(() => endRoom(io, room), 3000);
    return;
  }

  const timer = setTimeout(async () => {
    const fresh = await StudyRoom.findOne({ code });
    if (!fresh || fresh.status !== 'active') return;
    fresh.currentQuestionIndex += 1;
    fresh.currentQuestionStartedAt = new Date();
    fresh.participants.forEach(p => { p.answeredCurrent = false; });
    await fresh.save();
    await sendCurrentQuestion(io, fresh);
  }, 3000);
  roomTimers.set(code, timer);
}

async function endRoom(io, room) {
  clearRoomTimer(room.code);
  room.status = 'ended';
  room.endedAt = new Date();
  await room.save();

  const ranked = [...room.participants].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('room-ended', {
    participants: ranked.map((p, i) => ({ rank: i + 1, matric: p.matric, username: p.username, score: p.score })),
  });
}

module.exports = { initStudyRoomSockets };
