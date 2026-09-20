const express = require('express');
const crypto = require('crypto');
const StudyRoom = require('../models/StudyRoom');
const Question = require('../models/Question');
const Student = require('../models/Student');
const { requireStudent } = require('../middleware/auth');
const { courseMatchFilter } = require('../utils/courseMatch');

const router = express.Router();

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function generateRoomCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)]).join('');
    const exists = await StudyRoom.exists({ code }); // ANY status: `code` is unique, so an ended room's code can't be reused
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique room code, please retry');
}

// POST /api/study-rooms — create a room. Picks `questionCount` random
// questions from the given course up front (not re-picked per join),
// so everyone in the room sees the same quiz.
router.post('/study-rooms', requireStudent, async (req, res) => {
  try {
    const { questionCount, secondsPerQuestion } = req.body;
    const course = typeof req.body.course === 'string' ? req.body.course.trim().slice(0, 40) : '';
    if (!course) return res.status(400).json({ error: 'course is required' });

    const student = await Student.findOne({ matric: req.student.sub }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const count = Math.min(Math.max(parseInt(questionCount, 10) || 10, 3), 30);
    const matchFilter = await courseMatchFilter(course);
    const [pool, totalForCourse] = await Promise.all([
      Question.aggregate([{ $match: matchFilter }, { $sample: { size: count } }]),
      Question.countDocuments(matchFilter),
    ]);
    if (pool.length < 3) {
      return res.status(400).json({
        error: `Not enough questions in this course to start a room (found ${totalForCourse}, need at least 3). Ask an admin to add more questions for "${course}".`,
      });
    }

    const code = await generateRoomCode();
    const room = await StudyRoom.create({
      code,
      hostMatric: student.matric,
      course,
      questions: pool.map(q => q._id),
      questionCount: pool.length,
      secondsPerQuestion: Math.min(Math.max(parseInt(secondsPerQuestion, 10) || 20, 10), 60),
      participants: [{ matric: student.matric, username: student.username || '' }],
    });

    res.status(201).json({ code: room.code, roomId: room._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/study-rooms/:code — lobby preview info before joining via socket.
router.get('/study-rooms/:code', requireStudent, async (req, res) => {
  try {
    const room = await StudyRoom.findOne({ code: String(req.params.code).toUpperCase() }).lean();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({
      code: room.code,
      course: room.course,
      hostMatric: room.hostMatric,
      status: room.status,
      questionCount: room.questionCount,
      secondsPerQuestion: room.secondsPerQuestion,
      participantCount: room.participants.length,
      isHost: room.hostMatric === req.student.sub,
      alreadyIn: room.participants.some(p => p.matric === req.student.sub),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
