const mongoose = require('mongoose');

// A Purchase Order raised by the Purchase Manager against a Vendor.
// Separate from PurchaseEntry: a PO is the *commitment to buy*, while a
// PurchaseEntry is the material actually received into a storage location.
// The two are intentionally not coupled, so existing Purchase functionality
// is unaffected.

const poItemSchema = new mongoose.Schema({
    itemName: { type: String, required: [true, 'Item name is required'], trim: true },
    description: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true },
    rate: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 }
}, { _id: true });

const poActivitySchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['created', 'updated', 'generated', 'sent', 'acknowledged', 'completed', 'cancelled'],
        required: true
    },
    at: { type: Date, default: Date.now },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    byRole: { type: String, trim: true },
    note: { type: String, trim: true }
}, { _id: false });

const PO_STATUSES = ['draft', 'generated', 'sent', 'acknowledged', 'completed', 'cancelled'];

const purchaseOrderSchema = new mongoose.Schema({
    // Auto-generated, unique and immutable once assigned (see pre-validate hook)
    poNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        immutable: true,
        index: true
    },
    poDate: { type: Date, default: Date.now, index: true },

    // Vendor reference plus a snapshot, so the PO still reads correctly if the
    // vendor record is later edited.
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    vendorName: { type: String, trim: true },
    vendorEmail: { type: String, trim: true },
    vendorGst: { type: String, trim: true },

    // The approved rate comparison this PO came from, when one was required.
    // Gives the full audit chain: Requirement -> Comparison -> Approval -> PO.
    rateComparison: { type: mongoose.Schema.Types.ObjectId, ref: 'RateComparison', index: true },
    rateComparisonNumber: { type: String, trim: true },

    items: {
        type: [poItemSchema],
        validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one item is required']
    },

    // Money. Recomputed on every save from the item lines.
    subTotal: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },

    // Logistics / terms
    deliveryLocation: { type: String, trim: true },
    expectedDeliveryDate: { type: Date },
    paymentTerms: { type: String, trim: true },
    // Point-wise terms. Stored as an ordered array so each condition can be
    // edited, deleted and reordered independently.
    terms: [{ type: String, trim: true }],

    // Legacy: free-text notes and a single T&C blob. No longer collected, kept
    // so existing purchase orders keep their content.
    notes: { type: String, trim: true },
    termsAndConditions: { type: String, trim: true },

    status: {
        type: String,
        enum: PO_STATUSES,
        default: 'draft',
        index: true
    },

    // Sharing record
    sentAt: { type: Date },
    sentTo: { type: String, trim: true },
    sentMethod: { type: String, enum: ['email', 'whatsapp', 'manual', 'link', null], default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, trim: true },

    activity: [poActivitySchema],

    department: { type: String, enum: ['purchase'], default: 'purchase', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ vendor: 1, createdAt: -1 });

// Recompute line amounts and totals so the numbers can never drift from the items.
purchaseOrderSchema.pre('save', function (next) {
    (this.items || []).forEach((line) => {
        line.amount = +(((line.quantity || 0) * (line.rate || 0)).toFixed(2));
    });
    this.subTotal = +((this.items || []).reduce((s, l) => s + (l.amount || 0), 0).toFixed(2));
    const taxable = Math.max(0, this.subTotal - (this.discount || 0));
    this.taxAmount = +((taxable * (this.taxPercent || 0) / 100).toFixed(2));
    this.totalAmount = +((taxable + this.taxAmount).toFixed(2));
    next();
});

/**
 * Allocate the next PO number for the current financial year, e.g. PO/2026-27/0042.
 * Uses a countDocuments-based sequence; adequate at this scale, and the unique
 * index on poNumber is the real guarantee against duplicates.
 */
purchaseOrderSchema.statics.nextPoNumber = async function () {
    const now = new Date();
    // Indian financial year runs April -> March
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
    const prefix = `PO/${fy}/`;

    const last = await this.findOne({ poNumber: new RegExp(`^${prefix.replace(/\//g, '\\/')}`) })
        .sort({ poNumber: -1 })
        .select('poNumber')
        .lean();

    const lastSeq = last ? parseInt(String(last.poNumber).split('/').pop(), 10) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
};

purchaseOrderSchema.methods.logActivity = function (action, actor, note) {
    this.activity = this.activity || [];
    this.activity.push({
        action,
        at: new Date(),
        byUser: actor?.id || actor?._id,
        byName: actor?.name,
        byRole: actor?.role,
        note
    });
};

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
module.exports.PO_STATUSES = PO_STATUSES;
