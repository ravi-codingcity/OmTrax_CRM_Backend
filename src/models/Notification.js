const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: [
            'followup', 'reminder', 'new_entry', 'business_new', 'business_update',
            'hr_assignment', 'hr_update',
            // Purchase location-tracking workflow
            'purchase_receipt_request', 'purchase_received', 'purchase_not_received',
            'purchase_dispatch', 'purchase_return',
            // Vendor KYC workflow (Purchase <-> Finance)
            'vendor_kyc_submitted', 'vendor_kyc_approved', 'vendor_kyc_rejected',
            'vendor_kyc_link_sent',
            // Purchase Orders
            'po_created', 'po_sent',
            // Rate Comparison approval workflow (Purchase <-> Director)
            'rate_comparison_submitted', 'rate_comparison_approved',
            'rate_comparison_rejected', 'rate_comparison_sent_back'
        ],
        required: [true, 'Notification type is required'],
        index: true
    },
    // Link to the vendor a vendor_kyc_* notification refers to
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        index: true
    },
    // Link to the purchase order a po_* notification refers to
    purchaseOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseOrder',
        index: true
    },
    // Link to the rate comparison a rate_comparison_* notification refers to
    rateComparison: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RateComparison',
        index: true
    },
    salesEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalesEntry',
        index: true
    },
    // Link to the purchase entry a purchase_* notification refers to
    purchaseEntry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseEntry',
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
        enum: [
            'admin', 'salesperson', 'manager', 'recruiter', 'team_leader',
            'senior_recruiter', 'hr_executive', 'hr_manager', 'hr_head',
            'purchase_manager', 'warehouse_manager', 'branch_manager',
            'finance_manager', 'accounts_executive', 'director', 'all'
        ],
        default: 'all'
    },
    department: {
        type: String,
        enum: ['relocation', 'hr', 'purchase', 'finance', 'director'],
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
            case 'hr_assignment':
                this.title = 'New Requirement Assigned';
                this.message = `You were assigned: ${this.companyName}`;
                break;
            case 'hr_update':
                this.title = 'Requirement Updated';
                this.message = `Progress updated for ${this.companyName}`;
                break;
            case 'purchase_receipt_request':
                this.title = 'Material Awaiting Receipt';
                this.message = this.message || `New material for your location: ${this.companyName}`;
                break;
            case 'purchase_received':
                this.title = 'Material Received';
                this.message = this.message || `Material received: ${this.companyName}`;
                break;
            case 'purchase_not_received':
                this.title = 'Material Not Received';
                this.message = this.message || `Material not received: ${this.companyName}`;
                break;
            case 'purchase_dispatch':
                this.title = 'Material Dispatched';
                this.message = this.message || `Dispatch recorded: ${this.companyName}`;
                break;
            case 'purchase_return':
                this.title = 'Material Returned';
                this.message = this.message || `Return recorded: ${this.companyName}`;
                break;
            case 'vendor_kyc_submitted':
                this.title = 'Vendor KYC Submitted';
                this.message = this.message || `New Vendor KYC submitted and awaiting approval: ${this.companyName}`;
                break;
            case 'vendor_kyc_approved':
                this.title = 'Vendor KYC Approved';
                this.message = this.message || `Vendor KYC approved: ${this.companyName}`;
                break;
            case 'vendor_kyc_rejected':
                this.title = 'Vendor KYC Rejected';
                this.message = this.message || `Vendor KYC rejected: ${this.companyName}`;
                break;
            case 'vendor_kyc_link_sent':
                this.title = 'KYC Link Shared';
                this.message = this.message || `KYC form link shared with ${this.companyName}`;
                break;
            case 'po_created':
                this.title = 'Purchase Order Created';
                this.message = this.message || `PO created for ${this.companyName}`;
                break;
            case 'po_sent':
                this.title = 'Purchase Order Sent';
                this.message = this.message || `PO sent to ${this.companyName}`;
                break;
            case 'rate_comparison_submitted':
                this.title = 'Rate Comparison Awaiting Approval';
                this.message = this.message || `New rate comparison submitted for approval: ${this.companyName}`;
                break;
            case 'rate_comparison_approved':
                this.title = 'Rate Comparison Approved';
                this.message = this.message || `Rate comparison approved: ${this.companyName}`;
                break;
            case 'rate_comparison_rejected':
                this.title = 'Rate Comparison Rejected';
                this.message = this.message || `Rate comparison rejected: ${this.companyName}`;
                break;
            case 'rate_comparison_sent_back':
                this.title = 'Rate Comparison Sent Back';
                this.message = this.message || `Rate comparison returned for changes: ${this.companyName}`;
                break;
        }
    }
    next();
});

module.exports = mongoose.model('Notification', notificationSchema);
