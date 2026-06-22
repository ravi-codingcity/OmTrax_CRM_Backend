const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
    client: {
        type: String,
        required: [true, 'Client is required'],
        trim: true
    },
    jobNumber: {
        type: String,
        required: [true, 'Job number is required'],
        unique: true,
        trim: true,
        // Immutable: once set on creation it can never be changed
        immutable: true
    },
    estimateAmount: {
        type: Number,
        required: [true, 'Estimate amount is required'],
        min: [0, 'Estimate amount cannot be negative']
    },
    remarks: {
        type: String,
        trim: true
    },
    salesPerson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    salesPersonName: {
        type: String,
        trim: true
    },
    branch: {
        type: String,
        trim: true
    },
    entryDate: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
businessSchema.index({ salesPerson: 1, createdAt: -1 });
businessSchema.index({ client: 1 });

module.exports = mongoose.model('Business', businessSchema);
