const mongoose = require('mongoose');

// A recruitment requirement/task in the HR Management department.
// Created/assigned by an Admin or Team Leader and worked on by a Recruiter.
const recruitmentSchema = new mongoose.Schema({
    // Assignment fields (set by Admin / Team Leader)
    salesPersonName: {
        type: String,
        trim: true
    },
    clientName: {
        type: String,
        required: [true, 'Client name is required'],
        trim: true
    },
    position: {
        type: String,
        required: [true, 'Position is required'],
        trim: true
    },
    recruiter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    recruiterName: {
        type: String,
        trim: true,
        index: true
    },

    // Progress fields (updated by the assigned Recruiter / Admin)
    cvsShared: { type: Number, default: 0, min: 0 },
    interviewsScheduled: { type: Number, default: 0, min: 0 },
    rejected: { type: Number, default: 0, min: 0 },
    interviewsCleared: { type: Number, default: 0, min: 0 },
    offersReleased: { type: Number, default: 0, min: 0 },
    joinees: { type: Number, default: 0, min: 0 },
    // Recruiter-only fields
    dateOfJoining: { type: Date },
    remarks: { type: String, trim: true },

    // Ownership / audit
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    assignedByName: { type: String, trim: true },
    department: {
        type: String,
        enum: ['relocation', 'hr'],
        default: 'hr',
        index: true
    },
    entryDate: {
        type: Date,
        default: Date.now
    },
    // Date the requirement was assigned to the current recruiter (auto-set)
    assignDate: {
        type: Date,
        default: Date.now
    },
    // History of previous recruiters when a requirement is reassigned
    previousRecruiters: [{
        recruiter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        recruiterName: { type: String, trim: true },
        reassignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reassignedByName: { type: String, trim: true },
        reassignedAt: { type: Date, default: Date.now }
    }],
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Common query indexes
recruitmentSchema.index({ recruiter: 1, createdAt: -1 });
recruitmentSchema.index({ assignedBy: 1, createdAt: -1 });
recruitmentSchema.index({ clientName: 1 });

module.exports = mongoose.model('RecruitmentEntry', recruitmentSchema);
