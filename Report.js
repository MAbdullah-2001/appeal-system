const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  messageId: { type: String, index: true },
  channelId: { type: String, index: true },
  reporterId: { type: String, index: true },
  reporterTag: String,
  authorId: { type: String, index: true },
  authorTag: String,
  content: String,
  imageUrl: String,
  timestamp: { type: Date, default: Date.now, index: true },
  status: { type: String, default: 'Pending', index: true },
  actionTakenBy: { type: String, index: true },
  actionTakenByName: String,
  actionTakenTimestamp: { type: Date, index: true },
  actionType: { type: String, index: true },
  reason: String,
  previousViolations: { type: Number, default: 0 },
  caseId: { type: String, unique: true }, // Removed 'index: true' since 'unique: true' creates an index
  messageLink: String,
  isProfile: { type: Boolean, default: false },
  reportMessageId: { type: String, default: '' }
});

// **Retain Only Compound Indexes**
reportSchema.index({ authorId: 1, status: 1 });
reportSchema.index({ reporterId: 1, timestamp: -1 });

module.exports = mongoose.model('Report', reportSchema);