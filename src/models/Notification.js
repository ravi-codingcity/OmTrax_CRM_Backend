const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['followup', 'reminder', 'new_entry', 'business_new', 'business_update'],
        required: [true, 'Notification type is required'],
        index: true
    },
    salesEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalesEntry',
        index: true
    },
    companyName: {
        type: String,
        trim: true
    },
    salesPerson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    salesPersonName: {
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
    followUpDate: {
        type: Date
    },
    isOverdue: {
        type: Boolean,
        default: false
    },
    forUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    forRole: {
        type: String,
        enum: ['admin', 'salesperson', 'manager', 'recruiter', 'senior_recruiter', 'hr_executive', 'hr_manager', 'hr_head', 'all'],
        default: 'all'
    },
    department: {
        type: String,
        enum: ['relocation', 'hr'],
        default: 'relocation',
        index: true
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    readAt: {
        type: Date
    },
    title: {
        type: String,
        trim: true
    },
    message: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Compound index for efficient queries
notificationSchema.index({ forUser: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ forRole: 1, isRead: 1, createdAt: -1 });

// Pre-save hook to set title and message
notificationSchema.pre('save', function(next) {
    if (this.isNew) {
        switch (this.type) {
            case 'followup':
                this.title = 'Follow-up Scheduled';
                this.message = `Follow-up scheduled for ${this.companyName}`;
                break;
            case 'reminder':
                this.title = 'Follow-up Reminder';
                this.message = `Reminder: Follow-up with ${this.companyName}`;
                break;
            case 'new_entry':
                this.title = 'New Sales Entry';
                this.message = `New entry added: ${this.companyName}`;
                break;
            case 'business_new':
                this.title = 'New Business Entry';
                this.message = `New business added for ${this.companyName}`;
                break;
            case 'business_update':
                this.title = 'Business Updated';
                this.message = `Business updated for ${this.companyName}`;
                break;
        }
    }
    next();
});

module.exports = mongoose.model('Notification', notificationSchema);
