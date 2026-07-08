const mongoose = require('mongoose');

// Item master catalogue for the Purchase department. Items can be created
// manually here; frequently-used items are also seeded from purchaseConstants.
const itemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Item name is required'],
        trim: true
    },
    category: {
        type: String,
        trim: true
    },
    unit: {
        type: String,
        trim: true
    },
    department: {
        type: String,
        enum: ['relocation', 'hr', 'purchase'],
        default: 'purchase',
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdByName: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// One item name per department (case-insensitive uniqueness handled in controller)
itemSchema.index({ department: 1, name: 1 });

module.exports = mongoose.model('Item', itemSchema);
