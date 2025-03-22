/// models/Appeal.js
const mongoose = require('mongoose');

const AppealSchema = new mongoose.Schema({
  appealId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userTag: { type: String, required: true },
  muteOrBan: { type: String, required: true }, // e.g. "Muted" or "Banned"
  punishmentReason: { type: String, required: true },
  revokeReason: { type: String, required: true },
  additionalConsiderations: { type: String, default: '' },

  status: { type: String, default: 'Pending' }, // "Pending", "Approved", "Rejected"
  timestamp: { type: Date, default: Date.now },
  
  moderatorId: { type: String },
  moderatorTag: { type: String },
  responseTimestamp: { type: Date }
});

module.exports = mongoose.model('Appeal', AppealSchema);
