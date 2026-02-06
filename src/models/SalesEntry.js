const mongoose = require('mongoose');

const salesEntrySchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    contactPerson: {
        type: String,
        required: true,
        trim: true
    },
    contactNumber: {
        type: String,
        required: true,
        trim: true
    },
    contactEmail: {
        type: String,
        trim: true
    },
    designation: {
        type: String,
        trim: true
    },
    requirement: {
        type: String,
        trim: true
    },
    location: {
        type: String,
        trim: true
    },
    remark: {
        type: String,
        trim: true
    },
    nextFollowUpDate: {
        type: Date
    },
    queryStatus: {
        type: String,
        default: 'New'
    },
    salesPerson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    branch: {
        type: String,
        trim: true
    },
    entryDate: {
        type: Date,
        default: Date.now
    },
    followUpHistory: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FollowUp'
    }],
    totalFollowUps: {
        type: Number,
        default: 0
    },
    lastFollowUpDate: {
        type: Date
    },
    convertedDate: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SalesEntry', salesEntrySchema);
