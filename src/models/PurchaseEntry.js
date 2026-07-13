const mongoose = require('mongoose');

// A single dispatch (movement out) of a purchased item.
// Every dispatch must reference a customer Job Number for traceability.
const dispatchSchema = new mongoose.Schema({
    dispatchDate: { type: Date, default: Date.now },
    quantity: { type: Number, required: true, min: 0 },
    jobNumber: { type: String, trim: true, required: [true, 'Job number is required'] },
    remark: { type: String, trim: true }, // optional dispatch note
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true }
}, { timestamps: true });

// A single return (job returned item) back into stock.
const returnSchema = new mongoose.Schema({
    returnDate: { type: Date, default: Date.now },
    quantity: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true }
}, { timestamps: true });

const purchaseEntrySchema = new mongoose.Schema({
    // Procurement details
    itemName: { type: String, required: [true, 'Item name is required'], trim: true, index: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    // Where the purchased material is stored (warehouse / branch / office)
    storageLocation: { type: String, trim: true, index: true },
    supplier: { type: String, trim: true }, // supplier / vendor
    purchaseDate: { type: Date, default: Date.now },
    quantityPurchased: { type: Number, required: [true, 'Quantity is required'], min: 0 },
    unit: { type: String, trim: true },
    unitPrice: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    invoiceNumber: { type: String, trim: true },
    remarks: { type: String, trim: true },

    // Lifecycle records
    dispatches: [dispatchSchema],
    returns: [returnSchema],

    // Auto-maintained inventory totals (recomputed on every save)
    totalDispatched: { type: Number, default: 0 },
    totalReturned: { type: Number, default: 0 },
    availableStock: { type: Number, default: 0 },

    department: {
        type: String,
        enum: ['relocation', 'hr', 'purchase'],
        default: 'purchase',
        index: true
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    createdByUsername: { type: String, trim: true }, // login username, for traceability
    createdByBranch: { type: String, trim: true },   // creator's branch / location snapshot
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

// Keep inventory totals in sync automatically:
// Available Stock = Purchased − Dispatched + Returned
purchaseEntrySchema.pre('save', function (next) {
    this.totalDispatched = (this.dispatches || []).reduce((sum, d) => sum + (d.quantity || 0), 0);
    this.totalReturned = (this.returns || []).reduce((sum, r) => sum + (r.quantity || 0), 0);
    this.availableStock = (this.quantityPurchased || 0) - this.totalDispatched + this.totalReturned;
    next();
});

purchaseEntrySchema.index({ department: 1, createdAt: -1 });

module.exports = mongoose.model('PurchaseEntry', purchaseEntrySchema);
