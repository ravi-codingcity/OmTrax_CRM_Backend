const mongoose = require('mongoose');

// Supplier / Vendor master for the Purchase department. Prevents duplicate
// suppliers — new names are added here and reused via autocomplete afterwards.
const supplierSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Supplier name is required'],
        trim: true
    },
    contact: { type: String, trim: true },
    department: {
        type: String,
        enum: ['relocation', 'hr', 'purchase'],
        default: 'purchase',
        index: true
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

supplierSchema.index({ department: 1, name: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
