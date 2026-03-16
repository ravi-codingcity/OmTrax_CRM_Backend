const mongoose = require('mongoose');

const salesVisitSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true
    },
    location: {
        type: String,
        required: [true, 'Location is required'],
        trim: true
    },
    latitude: {
        type: Number,
        required: [true, 'Latitude is required']
    },
    longitude: {
        type: Number,
        required: [true, 'Longitude is required']
    },
    date: {
        type: String,
        required: [true, 'Date is required']
    },
    time: {
        type: String,
        required: [true, 'Time is required']
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    imageUrl: {
        type: String
    },
    imagePublicId: {
        type: String // For Cloudinary deletion
    },
    salesPerson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Sales person is required'],
        index: true
    },
    salesPersonName: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Index for efficient queries
salesVisitSchema.index({ date: -1 });
salesVisitSchema.index({ salesPerson: 1, date: -1 });

module.exports = mongoose.model('SalesVisit', salesVisitSchema);
