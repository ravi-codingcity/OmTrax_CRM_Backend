const mongoose = require('mongoose');

const dismissedReminderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    salesEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalesEntry',
        required: true,
        index: true
    },
    // Store the date that was dismissed - so if follow-up date changes, it can reappear
    dismissedForDate: {
        type: Date,
        required: true
    },
    dismissedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index for efficient queries
dismissedReminderSchema.index({ user: 1, salesEntry: 1, dismissedForDate: 1 }, { unique: true });

module.exports = mongoose.model('DismissedReminder', dismissedReminderSchema);
