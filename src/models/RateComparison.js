const mongoose = require('mongoose');

/**
 * Rate Comparison — the step that sits BEFORE a Purchase Order.
 *
 * The Purchase Team collects quotations from several vendors for one or more
 * items, compares them item by item, nominates a vendor, and submits the
 * comparison to the Director for approval. Only once approved can it be turned
 * into a PO.
 *
 *   Requirement -> Quotations -> Comparison -> Director -> Approved -> PO
 *
 * Shape
 *   items[]          what is being bought (name, quantity, unit)
 *   quotations[]     one per vendor
 *     lines[]        that vendor's quote for each item, linked by items[]._id
 *
 * Comparisons created before multi-item support hold a single material in
 * materialName / requiredQuantity / unit and the quote directly on each
 * quotation (quotedRate, taxPercent, ...), with no items[] or lines[]. They are
 * left exactly as stored; services/rateComparisonService.js presents them in the
 * items/lines shape, and they take that shape when next saved.
 */

// One item being compared
const comparisonItemSchema = new mongoose.Schema({
    itemName: { type: String, required: [true, 'Item name is required'], trim: true },
    requiredQuantity: { type: Number, required: [true, 'Required quantity is required'], min: 0 },
    unit: { type: String, trim: true },
}, { _id: true });

// One vendor's quote for one item. Amounts are recomputed by the pre-save hook.
const quotationLineSchema = new mongoose.Schema({
    item: { type: mongoose.Schema.Types.ObjectId, required: true },   // items[]._id
    itemName: { type: String, trim: true },                            // snapshot, kept in step on save
    quotedRate: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    deliveryTime: { type: String, trim: true },
    paymentTerms: { type: String, trim: true },
    baseAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
}, { _id: true });

// One vendor's quotation within a comparison.
const quotationSchema = new mongoose.Schema({
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: { type: String, trim: true },

    // Per-item quotes. No default, so saving a legacy comparison does not add
    // an empty array to it.
    lines: { type: [quotationLineSchema], default: undefined },

    // Commercials. With items[] these are derived from `lines` on save: the
    // amounts are the vendor's totals across every item quoted, and rate / GST /
    // delivery / payment summarise the lines. On a legacy single-material
    // comparison they are the quote itself.
    quotedRate: { type: Number, min: 0 },
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
    // Assigned by the server when the comparison is created. Never read from a
    // request, and immutable, so it cannot be changed afterwards.
    comparisonDate: { type: Date, default: Date.now, immutable: true, index: true },

    // --- What is being purchased ---
    // No default, so a legacy comparison stays exactly as stored until edited
    items: { type: [comparisonItemSchema], default: undefined },

    // Summary of the items, kept in step on save so lists, notifications and
    // search read the same on every comparison. One item fills all three
    // exactly; several give "First item + N more items" and leave quantity and
    // unit empty, since each item carries its own.
    materialName: { type: String, required: [true, 'Material name is required'], trim: true, index: true },
    materialDescription: { type: String, trim: true },
    requiredQuantity: { type: Number, min: 0 },
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
rateComparisonSchema.index({ 'items.itemName': 1 });

const money = (n) => +(Number(n) || 0).toFixed(2);

// Distinct non-empty values, in first-seen order, joined for a summary field
const summarise = (values) => [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))].join('; ');

/**
 * Recompute every quotation's amounts, and keep the summary fields and the
 * selected-vendor snapshot in step. Amounts can therefore never drift from the
 * rates that were entered.
 */
// Runs before validation (which every save performs), so the derived summary
// fields — materialName in particular — exist by the time they are validated.
rateComparisonSchema.pre('validate', function (next) {
    if (this.items && this.items.length) {
        const byId = new Map(this.items.map((it) => [String(it._id), it]));

        (this.quotations || []).forEach((q) => {
            // A line for an item that is no longer on the comparison goes with it
            q.lines = (q.lines || []).filter((l) => byId.has(String(l.item)));

            let base = 0;
            let tax = 0;
            q.lines.forEach((l) => {
                const it = byId.get(String(l.item));
                l.itemName = it.itemName;
                l.baseAmount = money((Number(l.quotedRate) || 0) * (Number(it.requiredQuantity) || 0));
                l.taxAmount = money(l.baseAmount * (Number(l.taxPercent) || 0) / 100);
                l.totalAmount = money(l.baseAmount + l.taxAmount);
                base += l.baseAmount;
                tax += l.taxAmount;
            });

            q.baseAmount = money(base);
            q.taxAmount = money(tax);
            q.deliveryCharges = 0;
            q.totalAmount = money(base + tax);

            const single = this.items.length === 1 && q.lines.length === 1 ? q.lines[0] : null;
            const gst = [...new Set(q.lines.map((l) => Number(l.taxPercent) || 0))];
            q.quotedRate = single ? single.quotedRate : undefined;
            q.taxPercent = gst.length === 1 ? gst[0] : undefined;
            q.deliveryTime = summarise(q.lines.map((l) => l.deliveryTime));
            q.paymentTerms = summarise(q.lines.map((l) => l.paymentTerms));
        });

        const [first] = this.items;
        const more = this.items.length - 1;
        this.materialName = more
            ? `${first.itemName} + ${more} more item${more === 1 ? '' : 's'}`
            : first.itemName;
        this.requiredQuantity = more ? undefined : first.requiredQuantity;
        this.unit = more ? undefined : first.unit;
    } else {
        // Legacy single-material comparison, not yet converted
        const qty = Number(this.requiredQuantity) || 0;
        (this.quotations || []).forEach((q) => {
            q.baseAmount = money((Number(q.quotedRate) || 0) * qty);
            q.taxAmount = money(q.baseAmount * (Number(q.taxPercent) || 0) / 100);
            q.totalAmount = money(q.baseAmount + q.taxAmount + (Number(q.deliveryCharges) || 0));
        });
    }

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
