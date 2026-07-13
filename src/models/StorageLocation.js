const mongoose = require('mongoose');

// Storage location master (warehouse / branch / office) for the Purchase
// department. Predefined locations live in purchaseConstants; anything a user
// adds is stored here and merged into future autocomplete suggestions.
const storageLocationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Location name is required'],
        trim: true
    },
    type: {
        type: String,
        enum: ['Warehouse', 'Branch', 'Office', 'Other'],
        default: 'Branch'
    },
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

storageLocationSchema.index({ department: 1, name: 1 });

module.exports = mongoose.model('StorageLocation', storageLocationSchema);
