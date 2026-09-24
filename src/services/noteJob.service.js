// Background "generate every note" job. One job runs at a time. All AI calls use the LOW-priority lane of the
// AI queue, so students' quizzes/chat are never stuck behind it, and rate limits are waited out automatically.
const NoteJob = require('../models/NoteJob');
const Course = require('../models/Course');
const aiQueue = require('./aiQueue.service');
const { buildOutline, writeNoteForTopic } = require('./noteBuilder.service');

const running = new Set();     // job ids being worked on by this process
const cancelled = new Set();

async function activeJob() { return NoteJob.findOne({ status: { $in: ['queued', 'running'] } }).sort({ createdAt: -1 }); }

// Creates a job for one course or all courses. If one is already active, returns that instead.
async function startJob({ courseKey, all, admin }) {
  const existing = await activeJob();
  if (existing) return { job: existing, already: true };
  let courses;
  if (all) courses = await Course.find({}).select('key courseCode').sort({ courseCode: 1 }).lean();
  else { const c = await Course.findOne({ key: courseKey }).select('key courseCode').lean(); courses = c ? [c] : []; }
  if (!courses.length) { const e = new Error('Pick an existing course'); e.status = 400; throw e; }
  const job = await NoteJob.create({
    scope: all ? 'all' : 'course', status: 'queued', createdBy: admin || '', message: 'Starting…',
    courses: courses.map(c => ({ key: c.key, code: c.courseCode })),
  });
  launch(job._id);
  return { job, already: false };
}

function launch(id) {
  const key = String(id);
  if (running.has(key)) return;
  running.add(key);
  work(key).catch(async (e) => {
    console.error('[noteJob] crashed:', e);
    await NoteJob.updateOne({ _id: key }, { status: 'failed', message: `Stopped: ${e.message}`, finishedAt: new Date() }).catch(() => {});
  }).finally(() => { running.delete(key); cancelled.delete(key); });
}

async function shouldStop(id) {
  if (cancelled.has(id)) return true;
  const j = await NoteJob.findById(id).select('status').lean();
  return !j || j.status === 'cancelled';
}

async function work(id) {
  await NoteJob.updateOne({ _id: id }, { status: 'running', startedAt: new Date(), finishedAt: null });
  let job = await NoteJob.findById(id);
  if (!job) return;

  // Phase 1: build the topic outline for each course that doesn't have items yet.
  for (let ci = 0; ci < job.courses.length; ci++) {
    if (await shouldStop(id)) return finish(id, 'cancelled', 'Stopped by admin.');
    const c = job.courses[ci];
    if (c.state !== 'pending' && c.state !== 'outlining') continue;
    await NoteJob.updateOne({ _id: id }, { [`courses.${ci}.state`]: 'outlining', message: `Reading past questions for ${c.code}…`, current: c.code });
    try {
      const course = await Course.findOne({ key: c.key }).lean();
      const out = await buildOutline(course, { priority: 'low' });
      const todo = out.topics.filter(t => !t.note);
      await NoteJob.updateOne({ _id: id }, {
        [`courses.${ci}.state`]: 'ready', [`courses.${ci}.topics`]: out.topics.length,
        $push: { items: { $each: todo.map(t => ({ courseKey: c.key, topic: t.name, tags: t.tags, questionIds: t.questionIds, status: 'pending' })) } },
        $inc: { 'counts.total': todo.length, 'counts.skipped': out.topics.length - todo.length },
      });
    } catch (e) {
      const nodata = e.status === 400;
      await NoteJob.updateOne({ _id: id }, { [`courses.${ci}.state`]: nodata ? 'nodata' : 'failed', [`courses.${ci}.error`]: e.message });
    }
  }

  // Phase 2: write each pending note, one after another.
  job = await NoteJob.findById(id).lean();
  const courseByKey = new Map();
  for (let i = 0; i < job.items.length; i++) {
    const it = job.items[i];
    if (it.status !== 'pending') continue;
    if (await shouldStop(id)) return finish(id, 'cancelled', 'Stopped by admin.');
    if (!courseByKey.has(it.courseKey)) courseByKey.set(it.courseKey, await Course.findOne({ key: it.courseKey }).lean());
    const course = courseByKey.get(it.courseKey);
    await NoteJob.updateOne({ _id: id }, { message: 'Writing notes…', current: `${course.courseCode} — ${it.topic}` });
    const tick = setInterval(() => { const s = aiQueue.status(); NoteJob.updateOne({ _id: id }, { waitUntil: s.pausedUntil ? new Date(s.pausedUntil) : null }).catch(() => {}); }, 4000);
    try {
      const r = await writeNoteForTopic({ course, topic: it.topic, tags: it.tags, questionIds: it.questionIds, actor: job.createdBy || 'admin', priority: 'low' });
      if (r.note) await NoteJob.updateOne({ _id: id }, { [`items.${i}.status`]: 'done', $inc: { 'counts.done': 1 }, waitUntil: null });
      else await NoteJob.updateOne({ _id: id }, { [`items.${i}.status`]: 'skipped', [`items.${i}.error`]: r.conflict || r.bad || '', $inc: { 'counts.skipped': 1 } });
    } catch (e) {
      await NoteJob.updateOne({ _id: id }, { [`items.${i}.status`]: 'failed', [`items.${i}.error`]: String(e.message).slice(0, 200), $inc: { 'counts.failed': 1 } });
    } finally { clearInterval(tick); }
  }
  const j = await NoteJob.findById(id).select('counts courses').lean();
  const bad = j.courses.filter(c => c.state === 'failed').length;
  await finish(id, 'done', `Finished: ${j.counts.done} draft${j.counts.done === 1 ? '' : 's'} written${j.counts.failed ? `, ${j.counts.failed} failed` : ''}${bad ? `, ${bad} course outline(s) failed` : ''}.`);
}

async function finish(id, status, message) {
  await NoteJob.updateOne({ _id: id }, { status, message, current: '', waitUntil: null, finishedAt: new Date() });
}

async function cancelJob(id) {
  cancelled.add(String(id));
  const r = await NoteJob.updateOne({ _id: id, status: { $in: ['queued', 'running'] } }, { status: 'cancelled', message: 'Stopped by admin.', current: '', waitUntil: null, finishedAt: new Date() });
  return r.modifiedCount > 0;
}

// Failed items (and failed course outlines) go back to pending and the job runs again.
async function retryFailed(id) {
  if (await activeJob()) { const e = new Error('A job is already running.'); e.status = 409; throw e; }
  const job = await NoteJob.findById(id);
  if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }
  let n = 0;
  job.items.forEach(it => { if (it.status === 'failed') { it.status = 'pending'; it.error = ''; n++; } });
  job.courses.forEach(c => { if (c.state === 'failed') { c.state = 'pending'; c.error = ''; n++; } });
  if (!n) { const e = new Error('Nothing to retry.'); e.status = 400; throw e; }
  job.counts.failed = 0; job.status = 'queued'; job.message = 'Retrying…'; job.finishedAt = null;
  await job.save();
  launch(job._id);
  return job;
}

// On boot, pick up a job that was running when the server restarted (free hosts restart often).
async function resumeInterrupted() {
  const jobs = await NoteJob.find({ status: { $in: ['queued', 'running'] } }).select('_id').lean();
  for (const j of jobs) launch(j._id);
  return jobs.length;
}

const summary = (j) => j && ({
  id: j._id, scope: j.scope, status: j.status, message: j.message, current: j.current, waitUntil: j.waitUntil,
  counts: j.counts, courses: (j.courses || []).map(c => ({ code: c.code, state: c.state, topics: c.topics, error: c.error })),
  failed: (j.items || []).filter(i => i.status === 'failed').slice(0, 15).map(i => ({ topic: i.topic, courseKey: i.courseKey, error: i.error })),
  createdBy: j.createdBy, startedAt: j.startedAt, finishedAt: j.finishedAt,
});

module.exports = { startJob, cancelJob, retryFailed, resumeInterrupted, activeJob, summary };
