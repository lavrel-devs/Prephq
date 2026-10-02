const mongoose = require('mongoose');

// Mongo drops requests into a queue ("buffering") while there's no
// active connection, and each queued operation times out on its own
// after bufferTimeoutMS (default 10s) — that's the exact "Operation
// `x.find()` buffering timed out after 10000ms" error. That default
// silently retries forever with no visibility into *why* the initial
// connection never established. This adds explicit timeouts (fail
// fast and loud instead of hanging) and a real retry-with-backoff loop
// so a transient network hiccup on boot doesn't require a manual
// restart, while a persistent failure logs clearly instead of just
// piling up buffering-timeout errors on every request.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000]; // caps at 30s between attempts

async function connectDB() {
  let attempt = 0;
  while (true) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000, // fail fast if the cluster is unreachable, rather than hanging
        socketTimeoutMS: 45000,
      });
      console.log('✅ MongoDB connected');
      break;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      console.error(`❌ MongoDB connection failed (attempt ${attempt + 1}): ${err.message}`);
      console.error(`   Retrying in ${delay / 1000}s... (check MONGODB_URI, Atlas IP whitelist, and network/DNS)`);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected — mongoose will attempt to reconnect automatically');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

module.exports = { connectDB };
