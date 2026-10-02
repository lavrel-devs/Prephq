const Notification = require('../models/Notification');

async function notify({ matric, type, title, message = '', relatedId = null, relatedType = '' }) {
  return Notification.create({ matric: matric.toUpperCase(), type, title, message, relatedId, relatedType });
}

module.exports = { notify };
