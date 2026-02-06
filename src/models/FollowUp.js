const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
    salesEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalesEntry',
        required: true,
        index: true
    },
    remark: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        default: 'Cold'
    },
    nextFollowUpDate: {
        type: Date
    },
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    addedByName: {
        type: String,
        trim: true
    },
    followUpDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
followUpSchema.index({ salesEntry: 1 });
followUpSchema.index({ addedBy: 1 });
followUpSchema.index({ followUpDate: -1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
