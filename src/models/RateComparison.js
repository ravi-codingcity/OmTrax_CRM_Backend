const mongoose = require('mongoose');

/**
 * Rate Comparison — the step that sits BEFORE a Purchase Order.
 *
 * The Purchase Team collects quotations from several vendors for one material,
 * compares them, nominates a vendor, and submits the comparison to the Director
 * for approval. Only once approved can it be turned into a PO.
 *
 *   Requirement -> Quotations -> Comparison -> Director -> Approved -> PO
 */

// One vendor's quotation within a comparison.
const quotationSchema = new mongoose.Schema({
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: { type: String, trim: true },

    // Commercials — amounts are recomputed by the parent's pre-save hook
    quotedRate: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    deliveryCharges: { type: Number, default: 0, min: 0 },
    baseAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },

    // Terms
    deliveryTime: { type: String, trim: true },   // e.g. "7 days"
    paymentTerms: { type: String, trim: true },

    vendorRemarks: { type: String, trim: true },
    purchaseRemarks: { type: String, trim: true },

    isSelected: { type: Boolean, default: false },
}, { _id: true, timestamps: true });

// Append-only audit trail
const historySchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['created', 'updated', 'submitted', 'approved', 'rejected',
            'sent_back', 'resubmitted', 'po_created', 'cancelled'],
        required: true
    },
    at: { type: Date, default: Date.now },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    byRole: { type: String, trim: true },
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    remarks: { type: String, trim: true },
}, { _id: false });

const RC_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'sent_back', 'cancelled'];

const rateComparisonSchema = new mongoose.Schema({
    comparisonNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        immutable: true,
        index: true
    },
    comparisonDate: { type: Date, default: Date.now, index: true },

    // --- What is being purchased ---
    materialName: { type: String, required: [true, 'Material name is required'], trim: true, index: true },
    materialDescription: { type: String, trim: true },
    requiredQuantity: { type: Number, required: [true, 'Required quantity is required'], min: 0 },
    unit: { type: String, trim: true },

    // --- Vendor quotations (2 or more expected before submission) ---
    quotations: [quotationSchema],

    // --- The Purchase Team's recommendation ---
    selectedQuotation: { type: mongoose.Schema.Types.ObjectId },
    selectedVendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    selectedVendorName: { type: String, trim: true },
    comparisonRemarks: { type: String, trim: true },

    // --- Workflow ---
    // draft -> pending_approval -> approved | rejected | sent_back
    // sent_back -> pending_approval again (revision counter increments)
    status: {
        type: String,
        enum: RC_STATUSES,
        default: 'draft',
        index: true
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedByName: { type: String, trim: true },
    submittedAt: { type: Date },
    revisionCount: { type: Number, default: 0 },

    // --- Director decision ---
    directorReview: {
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reviewedByName: { type: String, trim: true },
        reviewedAt: { type: Date },
        decision: { type: String, enum: ['approved', 'rejected', 'sent_back', null], default: null },
        remarks: { type: String, trim: true },
    },

    history: [historySchema],

    // --- Link forward to the PO raised from this comparison ---
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    poNumber: { type: String, trim: true },

    department: { type: String, enum: ['purchase'], default: 'purchase', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
}, {
    timestamps: true
});

rateComparisonSchema.index({ status: 1, createdAt: -1 });
rateComparisonSchema.index({ selectedVendor: 1 });

/**
 * Recompute every quotation's amounts, and keep the selected-vendor snapshot in
 * step with whichever quotation is flagged. Amounts can therefore never drift
 * from the rates that were entered.
 */
rateComparisonSchema.pre('save', function (next) {
    const qty = Number(this.requiredQuantity) || 0;

    (this.quotations || []).forEach((q) => {
        q.baseAmount = +((Number(q.quotedRate) || 0) * qty).toFixed(2);
        q.taxAmount = +(q.baseAmount * (Number(q.taxPercent) || 0) / 100).toFixed(2);
        q.totalAmount = +(q.baseAmount + q.taxAmount + (Number(q.deliveryCharges) || 0)).toFixed(2);
    });

    const selected = (this.quotations || []).find((q) => q.isSelected);
    if (selected) {
        this.selectedQuotation = selected._id;
        this.selectedVendor = selected.vendor;
        this.selectedVendorName = selected.vendorName;
    } else {
        this.selectedQuotation = undefined;
        this.selectedVendor = undefined;
        this.selectedVendorName = undefined;
    }

    next();
});

/**
 * Allocate the next comparison number for the current financial year,
 * e.g. RC/2026-27/0007. The unique index is the real duplicate guard.
 */
rateComparisonSchema.statics.nextComparisonNumber = async function () {
    const now = new Date();
    // Indian financial year runs April -> March
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
    const prefix = `RC/${fy}/`;

    const last = await this.findOne({ comparisonNumber: new RegExp(`^${prefix.replace(/\//g, '\\/')}`) })
        .sort({ comparisonNumber: -1 })
        .select('comparisonNumber')
        .lean();

    const lastSeq = last ? parseInt(String(last.comparisonNumber).split('/').pop(), 10) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
};

rateComparisonSchema.methods.log = function (action, actor, extra = {}) {
    this.history = this.history || [];
    this.history.push({
        action,
        at: new Date(),
        byUser: actor?.id || actor?._id,
        byName: actor?.name,
        byRole: actor?.role,
        ...extra,
    });
};

// A comparison may only become a PO once the Director has approved it and no
// PO has been raised from it already.
rateComparisonSchema.methods.canRaisePurchaseOrder = function () {
    if (this.status !== 'approved') {
        return { ok: false, message: `This rate comparison is "${this.status.replace(/_/g, ' ')}" — only an approved comparison can become a purchase order.` };
    }
    if (this.purchaseOrder) {
        return { ok: false, message: `A purchase order (${this.poNumber || 'already raised'}) has already been created from this comparison.` };
    }
    if (!this.selectedVendor) {
        return { ok: false, message: 'No vendor was selected on this comparison.' };
    }
    return { ok: true };
};

module.exports = mongoose.model('RateComparison', rateComparisonSchema);
module.exports.RC_STATUSES = RC_STATUSES;
