const mongoose = require('mongoose');

const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

async function connectDB() {
  let attempt = 0;
  while (true) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
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

mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected — mongoose will attempt to reconnect automatically'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));
mongoose.connection.on('error', (err) => console.error('❌ MongoDB connection error:', err.message));

module.exports = { connectDB };